import { camelCase, isNode, isNodeFilter, PdaNode, PdaSeedNode, ProgramNode } from '@codama/nodes';
import { findProgramNodeFromPath, getLastNodeFromPath, NodePath, visit } from '@codama/visitors-core';

import {
    Fragment,
    fragment,
    getDocblockFragment,
    getPdasWithProgramIdOverride,
    mergeFragments,
    RenderScope,
    use,
} from '../utils';

type PdaFunctionScope = Pick<RenderScope, 'linkables' | 'nameApi' | 'typeManifestVisitor'> & {
    pdaPath: NodePath<PdaNode>;
};

export function getPdaFunctionFragment(scope: PdaFunctionScope): Fragment {
    const pdaNode = getLastNodeFromPath(scope.pdaPath);
    const programNode = findProgramNodeFromPath(scope.pdaPath)!;

    const hasProgramAddressConfig = getPdasWithProgramIdOverride(scope.pdaPath, scope.linkables).has(pdaNode);
    const programAddressValue = hasProgramAddressConfig
        ? fragment`programAddress`
        : getPinnedProgramAddressFragment(pdaNode, programNode, scope.nameApi);

    const seeds = parsePdaSeedNodes(pdaNode.seeds ?? [], { ...scope, programAddressValue });

    return mergeFragments(
        [
            getSeedInputTypeFragment(seeds, scope),
            getFunctionFragment(seeds, { ...scope, hasProgramAddressConfig, programAddressValue }),
        ],
        cs => cs.join('\n\n'),
    );
}

/**
 * The program a generation-time PDA derives under. Any program but the enclosing one inlines its
 * address; the enclosing program goes through its generated constant so the address has a single
 * source of truth.
 */
function getPinnedProgramAddressFragment(
    pdaNode: PdaNode,
    programNode: ProgramNode,
    nameApi: RenderScope['nameApi'],
): Fragment {
    if (pdaNode.programId && pdaNode.programId !== programNode.publicKey) {
        const addressType = use('type Address', 'solanaAddresses');
        return fragment`'${pdaNode.programId}' as ${addressType}<'${pdaNode.programId}'>`;
    }
    return use(nameApi.programAddressConstant(programNode.name), 'generatedPrograms');
}

function getSeedInputTypeFragment(seeds: ParsedPdaSeedNode[], scope: PdaFunctionScope): Fragment | undefined {
    const variableSeeds = seeds.filter(isNodeFilter('variablePdaSeedNode'));
    if (variableSeeds.length === 0) return;

    const pdaNode = getLastNodeFromPath(scope.pdaPath);
    const seedTypeName = scope.nameApi.pdaSeedsType(pdaNode.name);
    const seedAttributes = mergeFragments(
        variableSeeds.map(seed => seed.inputAttribute),
        cs => cs.join('\n'),
    );

    return fragment`export type ${seedTypeName} = {\n${seedAttributes}\n};`;
}

function getFunctionFragment(
    seeds: ParsedPdaSeedNode[],
    scope: PdaFunctionScope & {
        hasProgramAddressConfig: boolean;
        programAddressValue: Fragment;
    },
): Fragment {
    const { hasProgramAddressConfig, programAddressValue } = scope;
    const pdaNode = getLastNodeFromPath(scope.pdaPath);

    const addressType = use('type Address', 'solanaAddresses');
    const pdaType = use('type ProgramDerivedAddress', 'solanaAddresses');
    const getPdaFunction = use('getProgramDerivedAddress', 'solanaAddresses');

    const seedTypeName = scope.nameApi.pdaSeedsType(pdaNode.name);
    const findPdaFunction = scope.nameApi.pdaFindFunction(pdaNode.name);

    const docs = getDocblockFragment(pdaNode.docs ?? [], true);
    const hasVariableSeeds = seeds.filter(isNodeFilter('variablePdaSeedNode')).length > 0;
    const parameters = mergeFragments(
        [
            hasVariableSeeds ? fragment`seeds: ${seedTypeName}` : undefined,
            // No default: falling back to the enclosing program would silently derive a wrong address.
            hasProgramAddressConfig ? fragment`config: { programAddress: ${addressType} }` : undefined,
        ],
        cs => cs.join(', '),
    );
    const programAddressStatement = hasProgramAddressConfig
        ? fragment`const { programAddress } = config;\n`
        : fragment``;
    const programAddressArgument = hasProgramAddressConfig
        ? fragment`programAddress`
        : fragment`programAddress: ${programAddressValue}`;
    const encodedSeeds = mergeFragments(
        seeds.map(s => s.encodedValue),
        cs => cs.join(', '),
    );

    return fragment`${docs}export async function ${findPdaFunction}(${parameters}): Promise<${pdaType}> {
  ${programAddressStatement}return await ${getPdaFunction}({ ${programAddressArgument}, seeds: [${encodedSeeds}]});
}`;
}

type ParsedPdaSeedNode = PdaSeedNode & {
    encodedValue: Fragment;
    inputAttribute?: Fragment;
};

function parsePdaSeedNodes(
    seeds: PdaSeedNode[],
    scope: Pick<RenderScope, 'typeManifestVisitor'> & { programAddressValue: Fragment },
): ParsedPdaSeedNode[] {
    return seeds.map(seed => {
        if (isNode(seed, 'variablePdaSeedNode')) {
            const name = camelCase(seed.name);
            const docs = getDocblockFragment(seed.docs ?? [], true);
            const { encoder, looseType } = visit(seed.type, scope.typeManifestVisitor);
            return {
                ...seed,
                encodedValue: fragment`${encoder}.encode(seeds.${name})`,
                inputAttribute: fragment`${docs}${name}: ${looseType};`,
            };
        }

        if (isNode(seed.value, 'programIdValueNode')) {
            const addressEncoder = use('getAddressEncoder', 'solanaAddresses');
            return { ...seed, encodedValue: fragment`${addressEncoder}().encode(${scope.programAddressValue})` };
        }

        const { encoder } = visit(seed.type, scope.typeManifestVisitor);
        const { value } = visit(seed.value, scope.typeManifestVisitor);
        return { ...seed, encodedValue: fragment`${encoder}.encode(${value})` };
    });
}
