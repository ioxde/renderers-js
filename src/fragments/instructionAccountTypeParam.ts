import { InstructionAccountNode, InstructionNode, pascalCase } from '@codama/nodes';
import {
    findInstructionNodeFromPath,
    getLastNodeFromPath,
    getNodePathUntilLastNode,
    NodePath,
} from '@codama/visitors-core';

import { Fragment, fragment, getInstructionAccountAddressOnOmission, RenderScope, use } from '../utils';

export function getInstructionAccountTypeParamFragment(
    scope: Pick<RenderScope, 'linkables'> & {
        allowAccountMeta: boolean;
        instructionAccountPath: NodePath<InstructionAccountNode>;
    },
): Fragment {
    const { instructionAccountPath, allowAccountMeta, linkables } = scope;
    const instructionAccountNode = getLastNodeFromPath(instructionAccountPath);
    const instructionNode = findInstructionNodeFromPath(instructionAccountPath)!;
    const typeParam = `TAccount${pascalCase(instructionAccountNode.name)}`;
    const accountMeta = allowAccountMeta
        ? fragment` | ${use('type AccountMeta', 'solanaInstructions')}<string>`
        : undefined;

    const instructionPath = getNodePathUntilLastNode(
        instructionAccountPath,
        'instructionNode',
    ) as NodePath<InstructionNode>;
    // A type-parameter default describes what the builder assigns on omission, not what the account's
    // default resolves to. No builder applies an IDL-optional account's default, so `getAccountMeta`
    // decides that slot instead and no pinned address describes it.
    const defaultAddress = getInstructionAccountAddressOnOmission(instructionAccountNode, instructionPath, linkables);

    if (instructionNode.optionalAccountStrategy === 'omitted' && instructionAccountNode.isOptional) {
        // Omitting drops the account's meta and the generated account tuple branches on `undefined`.
        return fragment`${typeParam} extends string${accountMeta} | undefined = ${defaultAddress ? `"${defaultAddress}"` : 'undefined'}`;
    }

    return fragment`${typeParam} extends string${accountMeta} = ${defaultAddress ? `"${defaultAddress}"` : 'string'}`;
}
