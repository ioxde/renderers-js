import {
    camelCase,
    EventNode,
    isNode,
    ProgramNode,
    resolveNestedTypeNode,
    type StructTypeNode,
    structTypeNode,
} from '@codama/nodes';

import { Fragment, fragment, mergeFragments, RenderScope, use } from '../utils';
import { getDiscriminatorConditionFragment } from './discriminatorCondition';
import {
    getCpiFramedSkipExprFragment,
    getEventCpiFraming,
    getEventFramingConstantFragment,
    getEventFramingFileName,
    getProgramEventFraming,
    ResolvedProgramEventFraming,
} from './eventFraming';

/** Only events with discriminators can be matched by the identify/parse helpers. */
function getParsableEvents(programNode: ProgramNode): EventNode[] {
    return (programNode.events ?? []).filter(event => (event.discriminators ?? []).length > 0);
}

/**
 * File name (without extension) of the aggregate events page hosting the identify/parse helpers.
 * Dotted names cannot collide with event pages, which are plain camelCase.
 */
export function getProgramEventsFileName(programNode: ProgramNode): `${string}.events` {
    return `${camelCase(programNode.name)}.events`;
}

/** Whether the aggregate events page renders for this program. */
export function hasProgramEventsPage(programNode: ProgramNode): boolean {
    return getParsableEvents(programNode).length > 0;
}

/** Import path of an event's page, relative to the events folder. */
function getEventModule(event: EventNode): `./${string}` {
    return `./${camelCase(event.name)}`;
}

/**
 * Renders a program's aggregate events page: the event-type union plus the `identify*`
 * and `parse*` helpers. Both helpers return `null` when no known event matches.
 */
export function getProgramEventsPageFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        programNode: ProgramNode;
    },
): Fragment | undefined {
    if (!hasProgramEventsPage(scope.programNode)) return;
    const events = getParsableEvents(scope.programNode);
    const programEventFraming = getProgramEventFraming(scope.programNode);
    return mergeFragments(
        [
            getProgramEventsTypeUnionFragment({ ...scope, events }),
            getProgramEventsIdentifierFunctionFragment({ ...scope, events, programEventFraming }),
            getProgramEventsParsedUnionTypeFragment({ ...scope, events }),
            getProgramEventsParseFunctionFragment({ ...scope, events, programEventFraming }),
        ],
        c => c.join('\n\n'),
    );
}

function getProgramEventsTypeUnionFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        events: EventNode[];
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, nameApi, events } = scope;
    const programEventsTypeUnion = nameApi.programEventsTypeUnion(programNode.name);
    const programEventsTypeVariants = events.map(event => `'${nameApi.programEventsTypeVariant(event.name)}'`);
    return fragment`/** Event kinds of the ${programNode.name} program. */
export type ${programEventsTypeUnion} = ${programEventsTypeVariants.join(' | ')};`;
}

function getProgramEventsIdentifierFunctionFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        events: EventNode[];
        programEventFraming: ResolvedProgramEventFraming | undefined;
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, nameApi, events, programEventFraming } = scope;

    const programEventsTypeUnion = nameApi.programEventsTypeUnion(programNode.name);
    const programEventsIdentifierFunction = nameApi.programEventsIdentifierFunction(programNode.name);

    const discriminatorsFragment = mergeFragments(
        events.map((event): Fragment => {
            const variant = nameApi.programEventsTypeVariant(event.name);
            const resolved = resolveNestedTypeNode(event.data);
            const struct: StructTypeNode = isNode(resolved, 'structTypeNode') ? resolved : structTypeNode([]);
            const cpiFraming = getEventCpiFraming(event, programEventFraming);
            const allDiscriminators = event.discriminators ?? [];
            // Check the shared framing constant first, then the per-event discriminators.
            const leadingConditions = cpiFraming
                ? [
                      fragment`${use('containsBytes', 'solanaCodecsCore')}(data, ${getEventFramingConstantFragment(cpiFraming.framing, nameApi, `./${getEventFramingFileName(cpiFraming.framing)}`)}, 0)`,
                  ]
                : [];
            return getDiscriminatorConditionFragment({
                ...scope,
                constantSource: getEventModule(event),
                dataName: 'data',
                discriminators: cpiFraming ? allDiscriminators.slice(1) : allDiscriminators,
                ifTrue: `return '${variant}';`,
                leadingConditions,
                prefix: event.name,
                struct,
            });
        }),
        c => c.join('\n'),
    );

    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    return fragment`/**
 * Identifies ${programNode.name} event data by its discriminators.
 * Returns \`null\` when the data matches no known event.
 */
export function ${programEventsIdentifierFunction}(event: { data: ${readonlyUint8Array} } | ${readonlyUint8Array}): ${programEventsTypeUnion} | null {
    const data = 'data' in event ? event.data : event;
    ${discriminatorsFragment}
    return null;
}`;
}

function getProgramEventsParsedUnionTypeFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        events: EventNode[];
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, nameApi, events } = scope;
    const programEventsParsedUnionType = nameApi.programEventsParsedUnionType(programNode.name);

    const typeVariants = events.map((event): Fragment => {
        const variant = nameApi.programEventsTypeVariant(event.name);
        const eventDataType = use(`type ${nameApi.dataType(event.name)}`, getEventModule(event));
        return fragment`| { eventType: '${variant}'; data: ${eventDataType} }`;
    });

    return mergeFragments(
        [
            fragment`/** Parsed ${programNode.name} event: the event kind tag plus its decoded payload. */
export type ${programEventsParsedUnionType} =`,
            ...typeVariants,
        ],
        c => c.join('\n'),
    );
}

function getProgramEventsParseFunctionFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        events: EventNode[];
        programEventFraming: ResolvedProgramEventFraming | undefined;
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, nameApi, events, programEventFraming } = scope;

    const programEventsIdentifierFunction = nameApi.programEventsIdentifierFunction(programNode.name);
    const programEventsParsedUnionType = nameApi.programEventsParsedUnionType(programNode.name);
    const parseFunction = nameApi.programEventsParseFunction(programNode.name);

    const switchCases = mergeFragments(
        events.map((event): Fragment => {
            const variant = nameApi.programEventsTypeVariant(event.name);
            const decoderFn = use(nameApi.decoderFunction(event.name), getEventModule(event));
            const skipExpr = getHiddenPrefixSkipExpr(event, nameApi, programEventFraming);

            if (skipExpr) {
                return fragment`case '${variant}': { return { eventType: '${variant}', data: ${decoderFn}().decode(data, ${skipExpr}) }; }`;
            }
            return fragment`case '${variant}': { return { eventType: '${variant}', data: ${decoderFn}().decode(data) }; }`;
        }),
        c => c.join('\n'),
    );

    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    // No default case: the switch is exhaustive over the identified event type.
    // Decoder errors propagate: a matched discriminator with a corrupt body should throw, not return null.
    return fragment`/**
 * Parses ${programNode.name} event data into its event kind and decoded payload.
 * Returns \`null\` when no known event matches; throws if a matched event fails to decode.
 */
export function ${parseFunction}(event: { data: ${readonlyUint8Array} } | ${readonlyUint8Array}): ${programEventsParsedUnionType} | null {
    const data = 'data' in event ? event.data : event;
    const eventType = ${programEventsIdentifierFunction}(event);
    if (eventType === null) return null;
    switch (eventType) {
        ${switchCases}
    }
}`;
}

function getHiddenPrefixSkipExpr(
    event: EventNode,
    nameApi: RenderScope['nameApi'],
    programEventFraming: ResolvedProgramEventFraming | undefined,
): Fragment | null {
    const cpiFraming = getEventCpiFraming(event, programEventFraming);
    const allDiscriminators = event.discriminators ?? [];
    const discriminators = cpiFraming ? allDiscriminators.slice(1) : allDiscriminators;
    const hasConstantDiscriminator = discriminators.some(d => isNode(d, 'constantDiscriminatorNode'));
    if ((!hasConstantDiscriminator && !cpiFraming) || !isNode(event.data, 'hiddenPrefixTypeNode')) {
        return null;
    }
    if (cpiFraming) {
        return getCpiFramedSkipExprFragment({
            constantSource: getEventModule(event),
            discriminators,
            eventName: event.name,
            nameApi,
            programEventFraming: cpiFraming,
        });
    }
    const prefixes = event.data.prefix;
    if (prefixes.length === 1) {
        const discConstant = use(nameApi.constant(camelCase(`${event.name}_discriminator`)), getEventModule(event));
        return fragment`${discConstant}.length`;
    }
    const totalSize = prefixes.reduce((sum, p) => sum + (isNode(p.type, 'fixedSizeTypeNode') ? p.type.size : 0), 0);
    return fragment`${String(totalSize)}`;
}
