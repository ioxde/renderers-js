import {
    ConstantValueNode,
    DiscriminatorNode,
    EventNode,
    isNode,
    isNodeFilter,
    resolveNestedTypeNode,
    StructTypeNode,
    TypeNode,
} from '@codama/nodes';
import { getByteSizeVisitor, LinkableDictionary, visit } from '@codama/visitors-core';

import { Fragment, fragment, getBytesFromBytesValueNode, RenderScope, use } from '../utils';
import { getDiscriminatorConstantName } from './discriminatorConstants';
import {
    getCpiFramedSkipExprFragment,
    getEventCpiFraming,
    getEventOwnDiscriminators,
    isEventIdentifiable,
    ResolvedProgramEventFraming,
} from './eventFraming';

/** Byte width, or `null` when not fixed. An unrecorded link throws; that reads as unknown width, not a render failure. */
function getTypeByteSize(type: TypeNode, linkables: LinkableDictionary): number | null {
    try {
        return visit(type, getByteSizeVisitor(linkables));
    } catch {
        return null;
    }
}

/**
 * Leading bytes the decode offset consumes, or `null` when a prefix entry has no statically
 * known width — the offset then cannot be reconciled with the gate in front of it.
 *
 * Measured from the hidden prefix, never from the discriminators: an entry nobody declared a
 * discriminator for still sits between the data and the body.
 *
 * @see {@link isEventParsable}
 */
export function getEventSkipExtent(event: EventNode, linkables: LinkableDictionary): number | null {
    let total = 0;
    // Nested prefixes stack: the decoder is built from the innermost type, so every level is skipped.
    for (let node = event.data; ; node = node.type) {
        if (!isNode(node, 'hiddenPrefixTypeNode')) {
            // Any other wrapper the decoder resolves through may add leading bytes this cannot count.
            return resolveNestedTypeNode(node) === node ? total : null;
        }
        for (const entry of node.prefix ?? []) {
            const size = getTypeByteSize(entry.type, linkables);
            if (size === null) return null;
            total += size;
        }
    }
}

/** Bytes the gate proves present: the furthest end offset any check requires. */
function getGateByteExtent(scope: {
    discriminators: DiscriminatorNode[];
    framingSize: number | null;
    linkables: LinkableDictionary;
    struct: StructTypeNode;
}): number {
    return scope.discriminators.reduce((extent, discriminator) => {
        const end = getDiscriminatorEndOffset(discriminator, scope.struct, scope.linkables);
        return end !== null && end > extent ? end : extent;
    }, scope.framingSize ?? 0);
}

function getDiscriminatorEndOffset(
    discriminator: DiscriminatorNode,
    struct: StructTypeNode,
    linkables: LinkableDictionary,
): number | null {
    if (isNode(discriminator, 'sizeDiscriminatorNode')) return discriminator.size;
    if (isNode(discriminator, 'constantDiscriminatorNode')) {
        // `containsBytes` compares the emitted constant, so it proves its rendered length, not the
        // type's wire width. Field discriminators encode at the use site and do reach that width.
        const size = getRenderedByteLength(discriminator.constant);
        return size === null ? null : discriminator.offset + size;
    }
    if (isNode(discriminator, 'fieldDiscriminatorNode')) {
        const field = (struct.fields ?? []).find(f => f.name === discriminator.name);
        const size = field ? getTypeByteSize(field.type, linkables) : null;
        return size === null ? null : discriminator.offset + size;
    }
    return null;
}

/**
 * An event's borsh body offset plus the length clause its gate needs to prove those bytes are there.
 *
 * @see {@link getEventSkip}
 */
export type EventSkip = {
    /** ANDed into the gate when the discriminator checks do not already prove the skipped bytes. */
    lengthClause: Fragment | undefined;
    /** Decode offset; `undefined` decodes from the start of the data. */
    offset: Fragment | undefined;
};

/**
 * Offset and clause come back together so a caller cannot gate on the checks while sizing its
 * offset from somewhere else. A gate whose checks already reach the offset gets no clause, and the
 * clause covers the skipped bytes only — a matching event with a short body still throws on decode.
 */
export function getEventSkip(
    scope: Pick<RenderScope, 'linkables' | 'nameApi'> & {
        /** Module hosting the per-event constants; omit when they live on the same page. */
        constantSource?: `./${string}`;
        event: EventNode;
        programEventFraming: ResolvedProgramEventFraming | undefined;
        struct: StructTypeNode;
    },
): EventSkip {
    const { constantSource, event, linkables, nameApi, programEventFraming, struct } = scope;
    const extent = getEventSkipExtent(event, linkables);
    if (extent === null || extent === 0) {
        return { lengthClause: undefined, offset: undefined };
    }

    const cpiFraming = getEventCpiFraming(event, programEventFraming);
    const discriminators = getEventOwnDiscriminators(event, programEventFraming);
    const offset = getOffsetFragment({
        constantSource,
        cpiFraming,
        discriminators,
        event,
        extent,
        linkables,
        nameApi,
    });

    const gateExtent = getGateByteExtent({
        discriminators,
        framingSize: cpiFraming ? getRenderedByteLength(cpiFraming.constant) : null,
        linkables,
        struct,
    });
    return {
        lengthClause: gateExtent >= extent ? undefined : fragment`data.length >= ${offset}`,
        offset,
    };
}

/**
 * Byte count of the emitted constant, which is what `CONST.length` and `containsBytes` read — not
 * the type's wire width. The constant holds the raw value while its encoder pads to the declared
 * size, so a short `bytesValueNode` renders shorter than its type. `null` when it does not render
 * as a `ReadonlyUint8Array` at all: an `Address` is base58, so `.length` is 43, not 32.
 */
function getRenderedByteLength(constant: ConstantValueNode): number | null {
    if (!isNode(constant.type, 'fixedSizeTypeNode')) return null;
    if (!isNode(constant.type.type, 'bytesTypeNode')) return null;
    if (!isNode(constant.value, 'bytesValueNode')) return null;
    // Same helper `visitBytesValue` builds the emitted array from, so the count cannot drift from it.
    return getBytesFromBytesValueNode(constant.value).length;
}

/** Width of a constant whose `.length` may stand in for it: only when rendered and wire widths agree. */
function getNamedByteSize(constant: ConstantValueNode, linkables: LinkableDictionary): number | null {
    const rendered = getRenderedByteLength(constant);
    return rendered !== null && rendered === getTypeByteSize(constant.type, linkables) ? rendered : null;
}

/**
 * Names the constants when their `.length`s sum to the full prefix width, else emits the width as a
 * literal. Only byte-rendering constants qualify, so the named form always evaluates to `extent`.
 */
function getOffsetFragment(
    scope: Pick<RenderScope, 'linkables' | 'nameApi'> & {
        constantSource?: `./${string}`;
        cpiFraming: ResolvedProgramEventFraming | undefined;
        discriminators: DiscriminatorNode[];
        event: EventNode;
        extent: number;
    },
): Fragment {
    const { constantSource, cpiFraming, discriminators, event, extent, linkables, nameApi } = scope;
    const constants = discriminators.filter(isNodeFilter('constantDiscriminatorNode'));

    if (cpiFraming) {
        let named = getNamedByteSize(cpiFraming.constant, linkables);
        for (const discriminator of constants) {
            const size = getNamedByteSize(discriminator.constant, linkables);
            if (named === null || size === null) {
                named = null;
                break;
            }
            named += size;
        }
        if (named !== extent) return fragment`${String(extent)}`;
        return getCpiFramedSkipExprFragment({
            constantSource,
            discriminators,
            eventName: event.name,
            nameApi,
            programEventFraming: cpiFraming,
        });
    }

    const leading = constants.find(d => d.offset === 0 && getNamedByteSize(d.constant, linkables) === extent);
    if (!leading) return fragment`${String(extent)}`;
    const name = nameApi.constant(getDiscriminatorConstantName(event.name, leading, discriminators));
    const constant = constantSource ? use(name, constantSource) : fragment`${name}`;
    return fragment`${constant}.length`;
}

/**
 * Whether an event can be identified and decoded: it needs a discriminator of its own and a
 * decode offset whose width is known at generation time.
 *
 * @see {@link isEventIdentifiable}
 * @see {@link getEventSkipExtent}
 */
export function isEventParsable(
    event: EventNode,
    programEventFraming: ResolvedProgramEventFraming | undefined,
    linkables: LinkableDictionary,
): boolean {
    return isEventIdentifiable(event, programEventFraming) && getEventSkipExtent(event, linkables) !== null;
}
