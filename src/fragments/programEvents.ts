import {
    camelCase,
    EventNode,
    getAllInstructionsWithSubs,
    isDataEnum,
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
    getEventOwnDiscriminators,
    getProgramEventFraming,
    isEventIdentifiable,
    ResolvedProgramEventFraming,
} from './eventFraming';

/**
 * Events the identify/parse helpers can match. An event whose only discriminator is the
 * shared CPI framing would match every framed event, so it is excluded here and on its own page.
 */
function getParsableEvents(programNode: ProgramNode): EventNode[] {
    const programEventFraming = getProgramEventFraming(programNode);
    return (programNode.events ?? []).filter(event => isEventIdentifiable(event, programEventFraming));
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
    scope: Pick<RenderScope, 'nameApi' | 'renderParentInstructions' | 'typeManifestVisitor'> & {
        programNode: ProgramNode;
    },
): Fragment | undefined {
    if (!hasProgramEventsPage(scope.programNode)) return;

    const discriminatorKey = scope.nameApi.programEventsParsedDiscriminatorKey(scope.programNode.name);
    const dataKey = scope.nameApi.programEventsParsedDataKey(scope.programNode.name);
    if (discriminatorKey === dataKey) {
        throw new Error(
            `The programEventsParsedDiscriminatorKey and programEventsParsedDataKey name transformers ` +
                `both returned '${dataKey}'; they must be distinct.`,
        );
    }

    const events = getParsableEvents(scope.programNode);
    assertNoExportNameConflicts({ ...scope, events });
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

/**
 * Fails fast on export-name collisions across the events page and sibling parse helpers,
 * which the root barrel's `export *` would otherwise silently drop.
 */
function assertNoExportNameConflicts(
    scope: Pick<RenderScope, 'nameApi' | 'renderParentInstructions'> & {
        events: EventNode[];
        programNode: ProgramNode;
    },
): void {
    const { events, nameApi, programNode } = scope;
    const origins = new Map<string, string>();
    const register = (name: string, origin: string) => {
        const existing = origins.get(name);
        if (existing) {
            throw new Error(
                `Naming conflict in program '${programNode.name}': ${origin} generates the export ` +
                    `'${name}', which collides with ${existing}. Rename the conflicting node, or ` +
                    `override the relevant name transformers so the names differ.`,
            );
        }
        origins.set(name, origin);
    };

    for (const event of events) {
        register(nameApi.eventIsFunction(event.name), `event '${event.name}' (its is helper)`);
        register(nameApi.eventParseFunction(event.name), `event '${event.name}' (its parse helper)`);
    }
    register(nameApi.programEventsIdentifierFunction(programNode.name), 'the aggregate event identify helper');
    register(nameApi.programEventsParseFunction(programNode.name), 'the aggregate event parse helper');
    register(nameApi.programEventsTypeUnion(programNode.name), 'the aggregate event-type union');
    register(nameApi.programEventsParsedUnionType(programNode.name), 'the aggregate parsed-event union');
    for (const instruction of getAllInstructionsWithSubs(programNode, {
        leavesOnly: !scope.renderParentInstructions,
    })) {
        register(
            nameApi.instructionParseFunction(instruction.name),
            `instruction '${instruction.name}' (its parse helper)`,
        );
    }
    register(nameApi.programInstructionsParseFunction(programNode.name), 'the aggregate instruction parse helper');
    for (const definedType of programNode.definedTypes ?? []) {
        if (!isNode(definedType.type, 'enumTypeNode') || !isDataEnum(definedType.type)) continue;
        register(
            nameApi.discriminatedUnionFunction(definedType.name),
            `defined type '${definedType.name}' (its discriminated-union constructor)`,
        );
        register(
            nameApi.isDiscriminatedUnionFunction(definedType.name),
            `defined type '${definedType.name}' (its discriminated-union type guard)`,
        );
    }
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

    const eventCondition = (event: EventNode): Fragment => {
        const variant = nameApi.programEventsTypeVariant(event.name);
        const resolved = resolveNestedTypeNode(event.data);
        const struct: StructTypeNode = isNode(resolved, 'structTypeNode') ? resolved : structTypeNode([]);
        return getDiscriminatorConditionFragment({
            ...scope,
            constantSource: getEventModule(event),
            dataName: 'data',
            discriminators: getEventOwnDiscriminators(event, programEventFraming),
            ifTrue: `return '${variant}';`,
            prefix: event.name,
            struct,
        });
    };

    // Hoist the shared framing check so foreign data is rejected with a single compare.
    // Unframed events stay outside the block and remain reachable when the check fails.
    const framedEvents = events.filter(event => getEventCpiFraming(event, programEventFraming) !== undefined);
    const unframedEvents = events.filter(event => getEventCpiFraming(event, programEventFraming) === undefined);
    const framedBlock =
        framedEvents.length > 0 && programEventFraming
            ? [
                  fragment`if (${use('containsBytes', 'solanaCodecsCore')}(data, ${getEventFramingConstantFragment(programEventFraming.framing, nameApi, `./${getEventFramingFileName(programEventFraming.framing)}`)}, 0)) {
        ${mergeFragments(framedEvents.map(eventCondition), c => c.join('\n'))}
    }`,
              ]
            : [];
    const conditionsFragment = mergeFragments([...framedBlock, ...unframedEvents.map(eventCondition)], c =>
        c.join('\n'),
    );

    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    return fragment`/**
 * Identifies ${programNode.name} event data by its discriminators, without decoding.
 * Returns \`null\` when no known event matches. Never throws.
 */
export function ${programEventsIdentifierFunction}(data: ${readonlyUint8Array}): ${programEventsTypeUnion} | null {
    ${conditionsFragment}
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
    const discriminatorKey = nameApi.programEventsParsedDiscriminatorKey(programNode.name);
    const dataKey = nameApi.programEventsParsedDataKey(programNode.name);

    const typeVariants = events.map((event): Fragment => {
        const variant = nameApi.programEventsTypeVariant(event.name);
        const eventDataType = use(`type ${nameApi.dataType(event.name)}`, getEventModule(event));
        return fragment`| { ${discriminatorKey}: '${variant}'; ${dataKey}: ${eventDataType} }`;
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
    const discriminatorKey = nameApi.programEventsParsedDiscriminatorKey(programNode.name);
    const dataKey = nameApi.programEventsParsedDataKey(programNode.name);

    const switchCases = mergeFragments(
        events.map((event): Fragment => {
            const variant = nameApi.programEventsTypeVariant(event.name);
            const decoderFn = use(nameApi.decoderFunction(event.name), getEventModule(event));
            const skipExpr = getHiddenPrefixSkipExpr(event, nameApi, programEventFraming);

            if (skipExpr) {
                return fragment`case '${variant}': { return { ${discriminatorKey}: '${variant}', ${dataKey}: ${decoderFn}().decode(data, ${skipExpr}) }; }`;
            }
            return fragment`case '${variant}': { return { ${discriminatorKey}: '${variant}', ${dataKey}: ${decoderFn}().decode(data) }; }`;
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
export function ${parseFunction}(data: ${readonlyUint8Array}): ${programEventsParsedUnionType} | null {
    const eventType = ${programEventsIdentifierFunction}(data);
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
    const discriminators = getEventOwnDiscriminators(event, programEventFraming);
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
    const prefixes = event.data.prefix ?? [];
    if (prefixes.length === 1) {
        const discConstant = use(nameApi.constant(camelCase(`${event.name}_discriminator`)), getEventModule(event));
        return fragment`${discConstant}.length`;
    }
    const totalSize = prefixes.reduce((sum, p) => sum + (isNode(p.type, 'fixedSizeTypeNode') ? p.type.size : 0), 0);
    return fragment`${String(totalSize)}`;
}
