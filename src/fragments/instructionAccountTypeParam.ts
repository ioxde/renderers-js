import { InstructionAccountNode, InstructionInputValueNode, InstructionNode, pascalCase } from '@codama/nodes';
import {
    findInstructionNodeFromPath,
    findProgramNodeFromPath,
    getLastNodeFromPath,
    getNodePathUntilLastNode,
    LinkableDictionary,
    NodePath,
} from '@codama/visitors-core';

import { Fragment, fragment, getResolvedPdaValue, RenderScope, use } from '../utils';

export function getInstructionAccountTypeParamFragment(
    scope: Pick<RenderScope, 'linkables'> & {
        allowAccountMeta: boolean;
        instructionAccountPath: NodePath<InstructionAccountNode>;
    },
): Fragment {
    const { instructionAccountPath, allowAccountMeta, linkables } = scope;
    const instructionAccountNode = getLastNodeFromPath(instructionAccountPath);
    const instructionNode = findInstructionNodeFromPath(instructionAccountPath)!;
    const programNode = findProgramNodeFromPath(instructionAccountPath)!;
    const typeParam = `TAccount${pascalCase(instructionAccountNode.name)}`;
    const accountMeta = allowAccountMeta
        ? fragment` | ${use('type AccountMeta', 'solanaInstructions')}<string>`
        : undefined;

    if (instructionNode.optionalAccountStrategy === 'omitted' && instructionAccountNode.isOptional) {
        return fragment`${typeParam} extends string${accountMeta} | undefined = undefined`;
    }

    const instructionPath = getNodePathUntilLastNode(
        instructionAccountPath,
        'instructionNode',
    ) as NodePath<InstructionNode>;
    const defaultAddress = getDefaultAddress(
        instructionAccountNode.defaultValue,
        programNode.publicKey,
        linkables,
        instructionPath,
    );
    return fragment`${typeParam} extends string${accountMeta} = ${defaultAddress}`;
}

function getDefaultAddress(
    defaultValue: InstructionInputValueNode | undefined,
    programId: string,
    linkables: LinkableDictionary,
    instructionPath: NodePath<InstructionNode> | undefined,
): string {
    switch (defaultValue?.kind) {
        case 'publicKeyValueNode':
            return `"${defaultValue.publicKey}"`;
        case 'programLinkNode':
            // eslint-disable-next-line no-case-declarations
            const programNode = linkables.get([defaultValue]);
            return programNode ? `"${programNode.publicKey}"` : 'string';
        case 'programIdValueNode':
            return `"${programId}"`;
        case 'pdaValueNode':
            // Tracks the resolved predicate, not the narrower fold: an account whose bump is read
            // still has this one literal address, it just keeps the tuple the bump comes out of.
            if (!instructionPath) return 'string';
            // eslint-disable-next-line no-case-declarations
            const resolvedPda = getResolvedPdaValue(defaultValue, instructionPath, linkables);
            return resolvedPda ? `"${resolvedPda.address}"` : 'string';
        default:
            return 'string';
    }
}
