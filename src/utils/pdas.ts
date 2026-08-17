import {
    CamelCaseString,
    getAllPrograms,
    InstructionAccountNode,
    InstructionArgumentNode,
    InstructionByteDeltaValue,
    InstructionInputValueNode,
    InstructionNode,
    isNode,
    Node,
    PdaNode,
    PdaValueNode,
    ProgramNode,
} from '@codama/nodes';
import {
    findProgramNodeFromPath,
    getLastNodeFromPath,
    getNodePathUntilLastNode,
    LinkableDictionary,
    NodePath,
    pipe,
    tapVisitor,
    visit,
    voidVisitor,
} from '@codama/visitors-core';

import { ComputedPda, computePdaAddress } from './computePda';

const CACHE = new WeakMap<LinkableDictionary, WeakMap<Node, ReadonlySet<PdaNode>>>();
const PRECOMPUTED_CACHE = new WeakMap<LinkableDictionary, WeakMap<Node, ReadonlyMap<PdaNode, ComputedPda>>>();
/** Inline PDAs have no scope to key off, so they memoise per node and deriving program. */
const INLINE_PDA_CACHE = new WeakMap<PdaNode, Map<string, ComputedPda | null>>();

/**
 * Whether a `pdaValueNode` derives its PDA under a program only known at runtime. A program
 * reference alone is not enough: Codama pins the resolved address onto the `PdaNode` whenever the
 * referenced account is address-constrained, leaving the reference exactly one legal value.
 */
export function hasRuntimeProgramIdOverride(pdaValue: PdaValueNode, pda: PdaNode): boolean {
    if (!isNode(pdaValue.programId, ['accountValueNode', 'argumentValueNode'])) return false;
    return !pda.programId;
}

/**
 * The PDAs a use-site derives under a runtime program; only their finders keep a `programAddress`
 * parameter. Inline `pdaNode` values never qualify — the renderer derives those inline rather than
 * calling the finder. The scan spans every program of a root: they share one `pdas` folder.
 */
export function getPdasWithProgramIdOverride(
    pdaPath: NodePath<PdaNode>,
    linkables: LinkableDictionary,
): ReadonlySet<PdaNode> {
    const scope = getPdaScope(pdaPath);
    if (!scope) return new Set();
    const { programPaths, scopeNode } = scope;

    const scopeCache = CACHE.get(linkables) ?? new WeakMap<Node, ReadonlySet<PdaNode>>();
    CACHE.set(linkables, scopeCache);
    const cached = scopeCache.get(scopeNode);
    if (cached) return cached;

    const pdas = new Set<PdaNode>();
    for (const programPath of programPaths) {
        visit(
            getLastNodeFromPath(programPath),
            pipe(voidVisitor(), v =>
                tapVisitor(v, 'pdaValueNode', node => {
                    if (!isNode(node.pda, 'pdaLinkNode')) return;
                    const linkedPda = linkables.get([...programPath, node.pda]);
                    if (!linkedPda) return;
                    if (!hasRuntimeProgramIdOverride(node, linkedPda)) return;
                    pdas.add(linkedPda);
                }),
            ),
        );
    }

    scopeCache.set(scopeNode, pdas);
    return pdas;
}

/**
 * The PDAs of a scope whose address resolves at generation time. Finders and every use-site read
 * this one map — resolve an address anywhere else and the two can disagree. Any PDA path in the
 * scope will do; only the enclosing root or program is read.
 */
export function getPrecomputedPdas(
    pdaPath: NodePath<PdaNode>,
    linkables: LinkableDictionary,
): ReadonlyMap<PdaNode, ComputedPda> {
    const scope = getPdaScope(pdaPath);
    if (!scope) return new Map();
    const { programPaths, scopeNode } = scope;

    const scopeCache = PRECOMPUTED_CACHE.get(linkables) ?? new WeakMap<Node, ReadonlyMap<PdaNode, ComputedPda>>();
    PRECOMPUTED_CACHE.set(linkables, scopeCache);
    const cached = scopeCache.get(scopeNode);
    if (cached) return cached;

    const overridden = getPdasWithProgramIdOverride(pdaPath, linkables);
    const precomputed = new Map<PdaNode, ComputedPda>();
    for (const programPath of programPaths) {
        const programNode = getLastNodeFromPath(programPath);
        for (const pdaNode of programNode.pdas ?? []) {
            if (overridden.has(pdaNode)) continue;
            const computed = computePdaAddress(pdaNode.seeds ?? [], pdaNode.programId ?? programNode.publicKey);
            if (computed) precomputed.set(pdaNode, computed);
        }
    }

    scopeCache.set(scopeNode, precomputed);
    return precomputed;
}

/**
 * The address and bump a PDA default resolves to here, or `undefined` when only the caller knows them.
 * {@link isPdaValueResolvedAtGenerationTime} is defined in terms of this so the two cannot disagree.
 */
export function getResolvedPdaValue(
    pdaValue: PdaValueNode,
    instructionPath: NodePath<InstructionNode>,
    linkables: LinkableDictionary,
): ComputedPda | undefined {
    // Inline `pdaNode` values have no finder, so they resolve here rather than via the precomputed
    // map; leaving them unresolved keeps the instruction needlessly asynchronous.
    if (isNode(pdaValue.pda, 'pdaNode')) {
        return getResolvedInlinePdaValue(pdaValue, pdaValue.pda, instructionPath);
    }
    const linkedPda = linkables.get([...instructionPath, pdaValue.pda]);
    if (!linkedPda) return undefined;
    return getPrecomputedPdas([...instructionPath, linkedPda] as NodePath<PdaNode>, linkables).get(linkedPda);
}

/**
 * Resolves the deriving program in the order `instructionInputDefault.ts` renders, and must keep
 * mirroring it: the pin on the `pdaNode` wins, a runtime reference means unknown, else the
 * enclosing program.
 */
function getResolvedInlinePdaValue(
    pdaValue: PdaValueNode,
    pda: PdaNode,
    instructionPath: NodePath<InstructionNode>,
): ComputedPda | undefined {
    const programAddress =
        pda.programId ??
        (isNode(pdaValue.programId, ['accountValueNode', 'argumentValueNode'])
            ? undefined
            : findProgramNodeFromPath(instructionPath)?.publicKey);
    if (!programAddress) return undefined;

    // Keyed by program as well as node: the same node could sit under two programs.
    const byProgram = INLINE_PDA_CACHE.get(pda) ?? new Map<string, ComputedPda | null>();
    INLINE_PDA_CACHE.set(pda, byProgram);
    const cached = byProgram.get(programAddress);
    if (cached !== undefined) return cached ?? undefined;

    const computed = computePdaAddress(pda.seeds ?? [], programAddress);
    byProgram.set(programAddress, computed);
    return computed ?? undefined;
}

/**
 * Single source of truth for whether a PDA default is known here, which is exactly when its finder
 * renders synchronously. `async.ts` and the builder both read it; deciding this anywhere else makes
 * a builder and its input type disagree about which defaults are applied.
 */
export function isPdaValueResolvedAtGenerationTime(
    pdaValue: PdaValueNode,
    instructionPath: NodePath<InstructionNode>,
    linkables: LinkableDictionary,
): boolean {
    return !!getResolvedPdaValue(pdaValue, instructionPath, linkables);
}

/**
 * Whether the builder can assign the address constant instead of calling the finder. Narrows, never
 * contradicts, {@link isPdaValueResolvedAtGenerationTime}: an argument keeps the finder because its
 * codec expects what the finder returns, and both paths call a synchronous finder either way.
 */
export function isPdaValueFoldedToAddress(
    pdaValue: PdaValueNode,
    input: Pick<InstructionAccountNode | InstructionArgumentNode, 'kind' | 'name'>,
    instructionPath: NodePath<InstructionNode>,
    linkables: LinkableDictionary,
): boolean {
    if (input.kind !== 'instructionAccountNode') return false;
    if (!isPdaValueResolvedAtGenerationTime(pdaValue, instructionPath, linkables)) return false;
    return !instructionReadsAccountBump(getLastNodeFromPath(instructionPath), input.name);
}

/**
 * Whether any value the instruction resolves is a resolver call. A resolver body is opaque and may
 * read any account, so every rule that turns on "is this account referenced" gives up here.
 */
export function instructionHasResolver(instructionNode: InstructionNode): boolean {
    return someInstructionInputValue(instructionNode, value => isNode(value, 'resolverValueNode'));
}

/**
 * Whether anything else in the instruction derives from this account, skipping the account's own
 * default. Such a reader emits `getAddressFromResolvedInstructionAccount(…)`, which throws on a
 * value the builder left null.
 */
export function instructionReadsAccount(instructionNode: InstructionNode, accountName: CamelCaseString): boolean {
    return someInstructionInputValue(
        instructionNode,
        value => {
            if (isNode(value, 'accountFieldValueNode')) return value.account === accountName;
            if (isNode(value, ['accountBumpValueNode', 'accountValueNode'])) return value.name === accountName;
            return false;
        },
        input => isNode(input, 'instructionAccountNode') && input.name === accountName,
    );
}

/**
 * An account whose bump is read must keep the whole `ProgramDerivedAddress` tuple the bump comes out
 * of, so its default cannot fold to a bare address constant.
 */
export function instructionReadsAccountBump(instructionNode: InstructionNode, accountName: CamelCaseString): boolean {
    return someInstructionInputValue(
        instructionNode,
        value => isNode(value, 'accountBumpValueNode') && value.name === accountName,
    );
}

/** A value reached by {@link someInstructionInputValue}. Byte deltas widen the union with `accountLinkNode`. */
export type InstructionInputValue = InstructionByteDeltaValue | InstructionInputValueNode;

/**
 * Whether any value the instruction resolves satisfies `predicate`. Values also nest inside
 * conditional branches, PDA seeds and program ids, and resolver dependencies; add new containers
 * here rather than writing a second walk.
 */
export function someInstructionInputValue(
    instructionNode: InstructionNode,
    predicate: (value: InstructionInputValue) => boolean,
    skipInput?: (input: InstructionAccountNode | InstructionArgumentNode) => boolean,
): boolean {
    const inputs = [
        ...(instructionNode.accounts ?? []),
        ...(instructionNode.arguments ?? []),
        ...(instructionNode.extraArguments ?? []),
    ].filter(input => !skipInput?.(input));

    return (
        inputs.some(input => someNestedInputValue(input.defaultValue, predicate)) ||
        (instructionNode.byteDeltas ?? []).some(({ value }) => someNestedInputValue(value, predicate)) ||
        (instructionNode.remainingAccounts ?? []).some(({ value }) => someNestedInputValue(value, predicate))
    );
}

function someNestedInputValue(
    value: InstructionInputValue | undefined,
    predicate: (value: InstructionInputValue) => boolean,
): boolean {
    if (!value) return false;
    if (predicate(value)) return true;
    if (isNode(value, 'pdaValueNode')) {
        return (
            (value.seeds ?? []).some(seed => someNestedInputValue(seed.value, predicate)) ||
            someNestedInputValue(value.programId, predicate)
        );
    }
    if (isNode(value, 'conditionalValueNode')) {
        return (
            someNestedInputValue(value.condition, predicate) ||
            someNestedInputValue(value.ifTrue, predicate) ||
            someNestedInputValue(value.ifFalse, predicate)
        );
    }
    if (isNode(value, 'resolverValueNode')) {
        return (value.dependsOn ?? []).some(dependency => someNestedInputValue(dependency, predicate));
    }
    return false;
}

function getPdaScope(
    pdaPath: NodePath<PdaNode>,
): { programPaths: NodePath<ProgramNode>[]; scopeNode: Node } | undefined {
    const scopePath = (getNodePathUntilLastNode(pdaPath, 'rootNode') ??
        getNodePathUntilLastNode(pdaPath, 'programNode')) as NodePath<Node> | undefined;
    if (!scopePath) return;
    const scopeNode = getLastNodeFromPath(scopePath);

    const basePath: NodePath = scopePath;
    const programPaths: NodePath<ProgramNode>[] = isNode(scopeNode, 'rootNode')
        ? getAllPrograms(scopeNode).map(program => [...basePath, program])
        : [scopePath as NodePath<ProgramNode>];

    return { programPaths, scopeNode };
}
