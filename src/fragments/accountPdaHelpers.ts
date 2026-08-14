import { AccountNode, isNodeFilter } from '@codama/nodes';
import { getLastNodeFromPath, NodePath, pipe } from '@codama/visitors-core';

import { addFragmentImports, Fragment, fragment, RenderScope, TypeManifest } from '../utils';

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

    // The emitted fetchMaybeFromSeeds forwards `config` whole, never a destructured rest: the
    // `programAddress` override must reach decode's owner check — the PDA account is owned by the override program.

    return pipe(
        fragment`export async function ${fetchFromSeedsFunction}(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  ${hasVariableSeeds ? `seeds: ${pdaSeedsType},` : ''}
  config: FetchAccountConfig & { programAddress?: Address } = {},
): Promise<Account<${accountType}>> {
  const maybeAccount = await ${fetchMaybeFromSeedsFunction}(rpc, ${hasVariableSeeds ? 'seeds, ' : ''}config);
  assertAccountExists(maybeAccount);
  return maybeAccount;
}

export async function ${fetchMaybeFromSeedsFunction}(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  ${hasVariableSeeds ? `seeds: ${pdaSeedsType},` : ''}
  config: FetchAccountConfig & { programAddress?: Address } = {},
): Promise<MaybeAccount<${accountType}>> {
  const { programAddress } = config;
  const [address] = await ${findPdaFunction}(${hasVariableSeeds ? 'seeds, ' : ''}{ programAddress });
  return await ${fetchMaybeFunction}(rpc, address, config);
}`,
        f => addFragmentImports(f, importFrom, hasVariableSeeds ? [pdaSeedsType, findPdaFunction] : [findPdaFunction]),
        f => addFragmentImports(f, 'solanaAddresses', ['type Address']),
        f =>
            addFragmentImports(f, 'solanaAccounts', [
                'type Account',
                'assertAccountExists',
                'type FetchAccountConfig',
                'type MaybeAccount',
            ]),
    );
}
