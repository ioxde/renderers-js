import {
    type ConstantDiscriminatorNode,
    type DiscriminatorNode,
    type FieldDiscriminatorNode,
    isNode,
    isNodeFilter,
    type SizeDiscriminatorNode,
    type StructTypeNode,
    VALUE_NODES,
} from '@codama/nodes';
import { mapFragmentContent } from '@codama/renderers-core';
import { pipe, visit } from '@codama/visitors-core';

import { Fragment, fragment, mergeFragments, removeFragmentImports, RenderScope, use } from '../utils';
import { getDiscriminatorConstantName } from './discriminatorConstants';

type ConstantSource = 'generatedAccounts' | 'generatedEvents' | 'generatedInstructions' | `./${string}`;

/**
 * Keeps the discriminators that emit an exported constant, the only ones a guard can compare
 * bytes against: constants always, fields only with a value default, sizes never. Filtering
 * first also keeps {@link getDiscriminatorConditionExprFragment} total, since the field
 * conditions it builds throw on a field without a value default.
 */
export function getDiscriminatorsWithConstants(
    discriminators: DiscriminatorNode[],
    struct: StructTypeNode,
): DiscriminatorNode[] {
    return discriminators.filter(discriminator => {
        if (isNode(discriminator, 'constantDiscriminatorNode')) return true;
        if (!isNode(discriminator, 'fieldDiscriminatorNode')) return false;
        const field = (struct.fields ?? []).find(f => f.name === discriminator.name);
        return !!field?.defaultValue && isNode(field.defaultValue, VALUE_NODES);
    });
}

/**
 * ```
 * if (!containsBytes(data, MY_ACCOUNT_DISCRIMINATOR, 0)) {
 *   const error = new Error(`…`);
 *   error.name = 'AccountDiscriminatorMismatchError';
 *   throw error;
 * }
 * ```
 *
 * Reuses the conditions behind `identify*`, so guards and identifiers cannot disagree on offsets.
 * `containsBytes` compares against a slice, so short data is a mismatch, not a range error.
 * Returns `undefined` when no discriminator has a constant. Render only into the page declaring
 * those constants: the imports are stripped, since importing them back would be a barrel cycle.
 */
export function getDiscriminatorGuardFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        constantSource: ConstantSource;
        dataName: string;
        discriminators: DiscriminatorNode[];
        errorMessage: Fragment;
        errorName: string;
        prefix: string;
        struct: StructTypeNode;
    },
): Fragment | undefined {
    const discriminators = getDiscriminatorsWithConstants(scope.discriminators, scope.struct);
    if (discriminators.length === 0) return;
    const localConstants = discriminators
        .filter(isNodeFilter(['constantDiscriminatorNode', 'fieldDiscriminatorNode']))
        .map(discriminator =>
            scope.nameApi.constant(getDiscriminatorConstantName(scope.prefix, discriminator, discriminators)),
        );
    return pipe(
        getDiscriminatorConditionExprFragment({ ...scope, discriminators }),
        condition => fragment`if (!(${condition})) {
  const error = new Error(${scope.errorMessage});
  error.name = '${scope.errorName}';
  throw error;
}`,
        f => removeFragmentImports(f, scope.constantSource, localConstants),
    );
}

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
        /** Conditions ANDed in ahead of the discriminator checks (e.g. a shared event-framing prefix). */
        leadingConditions?: Fragment[];
        prefix: string;
        struct: StructTypeNode;
    },
): Fragment {
    return pipe(getDiscriminatorConditionExprFragment(scope), f =>
        mapFragmentContent(f, c => `if (${c}) { ${scope.ifTrue} }`),
    );
}

/**
 * Renders the bare boolean expression ANDing the leading conditions and discriminator
 * checks, without the wrapping `if` statement of {@link getDiscriminatorConditionFragment}.
 */
export function getDiscriminatorConditionExprFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        constantSource: ConstantSource;
        dataName: string;
        discriminators: DiscriminatorNode[];
        /** Conditions ANDed in ahead of the discriminator checks (e.g. a shared event-framing prefix). */
        leadingConditions?: Fragment[];
        prefix: string;
        struct: StructTypeNode;
    },
): Fragment {
    return mergeFragments([...(scope.leadingConditions ?? []), ...getDiscriminatorConditions(scope)], c =>
        c.join(' && '),
    );
}

function getDiscriminatorConditions(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        constantSource: ConstantSource;
        dataName: string;
        discriminators: DiscriminatorNode[];
        prefix: string;
        struct: StructTypeNode;
    },
): Fragment[] {
    return scope.discriminators.flatMap(discriminator => {
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
    });
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

    const field = (struct.fields ?? []).find(f => f.name === discriminator.name);
    if (!field || !field.defaultValue || !isNode(field.defaultValue, VALUE_NODES)) {
        throw new Error(
            `Field discriminator "${discriminator.name}" does not have a matching argument with default value.`,
        );
    }

    const name = getDiscriminatorConstantName(prefix, discriminator);
    const constant = use(nameApi.constant(name), constantSource);
    const containsBytes = use('containsBytes', 'solanaCodecsCore');

    // Byte-sequence discriminators (u8[N] arrays, fixed-size bytes) already generate a
    // ReadonlyUint8Array constant, so it goes straight to containsBytes.
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
