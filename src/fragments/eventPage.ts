import { logWarn } from '@codama/errors';
import {
    camelCase,
    definedTypeNode,
    EventNode,
    isNode,
    isNodeFilter,
    ProgramNode,
    resolveNestedTypeNode,
} from '@codama/nodes';
import { pipe, visit } from '@codama/visitors-core';

import { Fragment, fragment, getDocblockFragment, mergeFragments, removeFragmentImports, RenderScope } from '../utils';
import { getDiscriminatorConstantName, getDiscriminatorConstantsFragment } from './discriminatorConstants';
import {
    getEventCpiFraming,
    getEventOwnDiscriminators,
    isEventIdentifiable,
    ResolvedProgramEventFraming,
} from './eventFraming';
import { getEventParseFragment } from './eventParse';
import { getTypeDecoderFragment } from './typeDecoder';

export function getEventPageFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        eventNode: EventNode;
        programEventFraming?: ResolvedProgramEventFraming;
        programNode?: ProgramNode;
        size: number | null;
    },
): Fragment {
    const node = scope.eventNode;
    const innerType = resolveNestedTypeNode(node.data);
    const syntheticType = definedTypeNode({ docs: node.docs, name: node.name, type: innerType });
    const typeManifest = visit(syntheticType, scope.typeManifestVisitor);

    const cpiFraming = getEventCpiFraming(node, scope.programEventFraming);
    // Drop the hoisted framing discriminator so generated constants match the IDL `events[].discriminator` bytes.
    const discriminatorNodes = getEventOwnDiscriminators(node, scope.programEventFraming);
    const fields = isNode(innerType, 'structTypeNode') ? innerType.fields : [];
    const shouldGenerateParse = isEventIdentifiable(node, scope.programEventFraming);
    if (!shouldGenerateParse && cpiFraming) {
        logWarn(
            `Event [${node.name}] has no discriminator beyond the shared CPI framing, which is ` +
                `common to all framed events and cannot identify it. Its parse helper will be skipped ` +
                `and it will be excluded from the program's identify/parse event helpers. Add a constant ` +
                `or field discriminator after the framing prefix to make it identifiable.`,
        );
    }

    const constantDiscriminatorImports = discriminatorNodes
        .filter(isNodeFilter('constantDiscriminatorNode'))
        .flatMap(d => {
            const name = getDiscriminatorConstantName(node.name, d, discriminatorNodes);
            return [scope.nameApi.constant(name), scope.nameApi.constantFunction(name)];
        });
    const fieldDiscriminatorImports = discriminatorNodes.filter(isNodeFilter('fieldDiscriminatorNode')).flatMap(d => {
        const name = camelCase(`${node.name}_${d.name}`);
        return [scope.nameApi.constant(name), scope.nameApi.constantFunction(name)];
    });
    const discriminatorSelfImports = [...constantDiscriminatorImports, ...fieldDiscriminatorImports];

    const strictName = scope.nameApi.dataType(node.name);
    const docblock = getDocblockFragment(node.docs ?? [], true);

    return pipe(
        mergeFragments(
            [
                getDiscriminatorConstantsFragment({
                    ...scope,
                    discriminatorNodes,
                    fields,
                    prefix: node.name,
                }),
                fragment`${docblock}export type ${strictName} = ${typeManifest.strictType};`,
                getTypeDecoderFragment({
                    ...scope,
                    manifest: typeManifest,
                    // Event decoding is a hot path (log/CPI streaming), so reuse one decoder instance.
                    memoize: true,
                    name: node.name,
                    node: innerType,
                    size: scope.size,
                }),
                shouldGenerateParse ? getEventParseFragment({ ...scope, eventNode: node }) : undefined,
            ],
            cs => cs.join('\n\n'),
        ),
        f =>
            removeFragmentImports(f, 'generatedEvents', [
                scope.nameApi.dataType(node.name),
                scope.nameApi.decoderFunction(node.name),
                scope.nameApi.eventIsFunction(node.name),
                scope.nameApi.eventParseFunction(node.name),
                ...discriminatorSelfImports,
            ]),
    );
}
