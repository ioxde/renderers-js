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
import { getProgramEventFraming, isEventCpiFramed, ResolvedProgramEventFraming } from './eventFraming';

export function getProgramEventsFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        programNode: ProgramNode;
    },
): Fragment | undefined {
    const events = (scope.programNode.events ?? []).filter(event => (event.discriminators ?? []).length > 0);
    if (events.length === 0) return;
    const programEventFraming = getProgramEventFraming(scope.programNode);
    return mergeFragments(
        [
            getProgramEventsEnumFragment({ ...scope, events }),
            getProgramEventsIdentifierFunctionFragment({ ...scope, events, programEventFraming }),
            getProgramEventsParsedUnionTypeFragment({ ...scope, events }),
            getProgramEventsParseFunctionFragment({ ...scope, events, programEventFraming }),
        ],
        c => c.join('\n\n'),
    );
}

function getEventFramingConstantFragment(
    programEventFraming: ResolvedProgramEventFraming,
    nameApi: RenderScope['nameApi'],
): Fragment {
    return use(nameApi.constant(camelCase(programEventFraming.framing.sharedConstantName)), 'generatedEvents');
}

function getProgramEventsEnumFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        events: EventNode[];
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, nameApi, events } = scope;
    const programEventsEnum = nameApi.programEventsEnum(programNode.name);
    const programEventsEnumVariants = events.map(event => nameApi.programEventsEnumVariant(event.name));
    return fragment`export enum ${programEventsEnum} { ${programEventsEnumVariants.join(', ')} }`;
}

function getProgramEventsIdentifierFunctionFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        events: EventNode[];
        programEventFraming: ResolvedProgramEventFraming | undefined;
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, nameApi, events, programEventFraming } = scope;

    const programEventsEnum = nameApi.programEventsEnum(programNode.name);
    const programEventsIdentifierFunction = nameApi.programEventsIdentifierFunction(programNode.name);

    const discriminatorsFragment = mergeFragments(
        events.map((event): Fragment => {
            const variant = nameApi.programEventsEnumVariant(event.name);
            const resolved = resolveNestedTypeNode(event.data);
            const struct: StructTypeNode = isNode(resolved, 'structTypeNode') ? resolved : structTypeNode([]);
            const isCpiFramed = isEventCpiFramed(event, programEventFraming);
            const allDiscriminators = event.discriminators ?? [];
            // Check the shared framing constant first, then the per-event discriminators.
            const leadingConditions = isCpiFramed
                ? [
                      fragment`${use('containsBytes', 'solanaCodecsCore')}(data, ${getEventFramingConstantFragment(programEventFraming!, nameApi)}, 0)`,
                  ]
                : [];
            return getDiscriminatorConditionFragment({
                ...scope,
                constantSource: 'generatedEvents',
                dataName: 'data',
                discriminators: isCpiFramed ? allDiscriminators.slice(1) : allDiscriminators,
                ifTrue: `return ${programEventsEnum}.${variant};`,
                leadingConditions,
                prefix: event.name,
                struct,
            });
        }),
        c => c.join('\n'),
    );

    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    return fragment`export function ${programEventsIdentifierFunction}(event: { data: ${readonlyUint8Array} } | ${readonlyUint8Array}): ${programEventsEnum} {
    const data = 'data' in event ? event.data : event;
    ${discriminatorsFragment}
    // TODO: Use SolanaError once event-specific error codes are added to @solana/errors.
    throw new Error('The provided event data does not match any known ${programNode.name} event.');
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
    const programEventsEnum = nameApi.programEventsEnum(programNode.name);

    const typeVariants = events.map((event): Fragment => {
        const eventEnumVariant = nameApi.programEventsEnumVariant(event.name);
        const eventDataType = use(`type ${nameApi.dataType(event.name)}`, 'generatedEvents');
        return fragment`| ({ eventType: ${programEventsEnum}.${eventEnumVariant} } & ${eventDataType})`;
    });

    return mergeFragments([fragment`export type ${programEventsParsedUnionType} =`, ...typeVariants], c =>
        c.join('\n'),
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

    const programEventsEnum = nameApi.programEventsEnum(programNode.name);
    const programEventsIdentifierFunction = nameApi.programEventsIdentifierFunction(programNode.name);
    const programEventsParsedUnionType = nameApi.programEventsParsedUnionType(programNode.name);
    const parseFunction = nameApi.programEventsParseFunction(programNode.name);

    const switchCases = mergeFragments(
        events.map((event): Fragment => {
            const enumVariant = nameApi.programEventsEnumVariant(event.name);
            const decoderFn = use(nameApi.decoderFunction(event.name), 'generatedEvents');
            const skipExpr = getHiddenPrefixSkipExpr(event, nameApi, programEventFraming);

            if (skipExpr) {
                return fragment`case ${programEventsEnum}.${enumVariant}: { return { eventType: ${programEventsEnum}.${enumVariant}, ...${decoderFn}().decode(data, ${skipExpr}) }; }`;
            }
            return fragment`case ${programEventsEnum}.${enumVariant}: { return { eventType: ${programEventsEnum}.${enumVariant}, ...${decoderFn}().decode(data) }; }`;
        }),
        c => c.join('\n'),
    );

    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    return fragment`export function ${parseFunction}(event: { data: ${readonlyUint8Array} } | ${readonlyUint8Array}): ${programEventsParsedUnionType} {
    const data = 'data' in event ? event.data : event;
    const eventType = ${programEventsIdentifierFunction}(event);
    switch (eventType) {
        ${switchCases}
        // TODO: Use SolanaError once event-specific error codes are added to @solana/errors.
        default: throw new Error('Unknown event type: ' + (eventType as string));
    }
}`;
}

function getHiddenPrefixSkipExpr(
    event: EventNode,
    nameApi: RenderScope['nameApi'],
    programEventFraming: ResolvedProgramEventFraming | undefined,
): Fragment | null {
    const isCpiFramed = isEventCpiFramed(event, programEventFraming);
    const allDiscriminators = event.discriminators ?? [];
    const discriminators = isCpiFramed ? allDiscriminators.slice(1) : allDiscriminators;
    const hasConstantDiscriminator = discriminators.some(d => isNode(d, 'constantDiscriminatorNode'));
    if ((!hasConstantDiscriminator && !isCpiFramed) || !isNode(event.data, 'hiddenPrefixTypeNode')) {
        return null;
    }
    if (isCpiFramed) {
        // Skip past the shared framing constant and every per-event constant discriminator.
        const framingConstant = getEventFramingConstantFragment(programEventFraming!, nameApi);
        const constantParts = discriminators
            .filter(d => isNode(d, 'constantDiscriminatorNode'))
            .map((_, index) => {
                const suffix = index <= 0 ? '' : `_${index + 1}`;
                const constant = use(
                    nameApi.constant(camelCase(`${event.name}_discriminator${suffix}`)),
                    'generatedEvents',
                );
                return fragment`${constant}.length`;
            });
        return mergeFragments([fragment`${framingConstant}.length`, ...constantParts], c => c.join(' + '));
    }
    const prefixes = event.data.prefix;
    if (prefixes.length === 1) {
        const discConstant = use(nameApi.constant(camelCase(`${event.name}_discriminator`)), 'generatedEvents');
        return fragment`${discConstant}.length`;
    }
    const totalSize = prefixes.reduce((sum, p) => sum + (isNode(p.type, 'fixedSizeTypeNode') ? p.type.size : 0), 0);
    return fragment`${String(totalSize)}`;
}
