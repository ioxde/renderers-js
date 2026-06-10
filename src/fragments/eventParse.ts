import {
    camelCase,
    DiscriminatorNode,
    EventNode,
    isNode,
    ProgramNode,
    resolveNestedTypeNode,
    structTypeNode,
} from '@codama/nodes';

import { Fragment, fragment, RenderScope, use } from '../utils';
import { getDiscriminatorConditionExprFragment } from './discriminatorCondition';
import {
    getCpiFramedSkipExprFragment,
    getEventCpiFraming,
    getEventFramingConstantFragment,
    getEventFramingFileName,
    getEventOwnDiscriminators,
    ResolvedProgramEventFraming,
} from './eventFraming';

/**
 * Renders the per-event `is*` and `parse*` functions: `is*` checks the framing and
 * discriminator bytes without decoding, and `parse*` decodes matching event data,
 * returning `null` on mismatch and letting decoder errors propagate.
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
    const condition = getDiscriminatorConditionExprFragment({
        ...scope,
        constantSource: 'generatedEvents',
        dataName: 'data',
        discriminators,
        leadingConditions,
        prefix: eventNode.name,
        struct,
    });

    const isFunction = nameApi.eventIsFunction(eventNode.name);
    const parseFunction = nameApi.eventParseFunction(eventNode.name);
    const strictType = nameApi.dataType(eventNode.name);
    const decoderFunction = nameApi.decoderFunction(eventNode.name);
    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    const skipExpr = getDecodeSkipExpr(eventNode, nameApi, cpiFraming, discriminators);
    const decodeArgs = skipExpr ? fragment`data, ${skipExpr}` : fragment`data`;
    const isFramed = cpiFraming !== undefined;
    const isDocblock = getIsDocblock(eventNode, nameApi, isFramed);
    const parseDocblock = getParseDocblock(eventNode, nameApi, isFramed, programNode);

    return fragment`${isDocblock}
export function ${isFunction}(data: ${readonlyUint8Array}): boolean {
  return ${condition};
}

${parseDocblock}
export function ${parseFunction}(data: ${readonlyUint8Array}): ${strictType} | null {
  if (!${isFunction}(data)) {
    return null;
  }
  return ${decoderFunction}().decode(${decodeArgs});
}`;
}

/** Offset of the borsh body: the validated prefixes are skipped, the rest is decoded. */
function getDecodeSkipExpr(
    eventNode: EventNode,
    nameApi: RenderScope['nameApi'],
    cpiFraming: ResolvedProgramEventFraming | undefined,
    discriminators: DiscriminatorNode[],
): Fragment | undefined {
    if (cpiFraming) {
        return getCpiFramedSkipExprFragment({
            discriminators,
            eventName: eventNode.name,
            nameApi,
            programEventFraming: cpiFraming,
        });
    }
    if (!isNode(eventNode.data, 'hiddenPrefixTypeNode')) return undefined;
    if (eventNode.data.prefix.length === 1) {
        const firstDiscConstant = nameApi.constant(camelCase(`${eventNode.name}_discriminator`));
        return fragment`${firstDiscConstant}.length`;
    }
    const totalSize = eventNode.data.prefix.reduce(
        (sum, p) => sum + (isNode(p.type, 'fixedSizeTypeNode') ? p.type.size : 0),
        0,
    );
    return fragment`${String(totalSize)}`;
}

function getIsDocblock(eventNode: EventNode, nameApi: RenderScope['nameApi'], isFramed: boolean): string {
    const strictType = nameApi.dataType(eventNode.name);
    const checkedBytes = isFramed ? 'framing and discriminator' : 'discriminator';
    return [
        '/**',
        ` * Checks whether the event data matches the ${checkedBytes} bytes of a`,
        ` * {@link ${strictType}}, without decoding. Never throws.`,
        ' *',
        ` * @see ${nameApi.eventParseFunction(eventNode.name)} to decode the matching data`,
        ' */',
    ].join('\n');
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
        ' *',
        ` * @see ${nameApi.eventIsFunction(eventNode.name)} to check without decoding`,
    ];
    if (programNode) {
        lines.push(
            ` * @see ${nameApi.programEventsIdentifierFunction(programNode.name)} to identify any program event`,
            ` * @see ${nameApi.programEventsParseFunction(programNode.name)}`,
        );
    }
    lines.push(' */');
    return lines.join('\n');
}
