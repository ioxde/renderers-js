import { camelCase, InstructionNode, pascalCase } from '@codama/nodes';
import { mapFragmentContent } from '@codama/renderers-core';
import {
    findProgramNodeFromPath,
    getLastNodeFromPath,
    NodePath,
    pipe,
    ResolvedInstructionInput,
} from '@codama/visitors-core';

import {
    addFragmentImports,
    AsyncScope,
    Fragment,
    fragment,
    getInstructionInputShape,
    hasAsyncFunction,
    mergeFragments,
    RenderScope,
    TypeManifest,
    use,
} from '../utils';
import { NameApi } from '../utils/nameTransformers';
import { getInstructionByteDeltaFragment } from './instructionByteDelta';
import { getInstructionInputResolvedFragment } from './instructionInputResolved';
import { getInstructionInputTypeFragment } from './instructionInputType';
import { getInstructionRemainingAccountsFragment } from './instructionRemainingAccounts';

export function getInstructionFunctionFragment(
    scope: Pick<
        RenderScope,
        'asyncResolvers' | 'customInstructionData' | 'getImportFrom' | 'linkables' | 'nameApi' | 'typeManifestVisitor'
    > & {
        asyncScope: AsyncScope;
        dataArgsManifest: TypeManifest;
        extraArgsManifest: TypeManifest;
        instructionPath: NodePath<InstructionNode>;
        renamedArgs: Map<string, string>;
        resolvedInputs: ResolvedInstructionInput[];
        useAsync: boolean;
    },
): Fragment | undefined {
    const { useAsync, instructionPath, resolvedInputs, renamedArgs, asyncScope, nameApi, customInstructionData } =
        scope;
    const instructionNode = getLastNodeFromPath(instructionPath);
    const programNode = findProgramNodeFromPath(instructionPath)!;
    if (useAsync && !hasAsyncFunction(instructionNode, resolvedInputs, asyncScope)) return;

    const customData = customInstructionData.get(instructionNode.name);
    const hasAccounts = (instructionNode.accounts ?? []).length > 0;
    const hasData = !!customData || (instructionNode.arguments ?? []).length > 0;
    const { hasAnyArgs, hasDataArgs, hasInput } = getInstructionInputShape(instructionNode, {
        asyncScope,
        hasCustomData: !!customData,
        useAsync,
    });
    const programAddressConstant = use(nameApi.programAddressConstant(programNode.name), 'generatedPrograms');

    const functionName = useAsync
        ? nameApi.instructionAsyncFunction(instructionNode.name)
        : nameApi.instructionSyncFunction(instructionNode.name);

    const resolvedInputsFragment = getInstructionInputResolvedFragment(scope);
    const remainingAccountsFragment = getInstructionRemainingAccountsFragment(scope);
    const byteDeltaFragment = getInstructionByteDeltaFragment(scope);
    const resolvedInputFragment = mergeFragments(
        [resolvedInputsFragment, remainingAccountsFragment, byteDeltaFragment],
        content => content.join('\n\n'),
    );
    const hasRemainingAccounts = !!remainingAccountsFragment;
    const hasByteDeltas = !!byteDeltaFragment;
    const hasResolver = resolvedInputFragment.features.has('instruction:resolverScopeVariable');
    const instructionTypeFragment = getInstructionTypeFragment({ ...scope, programAddressConstant });

    const typeParams = getTypeParamsFragment(instructionNode);
    const returnType = getReturnTypeFragment(instructionTypeFragment, hasByteDeltas, useAsync);
    // Without an `input` parameter nothing references the type — not the builder signature, not the plugin.
    const inputType = hasInput ? getInstructionInputTypeFragment(scope) : undefined;
    const inputArg = mapFragmentContent(getInputTypeCallFragment(scope), c => (hasInput ? `input: ${c}` : ''));
    const resolverScopeFragment = getResolverScopeInitializationFragment(hasResolver, hasAccounts, hasAnyArgs);
    const returnStatementFragment = getReturnStatementFragment({
        ...scope,
        hasByteDeltas,
        hasData,
        hasDataArgs,
        hasRemainingAccounts,
        instructionNode,
        syncReturnTypeFragment: getReturnTypeFragment(instructionTypeFragment, hasByteDeltas, false),
    });
    // Skip the `args` declaration unless a fragment actually references it; otherwise
    // it's dead (e.g. a sync builder whose only arg feeds an async-only PDA seed).
    const argsIsReferenced =
        hasAnyArgs &&
        [resolverScopeFragment, resolvedInputFragment, returnStatementFragment].some(
            f => f !== undefined && /\bargs\b/.test(f.content),
        );
    const functionBody = mergeFragments(
        [
            getProgramAddressInitializationFragment(programAddressConstant),
            getAccountsInitializationFragment(instructionNode),
            argsIsReferenced ? getArgumentsInitializationFragment(hasAnyArgs, renamedArgs) : undefined,
            resolverScopeFragment,
            resolvedInputFragment,
            returnStatementFragment,
        ],
        cs => cs.join('\n\n'),
    );

    const functionFragment = fragment`export ${useAsync ? 'async ' : ''}function ${functionName}${typeParams}(${inputArg}): ${returnType} {
  ${functionBody}
}`;

    return mergeFragments([inputType, functionFragment], cs => cs.join('\n\n'));
}

function getProgramAddressInitializationFragment(programAddressConstant: Fragment): Fragment {
    return fragment`// Program address.
const programAddress = ${programAddressConstant};`;
}

function getAccountsInitializationFragment(instructionNode: InstructionNode): Fragment | undefined {
    const instructionAccounts = instructionNode.accounts ?? [];
    if (instructionAccounts.length === 0) return;

    const accounts = mergeFragments(
        instructionAccounts.map(account => {
            const name = camelCase(account.name);
            const isWritable = account.isWritable ? 'true' : 'false';
            return fragment`${name}: { value: input.${name} ?? null, isWritable: ${isWritable} }`;
        }),
        cs => cs.join(', '),
    );

    return fragment` // Original accounts.
const originalAccounts = { ${accounts} }
const accounts = originalAccounts as Record<keyof typeof originalAccounts, ${use('type ResolvedInstructionAccount', 'solanaProgramClientCore')}>;
`;
}

function getArgumentsInitializationFragment(
    hasAnyArgs: boolean,
    renamedArgs: Map<string, string>,
): Fragment | undefined {
    if (!hasAnyArgs) return;
    const renamedArgsText = [...renamedArgs.entries()].map(([k, v]) => `${k}: input.${v}`).join(', ');

    return fragment`// Original args.
const args = { ...input, ${renamedArgsText} };
`;
}

function getResolverScopeInitializationFragment(
    hasResolver: boolean,
    hasAccounts: boolean,
    hasAnyArgs: boolean,
): Fragment | undefined {
    if (!hasResolver) return;

    const resolverAttributes = [
        'programAddress',
        ...(hasAccounts ? ['accounts'] : []),
        ...(hasAnyArgs ? ['args'] : []),
    ].join(', ');

    return fragment`// Resolver scope.
const resolverScope = { ${resolverAttributes} };`;
}

function getReturnStatementFragment(
    scope: Pick<RenderScope, 'customInstructionData' | 'nameApi'> & {
        dataArgsManifest: TypeManifest;
        hasByteDeltas: boolean;
        hasData: boolean;
        hasDataArgs: boolean;
        hasRemainingAccounts: boolean;
        instructionNode: InstructionNode;
        syncReturnTypeFragment: Fragment;
    },
): Fragment {
    const { instructionNode, hasByteDeltas, hasData, hasDataArgs, hasRemainingAccounts, nameApi } = scope;
    const optionalAccountStrategy = instructionNode.optionalAccountStrategy ?? 'programId';
    const instructionAccounts = instructionNode.accounts ?? [];
    const hasAccounts = instructionAccounts.length > 0;
    const hasLegacyOptionalAccounts =
        instructionNode.optionalAccountStrategy === 'omitted' &&
        instructionAccounts.some(account => account.isOptional);

    const getAccountMeta = hasAccounts
        ? fragment`const getAccountMeta = ${use('getAccountMetaFactory', 'solanaProgramClientCore')}(programAddress, '${optionalAccountStrategy}');`
        : '';

    const accountItems = [
        ...instructionAccounts.map(
            account => `getAccountMeta("${camelCase(account.name)}", accounts.${camelCase(account.name)})`,
        ),
        ...(hasRemainingAccounts ? ['...remainingAccounts'] : []),
    ].join(', ');
    let accounts: Fragment | undefined;
    if (hasAccounts && hasLegacyOptionalAccounts) {
        accounts = fragment`accounts: [${accountItems}].filter(<T>(x: T | undefined): x is T => x !== undefined)`;
    } else if (hasAccounts) {
        accounts = fragment`accounts: [${accountItems}]`;
    } else if (hasRemainingAccounts) {
        accounts = fragment`accounts: remainingAccounts`;
    }

    const customData = scope.customInstructionData.get(instructionNode.name);
    const instructionDataName = nameApi.instructionDataType(instructionNode.name);
    const encoderFunctionFragment = customData
        ? scope.dataArgsManifest.encoder
        : `${nameApi.encoderFunction(instructionDataName)}()`;
    const argsTypeFragment = customData ? scope.dataArgsManifest.looseType : nameApi.dataArgsType(instructionDataName);
    let data: Fragment | undefined;
    if (hasDataArgs) {
        data = fragment`data: ${encoderFunctionFragment}.encode(args as ${argsTypeFragment})`;
    } else if (hasData) {
        data = fragment`data: ${encoderFunctionFragment}.encode({})`;
    }

    const instructionAttributes = pipe(
        [accounts, hasByteDeltas ? fragment`byteDelta` : undefined, data, fragment`programAddress`],
        fs => mergeFragments(fs, cs => cs.join(', ')),
    );

    return fragment`${getAccountMeta}\nreturn Object.freeze({ ${instructionAttributes} } as ${scope.syncReturnTypeFragment});`;
}

function getReturnTypeFragment(instructionTypeFragment: Fragment, hasByteDeltas: boolean, useAsync: boolean): Fragment {
    return pipe(
        instructionTypeFragment,
        f => (hasByteDeltas ? fragment`${f} & ${use('type InstructionWithByteDelta', 'solanaProgramClientCore')}` : f),
        f => (useAsync ? fragment`Promise<${f}>` : f),
    );
}

function getTypeParamsFragment(instructionNode: InstructionNode): Fragment {
    const accounts = instructionNode.accounts ?? [];
    if (accounts.length === 0) return fragment``;

    return mergeFragments(
        accounts.map(account => fragment`TAccount${pascalCase(account.name)} extends string`),
        cs => `<${cs.join(', ')}>`,
    );
}

function getInstructionTypeFragment(scope: {
    instructionPath: NodePath<InstructionNode>;
    nameApi: NameApi;
    programAddressConstant: Fragment;
}): Fragment {
    const { instructionPath, nameApi, programAddressConstant } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);
    const instructionTypeName = nameApi.instructionType(instructionNode.name);
    const accountTypeParamsFragments = (instructionNode.accounts ?? []).map(account => {
        const typeParam = fragment`TAccount${pascalCase(account.name)}`;
        const camelName = camelCase(account.name);

        if (account.isSigner === 'either') {
            const signerRole = use(
                account.isWritable ? 'type WritableSignerAccount' : 'type ReadonlySignerAccount',
                'solanaInstructions',
            );
            return pipe(
                fragment`typeof input["${camelName}"] extends TransactionSigner<${typeParam}> ? ${signerRole}<${typeParam}> & AccountSignerMeta<${typeParam}> : ${typeParam}`,
                f => addFragmentImports(f, 'solanaSigners', ['type AccountSignerMeta', 'type TransactionSigner']),
            );
        }

        return typeParam;
    });

    return pipe(
        mergeFragments([fragment`typeof ${programAddressConstant}`, ...accountTypeParamsFragments], c => c.join(', ')),
        f => mapFragmentContent(f, c => `${instructionTypeName}<${c}>`),
    );
}

function getInputTypeCallFragment(scope: {
    instructionPath: NodePath<InstructionNode>;
    nameApi: NameApi;
    useAsync: boolean;
}): Fragment {
    const { instructionPath, useAsync, nameApi } = scope;
    const instructionNode = getLastNodeFromPath(instructionPath);
    const inputTypeName = useAsync
        ? nameApi.instructionAsyncInputType(instructionNode.name)
        : nameApi.instructionSyncInputType(instructionNode.name);
    const instructionAccounts = instructionNode.accounts ?? [];
    if (instructionAccounts.length === 0) return fragment`${inputTypeName}`;
    const accountTypeParams = instructionAccounts.map(account => `TAccount${pascalCase(account.name)}`).join(', ');

    return fragment`${inputTypeName}<${accountTypeParams}>`;
}
