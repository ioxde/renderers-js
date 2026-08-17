import {
    camelCase,
    getAllInstructionArguments,
    InstructionArgumentNode,
    InstructionNode,
    isNode,
    pascalCase,
} from '@codama/nodes';
import { mapFragmentContent } from '@codama/renderers-core';
import {
    getLastNodeFromPath,
    NodePath,
    pipe,
    ResolvedInstructionAccount,
    ResolvedInstructionInput,
} from '@codama/visitors-core';

import {
    AsyncScope,
    Fragment,
    fragment,
    getDocblockFragment,
    isDefaultValueAppliedByBuilder,
    isDefaultValueSkippedOnSyncPath,
    mergeFragmentImports,
    mergeFragments,
    RenderScope,
    TypeManifest,
    use,
} from '../utils';

export function getInstructionInputTypeFragment(
    scope: Pick<RenderScope, 'customInstructionData' | 'nameApi'> & {
        asyncScope: AsyncScope;
        dataArgsManifest: TypeManifest;
        instructionPath: NodePath<InstructionNode>;
        renamedArgs: Map<string, string>;
        resolvedInputs: ResolvedInstructionInput[];
        useAsync: boolean;
    },
): Fragment {
    const { instructionPath, useAsync, nameApi } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);
    const instructionInputType = useAsync
        ? nameApi.instructionAsyncInputType(instructionNode.name)
        : nameApi.instructionSyncInputType(instructionNode.name);
    const [dataArgumentsFragment, customDataArgumentsFragment] = getDataArgumentsFragments(scope);

    const instructionAccounts = instructionNode.accounts ?? [];
    let accountTypeParams = '';
    if (instructionAccounts.length > 0) {
        accountTypeParams = instructionAccounts
            .map(account => `TAccount${pascalCase(account.name)} extends string = string`)
            .join(', ');
        accountTypeParams = `<${accountTypeParams}>`;
    }

    const typeBodyFragment = mergeFragments(
        [
            getAccountsFragment(scope),
            dataArgumentsFragment,
            getExtraArgumentsFragment(scope),
            getRemainingAccountsFragment(instructionNode),
        ],
        c => c.join('\n'),
    );

    return fragment`export type ${instructionInputType}${accountTypeParams} = ${customDataArgumentsFragment} {
  ${typeBodyFragment}
}`;
}

function getAccountsFragment(
    scope: Pick<RenderScope, 'customInstructionData' | 'nameApi'> & {
        asyncScope: AsyncScope;
        instructionPath: NodePath<InstructionNode>;
        resolvedInputs: ResolvedInstructionInput[];
        useAsync: boolean;
    },
): Fragment {
    const { instructionPath, resolvedInputs, useAsync, asyncScope } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);

    const fragments = (instructionNode.accounts ?? []).map(account => {
        const resolvedAccount = resolvedInputs.find(
            input => input.kind === 'instructionAccountNode' && input.name === account.name,
        ) as ResolvedInstructionAccount;
        const hasDefaultValue = isDefaultValueAppliedByBuilder(resolvedAccount.defaultValue, asyncScope, useAsync);
        const docs = getDocblockFragment(account.docs ?? [], true);
        const optionalSign = hasDefaultValue || resolvedAccount.isOptional ? '?' : '';
        return fragment`${docs}${camelCase(account.name)}${optionalSign}: ${getAccountTypeFragment(resolvedAccount)};`;
    });

    return mergeFragments(fragments, c => c.join('\n'));
}

function getAccountTypeFragment(account: Pick<ResolvedInstructionAccount, 'isPda' | 'isSigner' | 'name'>): Fragment {
    const typeParam = `TAccount${pascalCase(account.name)}`;
    const address = use('type Address', 'solanaAddresses');
    const signer = use('type TransactionSigner', 'solanaSigners');
    const pda = use('type ProgramDerivedAddress', 'solanaAddresses');

    if (account.isPda && account.isSigner === false) return fragment`${pda}<${typeParam}>`;
    if (account.isPda && account.isSigner === 'either') return fragment`${pda}<${typeParam}> | ${signer}<${typeParam}>`;
    if (account.isSigner === 'either') return fragment`${address}<${typeParam}> | ${signer}<${typeParam}>`;
    if (account.isSigner) return fragment`${signer}<${typeParam}>`;
    return fragment`${address}<${typeParam}>`;
}

function getDataArgumentsFragments(
    scope: Pick<RenderScope, 'customInstructionData' | 'nameApi'> & {
        asyncScope: AsyncScope;
        dataArgsManifest: TypeManifest;
        instructionPath: NodePath<InstructionNode>;
        renamedArgs: Map<string, string>;
        useAsync: boolean;
    },
): [Fragment | undefined, Fragment] {
    const { instructionPath, nameApi } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);

    const customData = scope.customInstructionData.get(instructionNode.name);
    if (customData) {
        return [
            undefined,
            pipe(
                fragment`${nameApi.dataArgsType(customData.importAs)}`,
                f => mergeFragmentImports(f, [scope.dataArgsManifest.looseType.imports]),
                f => mapFragmentContent(f, c => `${c} & `),
            ),
        ];
    }

    const instructionDataName = nameApi.instructionDataType(instructionNode.name);
    const dataArgsType = nameApi.dataArgsType(instructionDataName);

    const fragments = (instructionNode.arguments ?? []).flatMap(arg => {
        const argFragment = getArgumentFragment(arg, dataArgsType, scope);
        return argFragment ? [argFragment] : [];
    });

    return [fragments.length === 0 ? undefined : mergeFragments(fragments, c => c.join('\n')), fragment``];
}

function getExtraArgumentsFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        asyncScope: AsyncScope;
        instructionPath: NodePath<InstructionNode>;
        renamedArgs: Map<string, string>;
        resolvedInputs: ResolvedInstructionInput[];
        useAsync: boolean;
    },
): Fragment | undefined {
    const { asyncScope, instructionPath, nameApi, useAsync } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);
    const extraArguments = instructionNode.extraArguments ?? [];
    if (extraArguments.length === 0) return;

    const instructionExtraName = nameApi.instructionExtraType(instructionNode.name);
    const extraArgsType = nameApi.dataArgsType(instructionExtraName);

    // Args referenced only by defaults the sync builder skips are dead on the sync path,
    // so the sync input type marks them optional. Keep in sync with `instructionInputDefault.ts`.
    const asyncOnlyDefaultRefs = new Set<string>();
    // Args the sync builder still reads (remaining accounts, byte deltas, sync-rendered defaults) stay required.
    const syncReadRefs = new Set<string>();
    if (!useAsync) {
        collectArgumentValueNames(instructionNode.remainingAccounts ?? [], syncReadRefs);
        collectArgumentValueNames(instructionNode.byteDeltas ?? [], syncReadRefs);
        for (const input of scope.resolvedInputs) {
            if (!input.defaultValue) continue;
            if (isDefaultValueSkippedOnSyncPath(input.defaultValue, asyncScope, useAsync)) {
                collectArgumentValueNames(input.defaultValue, asyncOnlyDefaultRefs);
            } else {
                collectArgumentValueNames(input.defaultValue, syncReadRefs);
            }
        }
    }

    const fragments = extraArguments.flatMap(arg => {
        // Dead on the sync path: the arg only feeds sync-skipped defaults, its own or another input's.
        // Add any new sync-path reader to syncReadRefs above, or live args will render optional.
        const hasAsyncOnlyRole =
            asyncOnlyDefaultRefs.has(arg.name) ||
            isDefaultValueSkippedOnSyncPath(arg.defaultValue, asyncScope, useAsync);
        const unreadInSync = !useAsync && hasAsyncOnlyRole && !syncReadRefs.has(arg.name);
        const argFragment = getArgumentFragment(arg, extraArgsType, scope, unreadInSync);
        return argFragment ? [argFragment] : [];
    });
    if (fragments.length === 0) return;

    return mergeFragments(fragments, c => c.join('\n'));
}

/** Collects every `argumentValueNode` name in a node tree. Walks structurally, so new node kinds are covered for free. */
function collectArgumentValueNames(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
        node.forEach(child => collectArgumentValueNames(child, out));
        return;
    }
    if (node && typeof node === 'object') {
        const candidate = node as { kind?: unknown; name?: unknown };
        if (candidate.kind === 'argumentValueNode' && typeof candidate.name === 'string') {
            out.add(candidate.name);
        }
        Object.values(node).forEach(child => collectArgumentValueNames(child, out));
    }
}

function getArgumentFragment(
    arg: InstructionArgumentNode,
    argsType: string,
    scope: {
        asyncScope: AsyncScope;
        renamedArgs: Map<string, string>;
        useAsync: boolean;
    },
    forceOptional = false,
): Fragment | null {
    const { asyncScope, renamedArgs, useAsync } = scope;
    if (arg.defaultValue && arg.defaultValueStrategy === 'omitted') return null;
    const renamedName = renamedArgs.get(arg.name) ?? arg.name;
    // Optional only if the builder will apply the default; sharing the builder's
    // predicate keeps optionality correct as new default value kinds are added.
    const hasAppliedDefault = isDefaultValueAppliedByBuilder(arg.defaultValue, asyncScope, useAsync);
    const optionalSign = forceOptional || hasAppliedDefault ? '?' : '';
    return fragment`${camelCase(renamedName)}${optionalSign}: ${argsType}["${camelCase(arg.name)}"];`;
}

function getRemainingAccountsFragment(instructionNode: InstructionNode): Fragment | undefined {
    const fragments = (instructionNode.remainingAccounts ?? []).flatMap(remainingAccountsNode => {
        if (isNode(remainingAccountsNode.value, 'resolverValueNode')) return [];

        const { name } = remainingAccountsNode.value;
        const allArguments = getAllInstructionArguments(instructionNode);
        const argumentExists = allArguments.some(arg => arg.name === name);
        if (argumentExists) return [];

        const isSigner = remainingAccountsNode.isSigner ?? false;
        const optionalSign = (remainingAccountsNode.isOptional ?? false) ? '?' : '';
        const signerFragment = use('type TransactionSigner', 'solanaSigners');
        const addressFragment = use('type Address', 'solanaAddresses');
        const typeFragment = (() => {
            if (isSigner === 'either') return fragment`${signerFragment} | ${addressFragment}`;
            return isSigner ? signerFragment : addressFragment;
        })();

        return fragment`${camelCase(name)}${optionalSign}: Array<${typeFragment}>;`;
    });
    if (fragments.length === 0) return;

    return mergeFragments(fragments, c => c.join('\n'));
}
