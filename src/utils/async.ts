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
    InstructionByteDeltaValue,
    InstructionInputValueNode,
    InstructionNode,
    isNode,
    isNodeFilter,
    PayerValueNode,
    PdaValueNode,
} from '@codama/nodes';
import {
    deduplicateInstructionDependencies,
    LinkableDictionary,
    NodePath,
    ResolvedInstructionInput,
} from '@codama/visitors-core';

import { isPdaValueResolvedAtGenerationTime } from './pdas';

/** What the renderer reads to decide whether a default value is asynchronous. */
export type AsyncScope = Readonly<{
    /** Names of resolvers the caller declared asynchronous. */
    asyncResolvers: string[];
    isResolvedPdaValue: (value: PdaValueNode) => boolean;
}>;

/**
 * The async policy for one instruction. Every sync/async decision for that instruction must read the
 * same scope, or its builder and its input type disagree about which defaults are applied.
 */
export function getAsyncScope(scope: {
    asyncResolvers: string[];
    instructionPath: NodePath<InstructionNode>;
    linkables: LinkableDictionary;
}): AsyncScope {
    const { asyncResolvers, instructionPath, linkables } = scope;
    return Object.freeze({
        asyncResolvers,
        isResolvedPdaValue: (value: PdaValueNode) =>
            isPdaValueResolvedAtGenerationTime(value, instructionPath, linkables),
    });
}

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
 * An instruction with no accounts and no caller-supplied arguments renders a zero-parameter builder,
 * so callers must not pass one.
 */
export function getInstructionInputShape(
    instructionNode: InstructionNode,
    options: { asyncScope: AsyncScope; hasCustomData: boolean; useAsync: boolean },
): InstructionInputShape {
    const { asyncScope, hasCustomData, useAsync } = options;
    const dependencies = getInstructionDependencies(instructionNode, asyncScope.asyncResolvers, useAsync);
    const argDependencies = dependencies.filter(isNodeFilter('argumentValueNode')).map(node => node.name);
    const argIsNotOmitted = (arg: InstructionArgumentNode) =>
        !(arg.defaultValue && arg.defaultValueStrategy === 'omitted');
    const argIsDependent = (arg: InstructionArgumentNode) => argDependencies.includes(arg.name);
    const argHasDefaultValue = (arg: InstructionArgumentNode) => {
        if (!arg.defaultValue) return false;
        if (useAsync) return true;
        return !isAsyncDefaultValue(arg.defaultValue, asyncScope);
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
    asyncScope: AsyncScope,
): boolean {
    const { asyncResolvers } = asyncScope;
    const hasByteDeltasAsync = (instructionNode.byteDeltas ?? []).some(
        ({ value }) => isNode(value, 'resolverValueNode') && asyncResolvers.includes(value.name),
    );
    const hasRemainingAccountsAsync = (instructionNode.remainingAccounts ?? []).some(
        ({ value }) => isNode(value, 'resolverValueNode') && asyncResolvers.includes(value.name),
    );

    return hasAsyncDefaultValues(resolvedInputs, asyncScope) || hasByteDeltasAsync || hasRemainingAccountsAsync;
}

export function hasAsyncDefaultValues(resolvedInputs: ResolvedInstructionInput[], asyncScope: AsyncScope): boolean {
    return resolvedInputs.some(input => !!input.defaultValue && isAsyncDefaultValue(input.defaultValue, asyncScope));
}

export function isAsyncDefaultValue(defaultValue: InstructionInputValueNode, asyncScope: AsyncScope): boolean {
    switch (defaultValue.kind) {
        case 'pdaValueNode':
            // A resolved PDA has a synchronous finder, so neither form the builder emits awaits.
            return !asyncScope.isResolvedPdaValue(defaultValue);
        case 'resolverValueNode':
            return asyncScope.asyncResolvers.includes(defaultValue.name);
        case 'conditionalValueNode':
            return (
                isAsyncDefaultValue(defaultValue.condition, asyncScope) ||
                (defaultValue.ifFalse == null ? false : isAsyncDefaultValue(defaultValue.ifFalse, asyncScope)) ||
                (defaultValue.ifTrue == null ? false : isAsyncDefaultValue(defaultValue.ifTrue, asyncScope))
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
    asyncScope: AsyncScope,
    useAsync: boolean,
): boolean {
    return !useAsync && !!defaultValue && isAsyncDefaultValue(defaultValue, asyncScope);
}

/**
 * Whether the rendered builder applies this default. No builder resolves identity or payer values;
 * account-field values only resolve at display time by fetching the account; async-only defaults never run on the sync path.
 * Default rendering and input optionality both gate on this — route new consumers through it so types never promise a default the builder skips.
 */
export function isDefaultValueAppliedByBuilder(
    defaultValue: InstructionInputValueNode | undefined,
    asyncScope: AsyncScope,
    useAsync: boolean,
): defaultValue is Exclude<InstructionInputValueNode, AccountFieldValueNode | IdentityValueNode | PayerValueNode> {
    if (!defaultValue) return false;
    if (isNode(defaultValue, ['accountFieldValueNode', 'identityValueNode', 'payerValueNode'])) return false;
    return !isDefaultValueSkippedOnSyncPath(defaultValue, asyncScope, useAsync);
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
            // Byte deltas read these values from the builder (`args.<name>`, or the resolver scope);
            // leaving them out emits code that references locals the builder never declares.
            ...(input.byteDeltas ?? []).flatMap(x => getValueDependencies(x.value, asyncResolvers, useAsync)),
        ]);
    }

    return getValueDependencies(input.defaultValue, asyncResolvers, useAsync);
}

function getValueDependencies(
    value: InstructionByteDeltaValue | InstructionInputValueNode | undefined,
    asyncResolvers: string[],
    useAsync: boolean,
): (AccountValueNode | ArgumentValueNode)[] {
    if (!value) return [];

    if (isNode(value, ['accountValueNode', 'accountBumpValueNode'])) {
        return [accountValueNode(value.name)];
    }

    if (isNode(value, ['argumentValueNode'])) {
        return [argumentValueNode(value.name)];
    }

    if (isNode(value, 'pdaValueNode')) {
        const dependencies = new Map<CamelCaseString, AccountValueNode | ArgumentValueNode>();
        (value.seeds ?? []).forEach(seed => {
            if (isNode(seed.value, ['accountValueNode', 'argumentValueNode'])) {
                dependencies.set(seed.value.name, { ...seed.value });
            }
        });
        return [...dependencies.values()];
    }

    if (isNode(value, 'resolverValueNode')) {
        const isSynchronousResolver = !asyncResolvers.includes(value.name);
        if (useAsync || isSynchronousResolver) {
            return value.dependsOn ?? [];
        }
    }

    if (isNode(value, 'conditionalValueNode')) {
        return deduplicateInstructionDependencies([
            ...getValueDependencies(value.condition, asyncResolvers, useAsync),
            ...getValueDependencies(value.ifTrue, asyncResolvers, useAsync),
            ...getValueDependencies(value.ifFalse, asyncResolvers, useAsync),
        ]);
    }

    return [];
}
