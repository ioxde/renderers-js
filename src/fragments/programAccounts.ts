import { AccountNode, camelCase, ProgramNode, resolveNestedTypeNode } from '@codama/nodes';

import { Fragment, fragment, mergeFragments, RenderScope, use } from '../utils';
import { getDiscriminatorConditionFragment } from './discriminatorCondition';

/** File name (without extension) of the aggregate accounts page hosting the `identify*` helper. */
export function getProgramAccountsFileName(programNode: ProgramNode): `${string}.accounts` {
    return `${camelCase(programNode.name)}.accounts`;
}

/** Whether the aggregate accounts page renders for this program. */
export function hasProgramAccountsPage(programNode: ProgramNode): boolean {
    return (programNode.accounts ?? []).length > 0;
}

/** Import path of an account's page, relative to the accounts folder. */
function getAccountModule(account: AccountNode): `./${string}` {
    return `./${camelCase(account.name)}`;
}

/**
 * Renders a program's aggregate accounts page: the account-type union plus the
 * `identify*` helper. The helper returns `null` when the account belongs to
 * another program or no known account matches.
 */
export function getProgramAccountsPageFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        programNode: ProgramNode;
    },
): Fragment | undefined {
    if (!hasProgramAccountsPage(scope.programNode)) return;
    return mergeFragments(
        [getProgramAccountsTypeUnionFragment(scope), getProgramAccountsIdentifierFunctionFragment(scope)],
        c => c.join('\n\n'),
    );
}

function getProgramAccountsTypeUnionFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, nameApi } = scope;
    const programAccountsTypeUnion = nameApi.programAccountsTypeUnion(programNode.name);
    const programAccountsTypeVariants = (programNode.accounts ?? []).map(
        account => `'${nameApi.programAccountsTypeVariant(account.name)}'`,
    );
    return fragment`/** Account kinds of the ${programNode.name} program. */
export type ${programAccountsTypeUnion} = ${programAccountsTypeVariants.join(' | ')};`;
}

function getProgramAccountsIdentifierFunctionFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        programNode: ProgramNode;
    },
): Fragment | undefined {
    const { programNode, nameApi } = scope;
    const accountsWithDiscriminators = (programNode.accounts ?? []).filter(
        account => (account.discriminators ?? []).length > 0,
    );
    if (accountsWithDiscriminators.length === 0) return;

    const programAccountsTypeUnion = nameApi.programAccountsTypeUnion(programNode.name);
    const programAccountsIdentifierFunction = nameApi.programAccountsIdentifierFunction(programNode.name);

    const discriminatorsFragment = mergeFragments(
        accountsWithDiscriminators.map((account): Fragment => {
            const variant = nameApi.programAccountsTypeVariant(account.name);
            return getDiscriminatorConditionFragment({
                ...scope,
                constantSource: getAccountModule(account),
                dataName: 'data',
                discriminators: account.discriminators ?? [],
                ifTrue: `return '${variant}';`,
                prefix: account.name,
                struct: resolveNestedTypeNode(account.data),
            });
        }),
        c => c.join('\n'),
    );

    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');
    // Discriminators collide across programs, so the object arm carries its owner. `programAddress`
    // is required, not optional: an optional field lets the check be skipped by call shape.
    // Bytes-only callers pass data directly and opt out explicitly.
    const programAddressConstant = use(nameApi.programAddressConstant(programNode.name), 'generatedPrograms');

    return fragment`/**
 * Identifies ${programNode.name} account data by its discriminators.
 * Returns \`null\` when the account belongs to another program or the data matches no known account.
 */
export function ${programAccountsIdentifierFunction}(account: { data: ${readonlyUint8Array}; programAddress: ${use('type Address', 'solanaAddresses')} } | ${readonlyUint8Array}): ${programAccountsTypeUnion} | null {
    if ('data' in account && account.programAddress !== ${programAddressConstant}) return null;
    const data = 'data' in account ? account.data : account;
    ${discriminatorsFragment}
    return null;
}`;
}
