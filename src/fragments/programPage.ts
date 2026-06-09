import { ProgramNode } from '@codama/nodes';

import { Fragment, RenderScope } from '../utils';
import { getProgramConstantFragment } from './programConstant';

export function getProgramPageFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        programNode: ProgramNode;
    },
): Fragment {
    return getProgramConstantFragment(scope);
}
