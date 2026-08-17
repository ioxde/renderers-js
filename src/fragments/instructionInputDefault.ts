/* eslint-disable no-case-declarations */
import { camelCase, InstructionInputValueNode, InstructionNode, isNode, PdaNode } from '@codama/nodes';
import { mapFragmentContent, setFragmentContent } from '@codama/renderers-core';
import { getLastNodeFromPath, NodePath, pipe, ResolvedInstructionInput, visit } from '@codama/visitors-core';

import {
    addFragmentFeatures,
    addFragmentImports,
    AsyncScope,
    Fragment,
    fragment,
    getPdasWithProgramIdOverride,
    getResolvedPdaValue,
    isDefaultSkippedForOptionalAccount,
    isDefaultValueAppliedByBuilder,
    isPdaValueFoldedToAddress,
    isPdaValueResolvedAtGenerationTime,
    mergeFragments,
    RenderScope,
    use,
} from '../utils';

export function getInstructionInputDefaultFragment(
    scope: Pick<RenderScope, 'asyncResolvers' | 'getImportFrom' | 'linkables' | 'nameApi' | 'typeManifestVisitor'> & {
        asyncScope: AsyncScope;
        input: ResolvedInstructionInput;
        instructionPath: NodePath<InstructionNode>;
        useAsync: boolean;
    },
): Fragment {
    const {
        input,
        instructionPath,
        linkables,
        asyncResolvers,
        asyncScope,
        useAsync,
        nameApi,
        typeManifestVisitor,
        getImportFrom,
    } = scope;
    if (!input.defaultValue) {
        return fragment``;
    }

    if (!isDefaultValueAppliedByBuilder(input.defaultValue, asyncScope, useAsync)) {
        return fragment``;
    }

    // An IDL-optional account nothing else reads gets no builder-applied default, for any default
    // kind, so omitting it stays expressible.
    if (isDefaultSkippedForOptionalAccount(input, getLastNodeFromPath(instructionPath))) {
        return fragment``;
    }

    const { defaultValue } = input;
    const defaultFragment = (renderedValue: Fragment, isWritable?: boolean): Fragment => {
        const inputName = camelCase(input.name);
        if (input.kind === 'instructionAccountNode' && isNode(defaultValue, 'resolverValueNode')) {
            return fragment`accounts.${inputName} = { ...accounts.${inputName}, ...${renderedValue} };`;
        }
        if (input.kind === 'instructionAccountNode' && isWritable === undefined) {
            return fragment`accounts.${inputName}.value = ${renderedValue};`;
        }
        if (input.kind === 'instructionAccountNode') {
            return fragment`accounts.${inputName}.value = ${renderedValue};\naccounts.${inputName}.isWritable = ${isWritable ? 'true' : 'false'}`;
        }
        return fragment`args.${inputName} = ${renderedValue};`;
    };

    const getNonNullResolvedInstructionInput = use('getNonNullResolvedInstructionInput', 'solanaProgramClientCore');
    const getResolvedInstructionAccountAsTransactionSigner = use(
        'getResolvedInstructionAccountAsTransactionSigner',
        'solanaProgramClientCore',
    );
    const getAddressFromResolvedInstructionAccount = use(
        'getAddressFromResolvedInstructionAccount',
        'solanaProgramClientCore',
    );
    const getResolvedInstructionAccountAsProgramDerivedAddress = use(
        'getResolvedInstructionAccountAsProgramDerivedAddress',
        'solanaProgramClientCore',
    );
    const addressType = use('type Address', 'solanaAddresses');

    switch (defaultValue.kind) {
        case 'accountValueNode':
            const name = camelCase(defaultValue.name);
            if (input.kind === 'instructionAccountNode' && input.resolvedIsSigner && !input.isSigner) {
                return defaultFragment(
                    fragment`${getResolvedInstructionAccountAsTransactionSigner}("${name}", accounts.${name}.value).address`,
                );
            }
            if (input.kind === 'instructionAccountNode') {
                return defaultFragment(
                    fragment`${getNonNullResolvedInstructionInput}("${name}", accounts.${name}.value)`,
                );
            }
            return defaultFragment(
                fragment`${getAddressFromResolvedInstructionAccount}("${name}", accounts.${name}.value)`,
            );

        case 'pdaValueNode':
            let pdaProgramValue: Fragment | undefined;
            if (isNode(defaultValue.programId, 'accountValueNode')) {
                const name = camelCase(defaultValue.programId.name);
                pdaProgramValue = fragment`${getAddressFromResolvedInstructionAccount}("${name}", accounts.${name}.value)`;
            }
            if (isNode(defaultValue.programId, 'argumentValueNode')) {
                const name = camelCase(defaultValue.programId.name);
                pdaProgramValue = fragment`${getAddressFromResolvedInstructionAccount}("${name}", args.${name})`;
            }

            if (isNode(defaultValue.pda, 'pdaNode')) {
                // All-constant seeds mean one address; deriving it at runtime would await for a
                // value already known here. Bump readers keep the tuple.
                const resolvedInlinePda = getResolvedPdaValue(defaultValue, instructionPath, linkables);
                if (resolvedInlinePda) {
                    const { address, bump } = resolvedInlinePda;
                    const inlineAddress = fragment`'${address}' as ${addressType}<'${address}'>`;
                    if (isPdaValueFoldedToAddress(defaultValue, input, instructionPath, linkables)) {
                        return defaultFragment(inlineAddress);
                    }
                    const bumpType = use('type ProgramDerivedAddressBump', 'solanaAddresses');
                    return defaultFragment(fragment`[${inlineAddress}, ${bump} as ${bumpType}]`);
                }

                // Codama only sets `pda.programId` by resolving this very reference, so the pin takes priority.
                let pdaProgram = fragment`programAddress`;
                if (defaultValue.pda.programId) {
                    pdaProgram = fragment`'${defaultValue.pda.programId}' as ${addressType}<'${defaultValue.pda.programId}'>`;
                } else if (pdaProgramValue) {
                    pdaProgram = pdaProgramValue;
                }
                const pdaSeeds = (defaultValue.pda.seeds ?? []).flatMap((seed): Fragment[] => {
                    if (isNode(seed, 'constantPdaSeedNode') && isNode(seed.value, 'programIdValueNode')) {
                        return [fragment`${use('getAddressEncoder', 'solanaAddresses')}().encode(${pdaProgram})`];
                    }
                    if (isNode(seed, 'constantPdaSeedNode') && !isNode(seed.value, 'programIdValueNode')) {
                        const typeManifest = visit(seed.type, typeManifestVisitor);
                        const valueManifest = visit(seed.value, typeManifestVisitor);
                        return [fragment`${typeManifest.encoder}.encode(${valueManifest.value})`];
                    }
                    if (isNode(seed, 'variablePdaSeedNode')) {
                        const typeManifest = visit(seed.type, typeManifestVisitor);
                        const valueSeed = (defaultValue.seeds ?? []).find(s => s.name === seed.name)?.value;
                        if (!valueSeed) return [];
                        if (isNode(valueSeed, 'accountValueNode')) {
                            const name = camelCase(valueSeed.name);
                            return [
                                fragment`${typeManifest.encoder}.encode(${getAddressFromResolvedInstructionAccount}("${name}", accounts.${name}.value))`,
                            ];
                        }
                        if (isNode(valueSeed, 'argumentValueNode')) {
                            const name = camelCase(valueSeed.name);
                            return [
                                fragment`${typeManifest.encoder}.encode(${getNonNullResolvedInstructionInput}("${name}", args.${name}))`,
                            ];
                        }
                        const valueManifest = visit(valueSeed, typeManifestVisitor);
                        return [fragment`${typeManifest.encoder}.encode(${valueManifest.value})`];
                    }
                    return [];
                });
                const getProgramDerivedAddress = use('getProgramDerivedAddress', 'solanaAddresses');
                const programAddress =
                    pdaProgram.content === 'programAddress' ? pdaProgram : fragment`programAddress: ${pdaProgram}`;
                const seeds = mergeFragments(pdaSeeds, s => s.join(', '));
                return defaultFragment(
                    fragment`await ${getProgramDerivedAddress}({ ${programAddress}, seeds: [${seeds}] })`,
                );
            }

            const linkedPda = linkables.get([...instructionPath, defaultValue.pda]);
            const linkedPdaPath = linkedPda ? ([...instructionPath, linkedPda] as NodePath<PdaNode>) : undefined;

            if (linkedPda && isPdaValueFoldedToAddress(defaultValue, input, instructionPath, linkables)) {
                return defaultFragment(
                    use(nameApi.pdaAddressConstant(linkedPda.name), getImportFrom(defaultValue.pda)),
                );
            }

            const pdaFunction = use(nameApi.pdaFindFunction(defaultValue.pda.name), getImportFrom(defaultValue.pda));
            const pdaArgs: Fragment[] = [];
            const pdaSeeds = (defaultValue.seeds ?? []).map((seed): Fragment => {
                if (isNode(seed.value, 'accountValueNode')) {
                    const name = camelCase(seed.value.name);
                    return fragment`${seed.name}: ${getAddressFromResolvedInstructionAccount}("${name}", accounts.${name}.value)`;
                }
                if (isNode(seed.value, 'argumentValueNode')) {
                    const name = camelCase(seed.value.name);
                    return fragment`${seed.name}: ${getNonNullResolvedInstructionInput}("${name}", args.${name})`;
                }
                return pipe(visit(seed.value, typeManifestVisitor).value, f =>
                    mapFragmentContent(f, c => `${seed.name}: ${c}`),
                );
            });
            const pdaSeedsFragment = pipe(
                mergeFragments(pdaSeeds, renders => renders.join(', ')),
                f => mapFragmentContent(f, c => `{ ${c} }`),
            );
            if (pdaSeeds.length > 0) {
                pdaArgs.push(pdaSeedsFragment);
            }
            // Must stay the same predicate the finder's signature uses, or the call site stops matching it.
            if (linkedPdaPath && linkedPda && getPdasWithProgramIdOverride(linkedPdaPath, linkables).has(linkedPda)) {
                // Object shorthand for the `programAddress` local of the generated builder.
                pdaArgs.push(
                    pdaProgramValue ? fragment`{ programAddress: ${pdaProgramValue} }` : fragment`{ programAddress }`,
                );
            }
            // A resolved PDA that did not fold still calls the finder, but that finder is synchronous.
            const pdaAwait = isPdaValueResolvedAtGenerationTime(defaultValue, instructionPath, linkables)
                ? ''
                : 'await ';
            return defaultFragment(fragment`${pdaAwait}${pdaFunction}(${mergeFragments(pdaArgs, c => c.join(', '))})`);

        case 'publicKeyValueNode':
            return defaultFragment(
                fragment`'${defaultValue.publicKey}' as ${addressType}<'${defaultValue.publicKey}'>`,
            );

        case 'programLinkNode':
            const programAddress = use(nameApi.programAddressConstant(defaultValue.name), getImportFrom(defaultValue));
            return defaultFragment(programAddress, false);

        case 'programIdValueNode':
            // No optional-account branch here: one is either skipped above or read by another input.
            return defaultFragment(fragment`programAddress`, false);

        case 'accountBumpValueNode':
            return defaultFragment(
                fragment`${getResolvedInstructionAccountAsProgramDerivedAddress}("${camelCase(defaultValue.name)}", accounts.${camelCase(defaultValue.name)}.value)[1]`,
            );

        case 'argumentValueNode':
            return defaultFragment(
                fragment`${getNonNullResolvedInstructionInput}("${camelCase(defaultValue.name)}", args.${camelCase(defaultValue.name)})`,
            );

        case 'resolverValueNode':
            const resolverFunction = use(nameApi.resolverFunction(defaultValue.name), getImportFrom(defaultValue));
            const resolverAwait = useAsync && asyncResolvers.includes(defaultValue.name) ? 'await ' : '';
            return pipe(defaultFragment(fragment`${resolverAwait}${resolverFunction}(resolverScope)`), f =>
                addFragmentFeatures(f, ['instruction:resolverScopeVariable']),
            );

        case 'conditionalValueNode':
            const ifTrueRenderer = renderNestedInstructionDefault({
                ...scope,
                defaultValue: defaultValue.ifTrue,
            });
            const ifFalseRenderer = renderNestedInstructionDefault({
                ...scope,
                defaultValue: defaultValue.ifFalse,
            });
            if (!ifTrueRenderer && !ifFalseRenderer) {
                return fragment``;
            }
            let conditionalFragment = fragment``;
            if (ifTrueRenderer) {
                conditionalFragment = mergeFragments([conditionalFragment, ifTrueRenderer], c => c[0]);
            }
            if (ifFalseRenderer) {
                conditionalFragment = mergeFragments([conditionalFragment, ifFalseRenderer], c => c[0]);
            }
            const negatedCondition = !ifTrueRenderer;
            let condition = 'true';

            if (isNode(defaultValue.condition, 'resolverValueNode')) {
                const conditionalResolverFunction = nameApi.resolverFunction(defaultValue.condition.name);
                const module = getImportFrom(defaultValue.condition);
                conditionalFragment = pipe(
                    conditionalFragment,
                    f => addFragmentImports(f, module, [conditionalResolverFunction]),
                    f => addFragmentFeatures(f, ['instruction:resolverScopeVariable']),
                );
                const conditionalResolverAwait =
                    useAsync && asyncResolvers.includes(defaultValue.condition.name) ? 'await ' : '';
                condition = `${conditionalResolverAwait}${conditionalResolverFunction}(resolverScope)`;
                condition = negatedCondition ? `!${condition}` : condition;
            } else {
                const comparedInputName = isNode(defaultValue.condition, 'accountValueNode')
                    ? `accounts.${camelCase(defaultValue.condition.name)}.value`
                    : `args.${camelCase(defaultValue.condition.name)}`;
                if (defaultValue.value) {
                    const comparedValue = visit(defaultValue.value, typeManifestVisitor).value;
                    conditionalFragment = mergeFragments([conditionalFragment, comparedValue], c => c[0]);
                    const operator = negatedCondition ? '!==' : '===';
                    condition = `${comparedInputName} ${operator} ${comparedValue.content}`;
                } else {
                    condition = negatedCondition ? `!${comparedInputName}` : comparedInputName;
                }
            }

            if (ifTrueRenderer && ifFalseRenderer) {
                return setFragmentContent(
                    conditionalFragment,
                    `if (${condition}) {\n${ifTrueRenderer.content}\n} else {\n${ifFalseRenderer.content}\n}`,
                );
            }

            return setFragmentContent(
                conditionalFragment,
                `if (${condition}) {\n${ifTrueRenderer ? ifTrueRenderer.content : ifFalseRenderer?.content}\n}`,
            );

        case 'injectedValueNode':
            // Injected values are not yet supported as instruction input defaults by this renderer.
            // Account-field values never reach this switch: isDefaultValueAppliedByBuilder excludes them.
            throw new Error(`Unsupported instruction input default value node: [${defaultValue.kind}]`);

        default:
            const valueManifest = visit(defaultValue, typeManifestVisitor).value;
            return defaultFragment(valueManifest);
    }
}

function renderNestedInstructionDefault(
    scope: Parameters<typeof getInstructionInputDefaultFragment>[0] & {
        defaultValue: InstructionInputValueNode | undefined;
    },
): Fragment | undefined {
    const { input, defaultValue } = scope;
    if (!defaultValue) return undefined;
    return getInstructionInputDefaultFragment({
        ...scope,
        input: { ...input, defaultValue },
    });
}
