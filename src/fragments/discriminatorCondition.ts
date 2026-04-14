import {
    type ConstantDiscriminatorNode,
    type DiscriminatorNode,
    type FieldDiscriminatorNode,
    isNode,
    type SizeDiscriminatorNode,
    type StructTypeNode,
    VALUE_NODES,
} from '@codama/nodes';
import { mapFragmentContent } from '@codama/renderers-core';
import { pipe, visit } from '@codama/visitors-core';

import { Fragment, fragment, mergeFragments, RenderScope, use } from '../utils';
import { getDiscriminatorConstantName } from './discriminatorConstants';

type ConstantSource = 'generatedAccounts' | 'generatedEvents' | 'generatedInstructions';

/**
 * ```
 * if (data.length === 72) {
 *   return splTokenAccounts.TOKEN;
 * }
 *
 * if (containsBytes(data, TOKEN_DISCRIMINATOR, offset)) {
 *   return splTokenAccounts.TOKEN;
 * }
 *
 * if (containsBytes(data, getU8Encoder().encode(TRANSFER_DISCRIMINATOR), offset)) {
 *   return splTokenInstructions.TRANSFER;
 * }
 * ```
 */
export function getDiscriminatorConditionFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        constantSource: ConstantSource;
        dataName: string;
        discriminators: DiscriminatorNode[];
        ifTrue: string;
        prefix: string;
        struct: StructTypeNode;
    },
): Fragment {
    return pipe(
        mergeFragments(
            scope.discriminators.flatMap(discriminator => {
                if (isNode(discriminator, 'sizeDiscriminatorNode')) {
                    return [getSizeConditionFragment(discriminator, scope)];
                }
                if (isNode(discriminator, 'constantDiscriminatorNode')) {
                    return [getByteConditionFragment(discriminator, scope)];
                }
                if (isNode(discriminator, 'fieldDiscriminatorNode')) {
                    return [getFieldConditionFragment(discriminator, scope)];
                }
                return [];
            }),
            c => c.join(' && '),
        ),
        f => mapFragmentContent(f, c => `if (${c}) { ${scope.ifTrue} }`),
    );
}

function getSizeConditionFragment(
    discriminator: SizeDiscriminatorNode,
    scope: {
        dataName: string;
    },
): Fragment {
    const { dataName } = scope;
    return fragment`${dataName}.length === ${discriminator.size}`;
}

function getByteConditionFragment(
    discriminator: ConstantDiscriminatorNode,
    scope: Pick<RenderScope, 'nameApi'> & {
        constantSource: ConstantSource;
        dataName: string;
        discriminators: DiscriminatorNode[];
        prefix: string;
    },
): Fragment {
    const { constantSource, dataName, discriminators, nameApi, prefix } = scope;

    const name = getDiscriminatorConstantName(prefix, discriminator, discriminators);
    const constant = use(nameApi.constant(name), constantSource);

    return fragment`${use('containsBytes', 'solanaCodecsCore')}(${dataName}, ${constant}, ${discriminator.offset})`;
}

function getFieldConditionFragment(
    discriminator: FieldDiscriminatorNode,
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        constantSource: ConstantSource;
        dataName: string;
        prefix: string;
        struct: StructTypeNode;
    },
): Fragment {
    const { constantSource, dataName, nameApi, prefix, struct, typeManifestVisitor } = scope;

    const field = struct.fields.find(f => f.name === discriminator.name);
    if (!field || !field.defaultValue || !isNode(field.defaultValue, VALUE_NODES)) {
        throw new Error(
            `Field discriminator "${discriminator.name}" does not have a matching argument with default value.`,
        );
    }

    const name = getDiscriminatorConstantName(prefix, discriminator);
    const constant = use(nameApi.constant(name), constantSource);
    const containsBytes = use('containsBytes', 'solanaCodecsCore');

    // For byte-sequence field discriminators (e.g. Anchor's fixed-size byte arrays), the generated
    // constant is already a ReadonlyUint8Array, so it can be passed directly to containsBytes.
    // This covers both u8[N] arrays and fixed-size bytes fields.
    const isFixedSizeBytes = isNode(field.type, 'fixedSizeTypeNode') && isNode(field.type.type, 'bytesTypeNode');
    const isU8Array =
        isNode(field.type, 'arrayTypeNode') &&
        isNode(field.type.item, 'numberTypeNode') &&
        field.type.item.format === 'u8' &&
        isNode(field.type.count, 'fixedCountNode');

    if (isFixedSizeBytes || isU8Array) {
        return fragment`${containsBytes}(${dataName}, ${constant}, ${discriminator.offset})`;
    }

    // Otherwise the constant is the raw value (e.g. a number); encode it at use site.
    const encoder = visit(field.type, typeManifestVisitor).encoder;
    return fragment`${containsBytes}(${dataName}, ${encoder}.encode(${constant}), ${discriminator.offset})`;
}
