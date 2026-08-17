import { AccountNode, isNodeFilter, PdaNode } from '@codama/nodes';
import { getLastNodeFromPath, NodePath, pipe } from '@codama/visitors-core';

import {
    addFragmentImports,
    Fragment,
    fragment,
    getPdasWithProgramIdOverride,
    RenderScope,
    TypeManifest,
} from '../utils';

export function getAccountPdaHelpersFragment(
    scope: Pick<RenderScope, 'customAccountData' | 'linkables' | 'nameApi'> & {
        accountPath: NodePath<AccountNode>;
        typeManifest: TypeManifest;
    },
): Fragment | undefined {
    const { accountPath, nameApi, linkables, customAccountData, typeManifest } = scope;
    const accountNode = getLastNodeFromPath(accountPath);
    const pdaNode = accountNode.pda ? linkables.get([...accountPath, accountNode.pda]) : undefined;
    if (!pdaNode) return;

    const pdaPath = [...accountPath, pdaNode] as NodePath<PdaNode>;
    if (getPdasWithProgramIdOverride(pdaPath, linkables).has(pdaNode)) {
        throw new Error(
            `Account [${accountNode.name}] is linked to PDA [${pdaNode.name}], which is derived under a ` +
                `program that is only known at runtime. The owner guard of its decoder cannot be determined ` +
                `at generation time: it would check the account against the program being rendered, while the ` +
                `address derives under another program. Either pin the PDA's deriving program by setting ` +
                `"programId" on PDA [${pdaNode.name}], or address-constrain the account referenced by the ` +
                `"programId" of the PDA value so Codama can resolve it at generation time.`,
        );
    }

    const accountType = customAccountData.has(accountNode.name)
        ? typeManifest.strictType
        : nameApi.dataType(accountNode.name);

    // Not `getImportFrom`: the PDA's seeds decide whether a `seeds` argument renders.
    const importFrom = 'generatedPdas';
    const pdaSeedsType = nameApi.pdaSeedsType(pdaNode.name);
    const findPdaFunction = nameApi.pdaFindFunction(pdaNode.name);
    const hasVariableSeeds = (pdaNode.seeds ?? []).filter(isNodeFilter('variablePdaSeedNode')).length > 0;

    const fetchFromSeedsFunction = nameApi.accountFetchFromSeedsFunction(accountNode.name);
    const fetchMaybeFromSeedsFunction = nameApi.accountFetchMaybeFromSeedsFunction(accountNode.name);
    const fetchMaybeFunction = nameApi.accountFetchMaybeFunction(accountNode.name);

    return pipe(
        fragment`export async function ${fetchFromSeedsFunction}(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  ${hasVariableSeeds ? `seeds: ${pdaSeedsType},` : ''}
  config: FetchAccountConfig = {},
): Promise<Account<${accountType}>> {
  const maybeAccount = await ${fetchMaybeFromSeedsFunction}(rpc, ${hasVariableSeeds ? 'seeds, ' : ''}config);
  assertAccountExists(maybeAccount);
  return maybeAccount;
}

export async function ${fetchMaybeFromSeedsFunction}(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  ${hasVariableSeeds ? `seeds: ${pdaSeedsType},` : ''}
  config: FetchAccountConfig = {},
): Promise<MaybeAccount<${accountType}>> {
  const [address] = await ${findPdaFunction}(${hasVariableSeeds ? 'seeds' : ''});
  return await ${fetchMaybeFunction}(rpc, address, config);
}`,
        f => addFragmentImports(f, importFrom, hasVariableSeeds ? [pdaSeedsType, findPdaFunction] : [findPdaFunction]),
        f =>
            addFragmentImports(f, 'solanaAccounts', [
                'type Account',
                'assertAccountExists',
                'type FetchAccountConfig',
                'type MaybeAccount',
            ]),
    );
}
