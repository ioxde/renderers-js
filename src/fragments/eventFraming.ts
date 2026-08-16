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

/** An event's own framing candidate, or `undefined` when the shape the CPI-framed renderers need does not hold and callers must render unframed. */
function getEventOwnFraming(event: EventNode): ResolvedProgramEventFraming | undefined {
    if (!event.framing) return undefined;
    if (!isNode(event.data, 'hiddenPrefixTypeNode')) return undefined;
    const [firstPrefix] = event.data.prefix ?? [];
    if (!firstPrefix) return undefined;
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
 * Hoists the first framed event's leading hidden-prefix constant as the program's shared framing.
 * Conflicting framing names or constant values warn and the first wins; the diverging events render unframed.
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
 * Discriminators that distinguish this event from other framed events: the hoisted
 * framing discriminator is excluded since it is shared by every framed event.
 */
export function getEventOwnDiscriminators(
    event: EventNode,
    programEventFraming: ResolvedProgramEventFraming | undefined,
): DiscriminatorNode[] {
    const all = event.discriminators ?? [];
    return getEventCpiFraming(event, programEventFraming) ? all.slice(1) : all;
}

/**
 * Whether the event has at least one discriminator beyond the shared framing, which is
 * the same bytes on every framed event and so cannot identify one.
 */
export function isEventIdentifiable(
    event: EventNode,
    programEventFraming: ResolvedProgramEventFraming | undefined,
): boolean {
    return getEventOwnDiscriminators(event, programEventFraming).length > 0;
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
    const constantName = scope.nameApi.constant(camelCase(framing.sharedConstantName));
    return mergeFragments(
        [
            fragment`/**
 * Shared event-framing tag prepended to every CPI-framed event.
 *
 * \`containsBytes(data, ${constantName}, 0)\` checks whether data is a framed event
 * at all — including event kinds unknown to this program.
 */`,
            getConstantValueConstantFragment(camelCase(framing.sharedConstantName), constant, scope),
        ],
        cs => cs.join('\n'),
    );
}
