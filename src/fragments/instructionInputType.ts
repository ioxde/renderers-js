import {
    camelCase,
    CamelCaseString,
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
    isDefaultSkippedForOptionalAccount,
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
        fixedAccounts: ReadonlyMap<CamelCaseString, string>;
        instructionPath: NodePath<InstructionNode>;
        renamedArgs: Map<string, string>;
        resolvedInputs: ResolvedInstructionInput[];
        useAsync: boolean;
    },
): Fragment {
    const { fixedAccounts, instructionPath, useAsync, nameApi } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);
    const instructionInputType = useAsync
        ? nameApi.instructionAsyncInputType(instructionNode.name)
        : nameApi.instructionSyncInputType(instructionNode.name);
    const [dataArgumentsFragment, customDataArgumentsFragment] = getDataArgumentsFragments(scope);

    // A type parameter with no field left to infer from would widen the return type to `string`.
    const inputAccounts = (instructionNode.accounts ?? []).filter(account => !fixedAccounts.has(account.name));
    let accountTypeParams = '';
    if (inputAccounts.length > 0) {
        accountTypeParams = inputAccounts
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
        fixedAccounts: ReadonlyMap<CamelCaseString, string>;
        instructionPath: NodePath<InstructionNode>;
        resolvedInputs: ResolvedInstructionInput[];
        useAsync: boolean;
    },
): Fragment {
    const { fixedAccounts, instructionPath, resolvedInputs, useAsync, asyncScope } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);

    const fragments = (instructionNode.accounts ?? []).flatMap(account => {
        // The program enforces this address, so an override could only produce a failing transaction.
        if (fixedAccounts.has(account.name)) return [];
        const resolvedAccount = resolvedInputs.find(
            input => input.kind === 'instructionAccountNode' && input.name === account.name,
        ) as ResolvedInstructionAccount;
        const hasDefaultValue = isDefaultValueAppliedByBuilder(resolvedAccount.defaultValue, asyncScope, useAsync);
        const docs = getDocblockFragment(account.docs ?? [], true);
        const optionalSign = hasDefaultValue || resolvedAccount.isOptional ? '?' : '';
        return [
            fragment`${docs}${camelCase(account.name)}${optionalSign}: ${getAccountTypeFragment(resolvedAccount)};`,
        ];
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

    // An arg referenced only by defaults this variant skips is dead, so the input type marks it
    // optional. Keep in sync with `instructionInputDefault.ts`.
    const skippedRefs = new Set<string>();
    const readRefs = new Set<string>();
    collectArgumentValueNames(instructionNode.remainingAccounts ?? [], readRefs);
    collectArgumentValueNames(instructionNode.byteDeltas ?? [], readRefs);
    for (const input of scope.resolvedInputs) {
        if (!input.defaultValue) continue;
        const isSkipped =
            isDefaultValueSkippedOnSyncPath(input.defaultValue, asyncScope, useAsync) ||
            isDefaultSkippedForOptionalAccount(input, instructionNode);
        collectArgumentValueNames(input.defaultValue, isSkipped ? skippedRefs : readRefs);
    }

    const fragments = extraArguments.flatMap(arg => {
        // An arg nothing references at all is left alone: a caller's argument, not a dead one.
        // Add any new reader to readRefs above, or live args will render optional.
        const onlyFeedsSkippedDefaults =
            skippedRefs.has(arg.name) || isDefaultValueSkippedOnSyncPath(arg.defaultValue, asyncScope, useAsync);
        const unread = onlyFeedsSkippedDefaults && !readRefs.has(arg.name);
        const argFragment = getArgumentFragment(arg, extraArgsType, scope, unread);
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
