import { camelCase, InstructionNode, isNode } from '@codama/nodes';
import { mapFragmentContent } from '@codama/renderers-core';
import { NodePath, ResolvedInstructionInput } from '@codama/visitors-core';

import { AsyncScope, Fragment, fragment, mergeFragments, RenderScope } from '../utils';
import { getInstructionInputDefaultFragment } from './instructionInputDefault';

export function getInstructionInputResolvedFragment(
    scope: Pick<RenderScope, 'asyncResolvers' | 'getImportFrom' | 'linkables' | 'nameApi' | 'typeManifestVisitor'> & {
        asyncScope: AsyncScope;
        instructionPath: NodePath<InstructionNode>;
        resolvedInputs: ResolvedInstructionInput[];
        useAsync: boolean;
    },
): Fragment {
    const resolvedInputFragments = scope.resolvedInputs.flatMap((input: ResolvedInstructionInput): Fragment[] => {
        const inputFragment = getInstructionInputDefaultFragment({ ...scope, input });
        if (!inputFragment.content) return [];
        const camelName = camelCase(input.name);
        return [
            mapFragmentContent(inputFragment, c =>
                isNode(input, 'instructionArgumentNode')
                    ? `if (!args.${camelName}) {\n${c}\n}`
                    : `if (!accounts.${camelName}.value) {\n${c}\n}`,
            ),
        ];
    });

    if (resolvedInputFragments.length === 0) {
        return fragment``;
    }

    return mergeFragments([fragment`// Resolve default values.`, ...resolvedInputFragments], c => c.join('\n'));
}
