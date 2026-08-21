import { DiscriminatorNode, EventNode, isNode, isNodeFilter, StructTypeNode, TypeNode } from '@codama/nodes';

import { Fragment, fragment, RenderScope, use } from '../utils';
import { getDiscriminatorConstantName } from './discriminatorConstants';
import {
    getCpiFramedSkipExprFragment,
    getEventCpiFraming,
    getEventOwnDiscriminators,
    isEventIdentifiable,
    ResolvedProgramEventFraming,
} from './eventFraming';

const NUMBER_BYTE_SIZES: Record<string, number> = {
    f32: 4,
    f64: 8,
    i128: 16,
    i16: 2,
    i32: 4,
    i64: 8,
    i8: 1,
    u128: 16,
    u16: 2,
    u32: 4,
    u64: 8,
    u8: 1,
};

function getTypeByteSize(type: TypeNode): number | null {
    if (isNode(type, 'fixedSizeTypeNode')) return type.size;
    if (isNode(type, 'numberTypeNode')) return NUMBER_BYTE_SIZES[type.format] ?? null;
    if (
        isNode(type, 'arrayTypeNode') &&
        isNode(type.item, 'numberTypeNode') &&
        type.item.format === 'u8' &&
        isNode(type.count, 'fixedCountNode')
    ) {
        return type.count.value;
    }
    return null;
}

/**
 * Leading bytes the decode offset consumes, or `null` when a prefix entry has no statically
 * known width — the offset then cannot be reconciled with the gate in front of it.
 *
 * @see {@link isEventParsable}
 */
export function getEventSkipExtent(
    event: EventNode,
    programEventFraming: ResolvedProgramEventFraming | undefined,
): number | null {
    const cpiFraming = getEventCpiFraming(event, programEventFraming);
    if (cpiFraming) {
        const framingSize = getTypeByteSize(cpiFraming.constant.type);
        if (framingSize === null) return null;
        let total = framingSize;
        for (const discriminator of getEventOwnDiscriminators(event, programEventFraming).filter(
            isNodeFilter('constantDiscriminatorNode'),
        )) {
            const size = getTypeByteSize(discriminator.constant.type);
            if (size === null) return null;
            total += size;
        }
        return total;
    }
    if (!isNode(event.data, 'hiddenPrefixTypeNode')) return 0;
    let total = 0;
    for (const entry of event.data.prefix ?? []) {
        const size = getTypeByteSize(entry.type);
        if (size === null) return null;
        total += size;
    }
    return total;
}

/** Bytes the gate proves present: the furthest end offset any check requires. */
function getGateByteExtent(scope: {
    discriminators: DiscriminatorNode[];
    framingSize: number | null;
    struct: StructTypeNode;
}): number {
    return scope.discriminators.reduce((extent, discriminator) => {
        const end = getDiscriminatorEndOffset(discriminator, scope.struct);
        return end !== null && end > extent ? end : extent;
    }, scope.framingSize ?? 0);
}

function getDiscriminatorEndOffset(discriminator: DiscriminatorNode, struct: StructTypeNode): number | null {
    if (isNode(discriminator, 'sizeDiscriminatorNode')) return discriminator.size;
    if (isNode(discriminator, 'constantDiscriminatorNode')) {
        const size = getTypeByteSize(discriminator.constant.type);
        return size === null ? null : discriminator.offset + size;
    }
    if (isNode(discriminator, 'fieldDiscriminatorNode')) {
        const field = (struct.fields ?? []).find(f => f.name === discriminator.name);
        const size = field ? getTypeByteSize(field.type) : null;
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
 * offset from somewhere else. `containsBytes` proves `offset + constant.length` bytes, so a gate
 * whose checks already reach the offset gets no clause.
 */
export function getEventSkip(
    scope: Pick<RenderScope, 'nameApi'> & {
        /** Module hosting the per-event constants; omit when they live on the same page. */
        constantSource?: `./${string}`;
        event: EventNode;
        programEventFraming: ResolvedProgramEventFraming | undefined;
        struct: StructTypeNode;
    },
): EventSkip {
    const { constantSource, event, nameApi, programEventFraming, struct } = scope;
    const extent = getEventSkipExtent(event, programEventFraming);
    if (extent === null || extent === 0) {
        return { lengthClause: undefined, offset: undefined };
    }

    const cpiFraming = getEventCpiFraming(event, programEventFraming);
    const discriminators = getEventOwnDiscriminators(event, programEventFraming);
    const offset = cpiFraming
        ? getCpiFramedSkipExprFragment({
              constantSource,
              discriminators,
              eventName: event.name,
              nameApi,
              programEventFraming: cpiFraming,
          })
        : getUnframedOffsetFragment({ constantSource, discriminators, event, extent, nameApi });

    const gateExtent = getGateByteExtent({
        discriminators,
        framingSize: cpiFraming ? getTypeByteSize(cpiFraming.constant.type) : null,
        struct,
    });
    return {
        lengthClause: gateExtent >= extent ? undefined : fragment`data.length >= ${offset}`,
        offset,
    };
}

function getUnframedOffsetFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        constantSource?: `./${string}`;
        discriminators: DiscriminatorNode[];
        event: EventNode;
        extent: number;
    },
): Fragment {
    const { constantSource, discriminators, event, extent, nameApi } = scope;
    const leading = discriminators
        .filter(isNodeFilter('constantDiscriminatorNode'))
        .find(d => d.offset === 0 && getTypeByteSize(d.constant.type) === extent);
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
): boolean {
    return isEventIdentifiable(event, programEventFraming) && getEventSkipExtent(event, programEventFraming) !== null;
}
