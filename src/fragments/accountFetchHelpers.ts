import { AccountNode, resolveNestedTypeNode } from '@codama/nodes';
import { findProgramNodeFromPath, getLastNodeFromPath, NodePath, pipe } from '@codama/visitors-core';

import { addFragmentImports, Fragment, fragment, RenderScope, TypeManifest, use } from '../utils';
import { getDiscriminatorGuardFragment } from './discriminatorCondition';

export function getAccountFetchHelpersFragment(
    scope: Pick<RenderScope, 'customAccountData' | 'nameApi' | 'typeManifestVisitor'> & {
        accountPath: NodePath<AccountNode>;
        typeManifest: TypeManifest;
    },
): Fragment {
    const { accountPath, typeManifest, nameApi, customAccountData } = scope;
    const accountNode = getLastNodeFromPath(accountPath);
    const programNode = findProgramNodeFromPath(accountPath)!;
    // The emitted owner check narrows on `exists` first: the non-existing variant carries no
    // `programAddress`, so a flat check would throw on every missing account.
    const programAddressConstant = use(nameApi.programAddressConstant(programNode.name), 'generatedPrograms');
    const decodeFunction = nameApi.accountDecodeFunction(accountNode.name);
    const fetchAllFunction = nameApi.accountFetchAllFunction(accountNode.name);
    const fetchAllMaybeFunction = nameApi.accountFetchAllMaybeFunction(accountNode.name);
    const fetchFunction = nameApi.accountFetchFunction(accountNode.name);
    const fetchMaybeFunction = nameApi.accountFetchMaybeFunction(accountNode.name);

    const hasCustomData = customAccountData.has(accountNode.name);
    const accountTypeName = nameApi.dataType(accountNode.name);
    const accountType = hasCustomData ? typeManifest.strictType : accountTypeName;
    const decoderFunction = hasCustomData ? typeManifest.decoder : `${nameApi.decoderFunction(accountNode.name)}()`;

    // Rides inside the same `exists` narrowing as the owner check: the non-existing variant carries
    // no data either. The owner check cannot separate an account from its siblings of one program.
    const discriminatorGuard = getDiscriminatorGuardFragment({
        ...scope,
        constantSource: 'generatedAccounts',
        dataName: 'encodedAccount.data',
        discriminators: accountNode.discriminators ?? [],
        errorMessage: fragment`\`${decodeFunction}: account \${encodedAccount.address} does not match the ${accountTypeName} discriminator\``,
        errorName: 'AccountDiscriminatorMismatchError',
        prefix: accountNode.name,
        struct: resolveNestedTypeNode(accountNode.data),
    });

    return pipe(
        fragment`export function ${decodeFunction}<TAddress extends string = string>(encodedAccount: EncodedAccount<TAddress>): Account<${accountType}, TAddress>;
export function ${decodeFunction}<TAddress extends string = string>(encodedAccount: MaybeEncodedAccount<TAddress>): MaybeAccount<${accountType}, TAddress>;
export function ${decodeFunction}<TAddress extends string = string>(encodedAccount: EncodedAccount<TAddress> | MaybeEncodedAccount<TAddress>): Account<${accountType}, TAddress> | MaybeAccount<${accountType}, TAddress> {
  if (!('exists' in encodedAccount) || encodedAccount.exists) {
    if (encodedAccount.programAddress !== ${programAddressConstant}) {
      const error = new Error(\`${decodeFunction}: account \${encodedAccount.address} is owned by \${encodedAccount.programAddress}, expected \${${programAddressConstant}}\`);
      error.name = 'AccountOwnerMismatchError';
      throw error;
    }
    ${discriminatorGuard}
  }
  return decodeAccount(encodedAccount as MaybeEncodedAccount<TAddress>, ${decoderFunction});
}

export async function ${fetchFunction}<TAddress extends string = string>(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  address: Address<TAddress>,
  config?: FetchAccountConfig,
): Promise<Account<${accountType}, TAddress>> {
  const maybeAccount = await ${fetchMaybeFunction}(rpc, address, config);
  assertAccountExists(maybeAccount);
  return maybeAccount;
}

export async function ${fetchMaybeFunction}<TAddress extends string = string>(
  rpc: Parameters<typeof fetchEncodedAccount>[0],
  address: Address<TAddress>,
  config?: FetchAccountConfig,
): Promise<MaybeAccount<${accountType}, TAddress>> {
  const maybeAccount = await fetchEncodedAccount(rpc, address, config);
  return ${decodeFunction}(maybeAccount);
}

export async function ${fetchAllFunction}(
  rpc: Parameters<typeof fetchEncodedAccounts>[0],
  addresses: Array<Address>,
  config?: FetchAccountsConfig,
): Promise<Account<${accountType}>[]> {
  const maybeAccounts = await ${fetchAllMaybeFunction}(rpc, addresses, config);
  assertAccountsExist(maybeAccounts);
  return maybeAccounts;
}

export async function ${fetchAllMaybeFunction}(
  rpc: Parameters<typeof fetchEncodedAccounts>[0],
  addresses: Array<Address>,
  config?: FetchAccountsConfig,
): Promise<MaybeAccount<${accountType}>[]> {
  const maybeAccounts = await fetchEncodedAccounts(rpc, addresses, config);
  return maybeAccounts.map((maybeAccount) => ${decodeFunction}(maybeAccount));
}`,
        f => addFragmentImports(f, 'solanaAddresses', ['type Address']),
        f =>
            addFragmentImports(f, 'solanaAccounts', [
                'type Account',
                'assertAccountExists',
                'assertAccountsExist',
                'decodeAccount',
                'type EncodedAccount',
                'fetchEncodedAccount',
                'fetchEncodedAccounts',
                'type FetchAccountConfig',
                'type FetchAccountsConfig',
                'type MaybeAccount',
                'type MaybeEncodedAccount',
            ]),
    );
}
