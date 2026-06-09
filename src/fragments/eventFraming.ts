import { logWarn } from '@codama/errors';
import {
    camelCase,
    CamelCaseString,
    ConstantValueNode,
    DiscriminatorNode,
    EventFraming,
    EventNode,
    isNode,
    isNodeFilter,
    ProgramNode,
} from '@codama/nodes';

import { Fragment, fragment, mergeFragments, RenderScope, use } from '../utils';
import { getConstantValueConstantFragment, getDiscriminatorConstantName } from './discriminatorConstants';

/** Resolved program-level framing: the hoisted prefix constant + its source `EventFraming`. */
export type ResolvedProgramEventFraming = { constant: ConstantValueNode; framing: EventFraming };

/**
 * Extracts an event's own framing candidate, requiring the structural shape the CPI-framed
 * renderers rely on: a hidden-prefix data node whose leading constant is also the event's
 * first discriminator, at offset 0. Returns `undefined` when the shape does not hold so
 * callers fall back to unframed rendering.
 */
function getEventOwnFraming(event: EventNode): ResolvedProgramEventFraming | undefined {
    if (!event.framing) return undefined;
    if (!isNode(event.data, 'hiddenPrefixTypeNode')) return undefined;
    if (event.data.prefix.length === 0) return undefined;
    const [firstPrefix] = event.data.prefix;
    const [firstDiscriminator] = event.discriminators ?? [];
    if (!isNode(firstDiscriminator, 'constantDiscriminatorNode')) return undefined;
    if ((firstDiscriminator.offset ?? 0) !== 0) return undefined;
    if (!constantValueNodesMatch(firstDiscriminator.constant, firstPrefix)) return undefined;
    return { constant: firstPrefix, framing: event.framing };
}

function constantValueNodesMatch(a: ConstantValueNode, b: ConstantValueNode): boolean {
    return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Resolves the program's shared event framing by hoisting the first framed event's leading
 * hidden-prefix constant. Conflicting framing names or diverging constant values warn and
 * the first one wins; diverging events fall back to unframed rendering.
 */
export function getProgramEventFraming(programNode: ProgramNode): ResolvedProgramEventFraming | undefined {
    let resolved: ResolvedProgramEventFraming | undefined;
    for (const event of programNode.events ?? []) {
        const candidate = getEventOwnFraming(event);
        if (!candidate) continue;
        if (!resolved) {
            resolved = candidate;
            continue;
        }
        if (resolved.framing.sharedConstantName !== candidate.framing.sharedConstantName) {
            logWarn(
                `Program [${programNode.name}] has events with conflicting event framings ` +
                    `('${resolved.framing.sharedConstantName}' vs '${candidate.framing.sharedConstantName}'). ` +
                    `Only the first will be hoisted.`,
            );
            continue;
        }
        if (!constantValueNodesMatch(resolved.constant, candidate.constant)) {
            logWarn(
                `Program [${programNode.name}] has events sharing the framing constant ` +
                    `'${resolved.framing.sharedConstantName}' with diverging constant values. ` +
                    `Event [${event.name}] will fall back to unframed rendering.`,
            );
        }
    }
    return resolved;
}

/**
 * Resolves the event's participation in the program's hoisted CPI framing. Returns the
 * resolved framing when the event is framed by it, or `undefined` when the event should
 * be rendered unframed.
 */
export function getEventCpiFraming(
    event: EventNode,
    programEventFraming: ResolvedProgramEventFraming | undefined,
): ResolvedProgramEventFraming | undefined {
    if (!programEventFraming) return undefined;
    const own = getEventOwnFraming(event);
    if (!own) return undefined;
    if (own.framing.sharedConstantName !== programEventFraming.framing.sharedConstantName) return undefined;
    if (!constantValueNodesMatch(own.constant, programEventFraming.constant)) return undefined;
    return programEventFraming;
}

/**
 * File name (without extension) of the page hosting the shared framing constant.
 * Dotted names cannot collide with event pages, which are plain camelCase.
 */
export function getEventFramingFileName(framing: EventFraming): `${string}.framing` {
    return `${camelCase(framing.sharedConstantName)}.framing`;
}

/** References the hoisted framing constant, importing it from the given module. */
export function getEventFramingConstantFragment(
    framing: EventFraming,
    nameApi: RenderScope['nameApi'],
    importFrom: string,
): Fragment {
    return use(nameApi.constant(camelCase(framing.sharedConstantName)), importFrom);
}

/**
 * Builds the decode offset of a CPI-framed event: the shared framing constant plus every
 * per-event constant discriminator.
 */
export function getCpiFramedSkipExprFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        /** Module hosting the per-event constants; omit when they live on the same page. */
        constantSource?: `./${string}`;
        /** Event discriminators with the hoisted framing discriminator already dropped. */
        discriminators: DiscriminatorNode[];
        eventName: CamelCaseString;
        programEventFraming: ResolvedProgramEventFraming;
    },
): Fragment {
    const { constantSource, discriminators, eventName, nameApi, programEventFraming } = scope;
    // Callers always render under the events folder, so the framing constant is a sibling page.
    const framingConstant = getEventFramingConstantFragment(
        programEventFraming.framing,
        nameApi,
        `./${getEventFramingFileName(programEventFraming.framing)}`,
    );
    const constantParts = discriminators.filter(isNodeFilter('constantDiscriminatorNode')).map(disc => {
        const name = nameApi.constant(getDiscriminatorConstantName(eventName, disc, discriminators));
        const constant = constantSource ? use(name, constantSource) : fragment`${name}`;
        return fragment`${constant}.length`;
    });
    return mergeFragments([fragment`${framingConstant}.length`, ...constantParts], c => c.join(' + '));
}

/** Renders the standalone page hosting the program's shared framing constant. */
export function getEventFramingPageFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        programEventFraming: ResolvedProgramEventFraming;
    },
): Fragment {
    const { constant, framing } = scope.programEventFraming;
    return mergeFragments(
        [
            fragment`/** Shared event-framing tag prepended to every CPI-framed event. */`,
            getConstantValueConstantFragment(camelCase(framing.sharedConstantName), constant, scope),
        ],
        cs => cs.join('\n'),
    );
}
