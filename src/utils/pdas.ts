import {
    CamelCaseString,
    getAllPrograms,
    InstructionAccountNode,
    InstructionArgumentNode,
    InstructionInputValueNode,
    InstructionNode,
    isNode,
    Node,
    PdaNode,
    PdaValueNode,
    ProgramNode,
} from '@codama/nodes';
import {
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
    // Inline `pdaNode` values are derived inline; there is no finder to fold.
    if (!isNode(pdaValue.pda, 'pdaLinkNode')) return undefined;
    const linkedPda = linkables.get([...instructionPath, pdaValue.pda]);
    if (!linkedPda) return undefined;
    return getPrecomputedPdas([...instructionPath, linkedPda] as NodePath<PdaNode>, linkables).get(linkedPda);
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
 * An account whose bump is read must keep the whole `ProgramDerivedAddress` tuple the bump comes out
 * of, so its default cannot fold to a bare address constant.
 */
export function instructionReadsAccountBump(instructionNode: InstructionNode, accountName: CamelCaseString): boolean {
    const readsBump = (value: InstructionInputValueNode | undefined): boolean => {
        if (!value) return false;
        if (isNode(value, 'accountBumpValueNode')) return value.name === accountName;
        if (isNode(value, 'conditionalValueNode')) {
            return readsBump(value.condition) || readsBump(value.ifTrue) || readsBump(value.ifFalse);
        }
        return false;
    };

    return [
        ...(instructionNode.accounts ?? []),
        ...(instructionNode.arguments ?? []),
        ...(instructionNode.extraArguments ?? []),
    ].some(input => readsBump(input.defaultValue));
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
