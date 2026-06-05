import { logWarn } from '@codama/errors';
import { camelCase, ConstantValueNode, EventFraming, EventNode, isNode, ProgramNode } from '@codama/nodes';

import { Fragment, fragment, mergeFragments, RenderScope } from '../utils';
import { getConstantValueConstantFragment } from './discriminatorConstants';

/** Resolved program-level framing: the hoisted prefix constant + its source `EventFraming`. */
export type ResolvedProgramEventFraming = { constant: ConstantValueNode; framing: EventFraming };

/**
 * Resolves the program's shared event framing by hoisting the first framed event's leading
 * hidden-prefix constant. Conflicting framings warn and the first one wins.
 */
export function getProgramEventFraming(programNode: ProgramNode): ResolvedProgramEventFraming | undefined {
    let resolved: ResolvedProgramEventFraming | undefined;
    for (const event of programNode.events ?? []) {
        if (!event.framing) continue;
        if (!isNode(event.data, 'hiddenPrefixTypeNode')) continue;
        if (event.data.prefix.length === 0) continue;
        if (!resolved) {
            resolved = { constant: event.data.prefix[0], framing: event.framing };
            continue;
        }
        if (resolved.framing.sharedConstantName !== event.framing.sharedConstantName) {
            logWarn(
                `Program [${programNode.name}] has events with conflicting event framings ` +
                    `('${resolved.framing.sharedConstantName}' vs '${event.framing.sharedConstantName}'). ` +
                    `Only the first will be hoisted.`,
            );
            break;
        }
    }
    return resolved;
}

/** Whether an event participates in the program's hoisted CPI framing. */
export function isEventCpiFramed(
    event: EventNode,
    programEventFraming: ResolvedProgramEventFraming | undefined,
): boolean {
    if (programEventFraming === undefined) return false;
    if (!event.framing) return false;
    if (event.framing.sharedConstantName !== programEventFraming.framing.sharedConstantName) return false;
    if (!isNode(event.data, 'hiddenPrefixTypeNode')) return false;
    return event.data.prefix.length > 0;
}

/** File name (without extension) of the page hosting the shared framing constant. */
export function getEventFramingFileName(framing: EventFraming): string {
    return camelCase(framing.sharedConstantName);
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
