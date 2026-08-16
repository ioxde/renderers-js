import {
    camelCase,
    getAllInstructionsWithSubs,
    InstructionNode,
    ProgramNode,
    structTypeNodeFromInstructionArgumentNodes,
} from '@codama/nodes';

import { Fragment, fragment, mergeFragments, RenderScope, use } from '../utils';
import { getDiscriminatorConditionFragment } from './discriminatorCondition';

/** File name (without extension) of the aggregate instructions page hosting the identify/parse helpers. */
export function getProgramInstructionsFileName(programNode: ProgramNode): `${string}.instructions` {
    return `${camelCase(programNode.name)}.instructions`;
}

/** Whether the aggregate instructions page renders for this program. */
export function hasProgramInstructionsPage(programNode: ProgramNode): boolean {
    return (programNode.instructions ?? []).length > 0;
}

/** Import path of an instruction's page, relative to the instructions folder. */
function getInstructionModule(instruction: InstructionNode): `./${string}` {
    return `./${camelCase(instruction.name)}`;
}

/**
 * Renders a program's aggregate instructions page: the type union, the parsed union, and
 * the `identify*`/`parse*` helpers. Both helpers return `null` when no instruction matches.
 */
export function getProgramInstructionsPageFragment(
    scope: Pick<RenderScope, 'nameApi' | 'renderParentInstructions' | 'typeManifestVisitor'> & {
        programNode: ProgramNode;
    },
): Fragment | undefined {
    if (!hasProgramInstructionsPage(scope.programNode)) return;

    const discriminatorKey = scope.nameApi.programInstructionsParsedDiscriminatorKey(scope.programNode.name);
    if (['accounts', 'data', 'programAddress'].includes(discriminatorKey)) {
        throw new Error(
            `The programInstructionsParsedDiscriminatorKey name transformer returned '${discriminatorKey}', ` +
                `which collides with a field of the parsed instruction type.`,
        );
    }

    const allInstructions = getAllInstructionsWithSubs(scope.programNode, {
        leavesOnly: !scope.renderParentInstructions,
        subInstructionsFirst: true,
    });
    const scopeWithInstructions = { ...scope, allInstructions };
    return mergeFragments(
        [
            getProgramInstructionsTypeUnionFragment(scopeWithInstructions),
            getProgramInstructionsIdentifierFunctionFragment(scopeWithInstructions),
            getProgramInstructionsParsedUnionTypeFragment(scopeWithInstructions),
            getProgramInstructionsParseFunctionFragment(scopeWithInstructions),
        ],
        c => c.join('\n\n'),
    );
}

function getProgramInstructionsTypeUnionFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        allInstructions: InstructionNode[];
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, allInstructions, nameApi } = scope;
    const programInstructionsTypeUnion = nameApi.programInstructionsTypeUnion(programNode.name);
    const programInstructionsTypeVariants = allInstructions.map(
        instruction => `'${nameApi.programInstructionsTypeVariant(instruction.name)}'`,
    );
    return fragment`/** Instruction kinds of the ${programNode.name} program. */
export type ${programInstructionsTypeUnion} = ${programInstructionsTypeVariants.join(' | ')};`;
}

function getProgramInstructionsIdentifierFunctionFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        allInstructions: InstructionNode[];
        programNode: ProgramNode;
    },
): Fragment | undefined {
    const { programNode, nameApi, allInstructions } = scope;
    const instructionsWithDiscriminators = allInstructions.filter(
        instruction => (instruction.discriminators ?? []).length > 0,
    );
    if (instructionsWithDiscriminators.length === 0) return;

    const programInstructionsTypeUnion = nameApi.programInstructionsTypeUnion(programNode.name);
    const programInstructionsIdentifierFunction = nameApi.programInstructionsIdentifierFunction(programNode.name);
    const discriminatorsFragment = mergeFragments(
        instructionsWithDiscriminators.map((instruction): Fragment => {
            const variant = nameApi.programInstructionsTypeVariant(instruction.name);
            return getDiscriminatorConditionFragment({
                ...scope,
                constantSource: getInstructionModule(instruction),
                dataName: 'data',
                discriminators: instruction.discriminators ?? [],
                ifTrue: `return '${variant}';`,
                prefix: instruction.name,
                struct: structTypeNodeFromInstructionArgumentNodes(instruction.arguments ?? []),
            });
        }),
        c => c.join('\n'),
    );

    const readonlyUint8Array = use('type ReadonlyUint8Array', 'solanaCodecsCore');

    return fragment`/**
 * Identifies ${programNode.name} instruction data by its discriminators.
 * Returns \`null\` when the data matches no known instruction.
 */
export function ${programInstructionsIdentifierFunction}(instruction: { data: ${readonlyUint8Array} } | ${readonlyUint8Array}): ${programInstructionsTypeUnion} | null {
    const data = 'data' in instruction ? instruction.data : instruction;
    ${discriminatorsFragment}
    return null;
}`;
}

function getProgramInstructionsParsedUnionTypeFragment(
    scope: Pick<RenderScope, 'nameApi'> & {
        allInstructions: InstructionNode[];
        programNode: ProgramNode;
    },
): Fragment {
    const { programNode, allInstructions, nameApi } = scope;

    const programAddress = programNode.publicKey;
    const programInstructionsType = nameApi.programInstructionsParsedUnionType(programNode.name);
    const discriminatorKey = nameApi.programInstructionsParsedDiscriminatorKey(programNode.name);

    const typeVariants = allInstructions.map((instruction): Fragment => {
        const variant = nameApi.programInstructionsTypeVariant(instruction.name);
        const parsedInstructionType = use(
            `type ${nameApi.instructionParsedType(instruction.name)}`,
            getInstructionModule(instruction),
        );

        return fragment`| ({ ${discriminatorKey}: '${variant}' } & ${parsedInstructionType}<TProgram>)`;
    });

    return mergeFragments(
        [
            fragment`/** Parsed ${programNode.name} instruction: the instruction kind tag plus its parsed accounts and data. */
export type ${programInstructionsType}<TProgram extends string = '${programAddress}'> =`,
            ...typeVariants,
        ],
        c => c.join('\n'),
    );
}

function getProgramInstructionsParseFunctionFragment(
    scope: Pick<RenderScope, 'nameApi' | 'typeManifestVisitor'> & {
        allInstructions: InstructionNode[];
        programNode: ProgramNode;
    },
): Fragment | undefined {
    const { programNode, nameApi, allInstructions } = scope;

    // Only generate if there are instructions with discriminators (i.e., identifier function exists)
    const instructionsWithDiscriminators = allInstructions.filter(
        instruction => (instruction.discriminators ?? []).length > 0,
    );
    if (instructionsWithDiscriminators.length === 0) return;

    const programInstructionsIdentifierFunction = nameApi.programInstructionsIdentifierFunction(programNode.name);
    const programInstructionsParsedUnionType = nameApi.programInstructionsParsedUnionType(programNode.name);
    const parseFunction = nameApi.programInstructionsParseFunction(programNode.name);
    const discriminatorKey = nameApi.programInstructionsParsedDiscriminatorKey(programNode.name);

    const switchCases = mergeFragments(
        allInstructions.map((instruction): Fragment => {
            const variant = nameApi.programInstructionsTypeVariant(instruction.name);
            const parseFunction = use(
                nameApi.instructionParseFunction(instruction.name),
                getInstructionModule(instruction),
            );
            const assertIsInstructionWithAccounts = use('assertIsInstructionWithAccounts', 'solanaInstructions');
            // Only need accounts assertion since data is guaranteed by the input type
            const hasAccounts = (instruction.accounts ?? []).length > 0;
            const assertionsCode = hasAccounts
                ? fragment`${assertIsInstructionWithAccounts}(instruction);\n`
                : fragment``;
            return fragment`case '${variant}': { ${assertionsCode}return { ${discriminatorKey}: '${variant}', ...${parseFunction}(instruction) }; }`;
        }),
        c => c.join('\n'),
    );

    // No default case: the switch is exhaustive over the identified instruction type.
    // Parse errors propagate: a matched discriminator with malformed data should throw, not return null.
    return fragment`/**
 * Parses a ${programNode.name} instruction into its kind tag plus parsed accounts and data.
 * Returns \`null\` when no known instruction matches; throws if a matched instruction fails to parse.
 */
export function ${parseFunction}<TProgram extends string>(
    instruction: ${use('type Instruction', 'solanaInstructions')}<TProgram>
        & ${use('type InstructionWithData', 'solanaInstructions')}<${use('type ReadonlyUint8Array', 'solanaCodecsCore')}>
): ${programInstructionsParsedUnionType}<TProgram> | null {
    const instructionType = ${programInstructionsIdentifierFunction}(instruction);
    if (instructionType === null) return null;
    switch (instructionType) {
        ${switchCases}
    }
}`;
}
