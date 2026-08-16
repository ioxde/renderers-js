import {
    AccountFieldValueNode,
    AccountValueNode,
    accountValueNode,
    ArgumentValueNode,
    argumentValueNode,
    CamelCaseString,
    IdentityValueNode,
    InstructionAccountNode,
    InstructionArgumentNode,
    InstructionInputValueNode,
    InstructionNode,
    isNode,
    isNodeFilter,
    PayerValueNode,
} from '@codama/nodes';
import { deduplicateInstructionDependencies, ResolvedInstructionInput } from '@codama/visitors-core';

/**
 * The argument shape of an instruction's generated builder.
 *
 * @see {@link getInstructionInputShape}
 */
export type InstructionInputShape = {
    /** Whether any caller-supplied argument reaches the builder's `args` object. */
    hasAnyArgs: boolean;
    /** Whether the instruction's data encoder receives caller-supplied arguments. */
    hasDataArgs: boolean;
    /** Whether the builder takes an `input` parameter at all. */
    hasInput: boolean;
};

/**
 * Computes whether an instruction's generated builder takes an `input` parameter and what
 * that input carries. An instruction with no accounts and no caller-supplied arguments
 * renders a zero-parameter builder, so callers must not pass one.
 *
 * @param instructionNode - The instruction whose builder is being rendered.
 * @param options - The resolver names, whether the instruction has custom data, and whether
 * the async variant is being rendered — all of which can change the argument shape.
 * @return The flags describing the builder's argument shape.
 *
 * @example
 * ```ts
 * const { hasInput } = getInstructionInputShape(instructionNode, {
 *     asyncResolvers,
 *     hasCustomData: customInstructionData.has(instructionNode.name),
 *     useAsync: false,
 * });
 * ```
 */
export function getInstructionInputShape(
    instructionNode: InstructionNode,
    options: { asyncResolvers: CamelCaseString[]; hasCustomData: boolean; useAsync: boolean },
): InstructionInputShape {
    const { asyncResolvers, hasCustomData, useAsync } = options;
    const dependencies = getInstructionDependencies(instructionNode, asyncResolvers, useAsync);
    const argDependencies = dependencies.filter(isNodeFilter('argumentValueNode')).map(node => node.name);
    const argIsNotOmitted = (arg: InstructionArgumentNode) =>
        !(arg.defaultValue && arg.defaultValueStrategy === 'omitted');
    const argIsDependent = (arg: InstructionArgumentNode) => argDependencies.includes(arg.name);
    const argHasDefaultValue = (arg: InstructionArgumentNode) => {
        if (!arg.defaultValue) return false;
        if (useAsync) return true;
        return !isAsyncDefaultValue(arg.defaultValue, asyncResolvers);
    };

    const hasDataArgs = hasCustomData || (instructionNode.arguments ?? []).filter(argIsNotOmitted).length > 0;
    const hasExtraArgs =
        (instructionNode.extraArguments ?? []).filter(
            field => argIsNotOmitted(field) && (argIsDependent(field) || argHasDefaultValue(field)),
        ).length > 0;
    const hasRemainingAccountArgs =
        (instructionNode.remainingAccounts ?? []).filter(({ value }) => isNode(value, 'argumentValueNode')).length > 0;
    const hasAnyArgs = hasDataArgs || hasExtraArgs || hasRemainingAccountArgs;

    return { hasAnyArgs, hasDataArgs, hasInput: (instructionNode.accounts ?? []).length > 0 || hasAnyArgs };
}

export function hasAsyncFunction(
    instructionNode: InstructionNode,
    resolvedInputs: ResolvedInstructionInput[],
    asyncResolvers: string[],
): boolean {
    const hasByteDeltasAsync = (instructionNode.byteDeltas ?? []).some(
        ({ value }) => isNode(value, 'resolverValueNode') && asyncResolvers.includes(value.name),
    );
    const hasRemainingAccountsAsync = (instructionNode.remainingAccounts ?? []).some(
        ({ value }) => isNode(value, 'resolverValueNode') && asyncResolvers.includes(value.name),
    );

    return hasAsyncDefaultValues(resolvedInputs, asyncResolvers) || hasByteDeltasAsync || hasRemainingAccountsAsync;
}

export function hasAsyncDefaultValues(resolvedInputs: ResolvedInstructionInput[], asyncResolvers: string[]): boolean {
    return resolvedInputs.some(
        input => !!input.defaultValue && isAsyncDefaultValue(input.defaultValue, asyncResolvers),
    );
}

export function isAsyncDefaultValue(defaultValue: InstructionInputValueNode, asyncResolvers: string[]): boolean {
    switch (defaultValue.kind) {
        case 'pdaValueNode':
            return true;
        case 'resolverValueNode':
            return asyncResolvers.includes(defaultValue.name);
        case 'conditionalValueNode':
            return (
                isAsyncDefaultValue(defaultValue.condition, asyncResolvers) ||
                (defaultValue.ifFalse == null ? false : isAsyncDefaultValue(defaultValue.ifFalse, asyncResolvers)) ||
                (defaultValue.ifTrue == null ? false : isAsyncDefaultValue(defaultValue.ifTrue, asyncResolvers))
            );
        default:
            return false;
    }
}

/**
 * Whether the sync builder skips this default entirely, i.e. it is async-only and never read on the sync path.
 * Route any new sync/async rendering decision through this so builders and input types cannot disagree.
 */
export function isDefaultValueSkippedOnSyncPath(
    defaultValue: InstructionInputValueNode | undefined,
    asyncResolvers: string[],
    useAsync: boolean,
): boolean {
    return !useAsync && !!defaultValue && isAsyncDefaultValue(defaultValue, asyncResolvers);
}

/**
 * Whether the rendered builder applies this default. No builder resolves identity or payer values;
 * account-field values only resolve at display time by fetching the account; async-only defaults never run on the sync path.
 * Default rendering and input optionality both gate on this — route new consumers through it so types never promise a default the builder skips.
 */
export function isDefaultValueAppliedByBuilder(
    defaultValue: InstructionInputValueNode | undefined,
    asyncResolvers: string[],
    useAsync: boolean,
): defaultValue is Exclude<InstructionInputValueNode, AccountFieldValueNode | IdentityValueNode | PayerValueNode> {
    if (!defaultValue) return false;
    if (isNode(defaultValue, ['accountFieldValueNode', 'identityValueNode', 'payerValueNode'])) return false;
    return !isDefaultValueSkippedOnSyncPath(defaultValue, asyncResolvers, useAsync);
}

export function getInstructionDependencies(
    input: InstructionAccountNode | InstructionArgumentNode | InstructionNode,
    asyncResolvers: string[],
    useAsync: boolean,
): (AccountValueNode | ArgumentValueNode)[] {
    if (isNode(input, 'instructionNode')) {
        return deduplicateInstructionDependencies([
            ...(input.accounts ?? []).flatMap(x => getInstructionDependencies(x, asyncResolvers, useAsync)),
            ...(input.arguments ?? []).flatMap(x => getInstructionDependencies(x, asyncResolvers, useAsync)),
            ...(input.extraArguments ?? []).flatMap(x => getInstructionDependencies(x, asyncResolvers, useAsync)),
        ]);
    }

    if (!input.defaultValue) return [];

    const getNestedDependencies = (
        defaultValue: InstructionInputValueNode | undefined,
    ): (AccountValueNode | ArgumentValueNode)[] => {
        if (!defaultValue) return [];
        return getInstructionDependencies({ ...input, defaultValue }, asyncResolvers, useAsync);
    };

    if (isNode(input.defaultValue, ['accountValueNode', 'accountBumpValueNode'])) {
        return [accountValueNode(input.defaultValue.name)];
    }

    if (isNode(input.defaultValue, ['argumentValueNode'])) {
        return [argumentValueNode(input.defaultValue.name)];
    }

    if (isNode(input.defaultValue, 'pdaValueNode')) {
        const dependencies = new Map<CamelCaseString, AccountValueNode | ArgumentValueNode>();
        (input.defaultValue.seeds ?? []).forEach(seed => {
            if (isNode(seed.value, ['accountValueNode', 'argumentValueNode'])) {
                dependencies.set(seed.value.name, { ...seed.value });
            }
        });
        return [...dependencies.values()];
    }

    if (isNode(input.defaultValue, 'resolverValueNode')) {
        const isSynchronousResolver = !asyncResolvers.includes(input.defaultValue.name);
        if (useAsync || isSynchronousResolver) {
            return input.defaultValue.dependsOn ?? [];
        }
    }

    if (isNode(input.defaultValue, 'conditionalValueNode')) {
        return deduplicateInstructionDependencies([
            ...getNestedDependencies(input.defaultValue.condition),
            ...getNestedDependencies(input.defaultValue.ifTrue),
            ...getNestedDependencies(input.defaultValue.ifFalse),
        ]);
    }

    return [];
}
