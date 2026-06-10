import { camelCase, definedTypeNode, EventNode, isNode, isNodeFilter, resolveNestedTypeNode } from '@codama/nodes';
import { pipe, visit } from '@codama/visitors-core';

import { Fragment, fragment, getDocblockFragment, mergeFragments, removeFragmentImports, RenderScope } from '../utils';
import { getDiscriminatorConstantName, getDiscriminatorConstantsFragment } from './discriminatorConstants';
import { getEventDecodeFragment } from './eventDecode';
import { getEventCpiFraming, ResolvedProgramEventFraming } from './eventFraming';
import { getTypeDecoderFragment } from './typeDecoder';

export function getEventPageFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        eventNode: EventNode;
        programEventFraming?: ResolvedProgramEventFraming;
        size: number | null;
    },
): Fragment {
    const node = scope.eventNode;
    const innerType = resolveNestedTypeNode(node.data);
    const syntheticType = definedTypeNode({ docs: node.docs, name: node.name, type: innerType });
    const typeManifest = visit(syntheticType, scope.typeManifestVisitor);

    const cpiFraming = getEventCpiFraming(node, scope.programEventFraming);
    const allDiscriminators = node.discriminators ?? [];
    // Drop the hoisted framing discriminator so generated constants match the IDL `events[].discriminator` bytes.
    const discriminatorNodes = cpiFraming ? allDiscriminators.slice(1) : allDiscriminators;
    const fields = isNode(innerType, 'structTypeNode') ? innerType.fields : [];
    const hasConstantDiscriminator = discriminatorNodes.some(d => isNode(d, 'constantDiscriminatorNode'));
    const shouldGenerateDecode =
        (hasConstantDiscriminator || cpiFraming !== undefined) && isNode(node.data, 'hiddenPrefixTypeNode');

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
                shouldGenerateDecode ? getEventDecodeFragment({ ...scope, eventNode: node }) : undefined,
            ],
            cs => cs.join('\n\n'),
        ),
        f =>
            removeFragmentImports(f, 'generatedEvents', [
                scope.nameApi.dataType(node.name),
                scope.nameApi.decoderFunction(node.name),
                scope.nameApi.eventDecodeFunction(node.name),
                ...discriminatorSelfImports,
            ]),
    );
}
