import { EventNode, isNode, ProgramNode, resolveNestedTypeNode, structTypeNode } from '@codama/nodes';

import { Fragment, fragment, mergeFragments, RenderScope, use } from '../utils';
import { getDiscriminatorConditionExprFragment } from './discriminatorCondition';
import {
    getEventCpiFraming,
    getEventFramingConstantFragment,
    getEventFramingFileName,
    getEventOwnDiscriminators,
    ResolvedProgramEventFraming,
} from './eventFraming';
import { getEventSkip } from './eventSkip';

/**
 * Renders the per-event `is*` and `parse*` functions: `is*` checks the emitting program,
 * the framing and the discriminator bytes without decoding, and `parse*` decodes matching
 * event data, returning `null` on mismatch and letting decoder errors propagate.
 */
export function getEventParseFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        eventNode: EventNode;
        programEventFraming?: ResolvedProgramEventFraming;
        programNode?: ProgramNode;
    },
): Fragment {
    const { eventNode, nameApi, programEventFraming, programNode } = scope;
    const cpiFraming = getEventCpiFraming(eventNode, programEventFraming);
    const discriminators = getEventOwnDiscriminators(eventNode, programEventFraming);

    const resolved = resolveNestedTypeNode(eventNode.data);
    const struct = isNode(resolved, 'structTypeNode') ? resolved : structTypeNode([]);

    // Check the shared framing constant first, then the per-event discriminators.
    const leadingConditions = cpiFraming
        ? [
              fragment`${use('containsBytes', 'solanaCodecsCore')}(data, ${getEventFramingConstantFragment(cpiFraming.framing, nameApi, `./${getEventFramingFileName(cpiFraming.framing)}`)}, 0)`,
          ]
        : [];
    const skip = getEventSkip({ ...scope, event: eventNode, programEventFraming, struct });
    const condition = getDiscriminatorConditionExprFragment({
        ...scope,
        constantSource: 'generatedEvents',
        dataName: 'data',
        discriminators,
        leadingConditions,
        prefix: eventNode.name,
        struct,
        trailingConditions: skip.lengthClause ? [skip.lengthClause] : [],
    });

    const isFunction = nameApi.eventIsFunction(eventNode.name);
    const parseFunction = nameApi.eventParseFunction(eventNode.name);
    const strictType = nameApi.dataType(eventNode.name);
    const decoderFunction = nameApi.decoderFunction(eventNode.name);
    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    const decodeArgs = skip.offset ? fragment`data, ${skip.offset}` : fragment`data`;
    const isFramed = cpiFraming !== undefined;
    const isDocblock = getIsDocblock(eventNode, nameApi, isFramed, programNode);
    const parseDocblock = getParseDocblock(eventNode, nameApi, isFramed, programNode);

    // Discriminators collide across programs, so the object arm carries its emitter. `programAddress`
    // is required, not optional: an optional field lets the check be skipped by call shape.
    const params = programNode
        ? fragment`event: { data: ${readonlyUint8Array}; programAddress: ${use('type Address', 'solanaAddresses')} } | ${readonlyUint8Array}`
        : fragment`data: ${readonlyUint8Array}`;
    // The guard lives here only: `parse*` delegates to `is*`, so the two cannot drift.
    const isBody = programNode
        ? mergeFragments(
              [
                  fragment`if ('data' in event && event.programAddress !== ${use(nameApi.programAddressConstant(programNode.name), 'generatedPrograms')}) return false;`,
                  fragment`const data = 'data' in event ? event.data : event;`,
                  fragment`return ${condition};`,
              ],
              c => c.join('\n'),
          )
        : fragment`return ${condition};`;
    // Snapshot the object arm before checking it, then decode from that snapshot: an object with
    // getters could otherwise return different bytes to the guard and to the decoder.
    const parseBody = programNode
        ? mergeFragments(
              [
                  fragment`const checkedEvent = 'data' in event ? { data: event.data, programAddress: event.programAddress } : event;`,
                  fragment`if (!${isFunction}(checkedEvent)) {\n  return null;\n}`,
                  fragment`const data = 'data' in checkedEvent ? checkedEvent.data : checkedEvent;`,
                  fragment`return ${decoderFunction}().decode(${decodeArgs});`,
              ],
              c => c.join('\n'),
          )
        : mergeFragments(
              [
                  fragment`if (!${isFunction}(data)) {\n  return null;\n}`,
                  fragment`return ${decoderFunction}().decode(${decodeArgs});`,
              ],
              c => c.join('\n'),
          );

    return fragment`${isDocblock}
export function ${isFunction}(${params}): boolean {
  ${isBody}
}

${parseDocblock}
export function ${parseFunction}(${params}): ${strictType} | null {
  ${parseBody}
}`;
}

function getIsDocblock(
    eventNode: EventNode,
    nameApi: RenderScope['nameApi'],
    isFramed: boolean,
    programNode: ProgramNode | undefined,
): string {
    const strictType = nameApi.dataType(eventNode.name);
    const checkedBytes = isFramed ? 'framing and discriminator' : 'discriminator';
    const lines = [
        '/**',
        ` * Checks whether the event data matches the ${checkedBytes} bytes of a`,
        ` * {@link ${strictType}}, without decoding. Never throws.`,
    ];
    if (programNode) {
        lines.push(
            ' *',
            ` * Returns \`false\` unless \`event.programAddress\` is ${nameApi.programAddressConstant(programNode.name)}.`,
            ' * Raw bytes carry no emitter and SKIP that check.',
        );
    }
    lines.push(' *', ` * @see ${nameApi.eventParseFunction(eventNode.name)} to decode the matching data`, ' */');
    return lines.join('\n');
}

function getParseDocblock(
    eventNode: EventNode,
    nameApi: RenderScope['nameApi'],
    isFramed: boolean,
    programNode: ProgramNode | undefined,
): string {
    const strictType = nameApi.dataType(eventNode.name);
    const mismatchKinds = isFramed ? 'framing or discriminator' : 'discriminator';
    const lines = [
        '/**',
        ` * Parses raw event data as a {@link ${strictType}}. Returns \`null\` on ${mismatchKinds}`,
        ' * mismatch; throws if the event matches but its body fails to decode.',
    ];
    if (programNode) {
        lines.push(
            ' *',
            ` * Returns \`null\` unless \`event.programAddress\` is ${nameApi.programAddressConstant(programNode.name)}.`,
            ' * Raw bytes carry no emitter and SKIP that check.',
        );
    }
    lines.push(' *', ` * @see ${nameApi.eventIsFunction(eventNode.name)} to check without decoding`);
    if (programNode) {
        lines.push(
            ` * @see ${nameApi.programEventsIdentifierFunction(programNode.name)} to identify any program event`,
            ` * @see ${nameApi.programEventsParseFunction(programNode.name)}`,
        );
    }
    lines.push(' */');
    return lines.join('\n');
}
