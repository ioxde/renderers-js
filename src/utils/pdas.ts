import { getAllPrograms, isNode, Node, PdaNode, PdaValueNode, ProgramNode } from '@codama/nodes';
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

const CACHE = new WeakMap<LinkableDictionary, WeakMap<Node, ReadonlySet<PdaNode>>>();

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
    const scopePath = (getNodePathUntilLastNode(pdaPath, 'rootNode') ??
        getNodePathUntilLastNode(pdaPath, 'programNode')) as NodePath<Node> | undefined;
    if (!scopePath) return new Set();
    const scopeNode = getLastNodeFromPath(scopePath);

    const scopeCache = CACHE.get(linkables) ?? new WeakMap<Node, ReadonlySet<PdaNode>>();
    CACHE.set(linkables, scopeCache);
    const cached = scopeCache.get(scopeNode);
    if (cached) return cached;

    const basePath: NodePath = scopePath;
    const programPaths: NodePath<ProgramNode>[] = isNode(scopeNode, 'rootNode')
        ? getAllPrograms(scopeNode).map(program => [...basePath, program])
        : [scopePath as NodePath<ProgramNode>];

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
