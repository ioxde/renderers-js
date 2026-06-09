import {
    accountNode,
    bytesTypeNode,
    bytesValueNode,
    constantDiscriminatorNode,
    constantValueNode,
    constantValueNodeFromBytes,
    eventNode,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    hiddenPrefixTypeNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    numberValueNode,
    programNode,
    publicKeyTypeNode,
    sizeDiscriminatorNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { renderMapContains, renderMapContainsImports, renderMapDoesNotContain } from './_setup';

test('it renders the program address constant', async () => {
    // Given the following program.
    const node = programNode({
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following program address constant.
    await renderMapContains(renderMap, 'programs/splToken.ts', [
        "export const SPL_TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address<'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'>;",
    ]);

    // And we expect the following imports.
    await renderMapContainsImports(renderMap, 'programs/splToken.ts', {
        '@solana/kit': ['Address'],
    });
});

test('it renders a string-literal union of all available accounts for a program', async () => {
    // Given the following program.
    const node = programNode({
        accounts: [accountNode({ name: 'mint' }), accountNode({ name: 'token' })],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the account-type union on the aggregate accounts page.
    await renderMapContains(renderMap, 'accounts/splToken.accounts.ts', [
        "export type SplTokenAccountType = 'mint' | 'token';",
    ]);
    await renderMapDoesNotContain(renderMap, 'programs/splToken.ts', ['SplTokenAccountType']);
});

test('it renders an function that identifies accounts in a program', async () => {
    // Given the following program with 3 accounts. Two of which have discriminators.
    const node = programNode({
        accounts: [
            // Field discriminator.
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(5),
                        name: 'key',
                        type: numberTypeNode('u8'),
                    }),
                ]),
                discriminators: [fieldDiscriminatorNode('key')],
                name: 'metadata',
            }),
            // Size and byte discriminators.
            accountNode({
                discriminators: [
                    sizeDiscriminatorNode(72),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '010203'), 4),
                ],
                name: 'token',
            }),
            // No discriminator.
            accountNode({ discriminators: [], name: 'mint' }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following identifier function to be rendered.
    // Notice it does not include the `mint` account because it has no discriminators.
    await renderMapContains(renderMap, 'accounts/splToken.accounts.ts', [
        `export function identifySplTokenAccount( account: { data: ReadonlyUint8Array } | ReadonlyUint8Array ): SplTokenAccountType | null { ` +
            `const data = 'data' in account ? account.data : account; ` +
            `if ( containsBytes(data, getU8Encoder().encode(METADATA_KEY), 0) ) { return 'metadata'; } ` +
            `if ( data.length === 72 && containsBytes(data, TOKEN_DISCRIMINATOR, 4) ) { return 'token'; } ` +
            `return null; ` +
            `}`,
    ]);

    // And we expect the per-account constants to be imported from their sibling pages.
    await renderMapContainsImports(renderMap, 'accounts/splToken.accounts.ts', {
        './metadata.js': ['METADATA_KEY'],
        './token.js': ['TOKEN_DISCRIMINATOR'],
        '@solana/kit': ['containsBytes', 'ReadonlyUint8Array'],
    });
});

test('it reuses suffixed constants when a node has multiple constant discriminators', async () => {
    // Given an account with two constant discriminators.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '010203'), 0),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '040506'), 8),
                ],
                name: 'token',
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the identify condition references both constants, the second suffixed,
    // matching the names emitted in the account's page.
    await renderMapContains(renderMap, 'accounts/splToken.accounts.ts', [
        `if ( containsBytes(data, TOKEN_DISCRIMINATOR, 0) && containsBytes(data, TOKEN_DISCRIMINATOR2, 8) ) ` +
            `{ return 'token'; }`,
    ]);

    // And both constants are imported from the account's sibling page.
    await renderMapContainsImports(renderMap, 'accounts/splToken.accounts.ts', {
        './token.js': ['TOKEN_DISCRIMINATOR', 'TOKEN_DISCRIMINATOR2'],
    });
});

test('it renders a string-literal union of all available instructions for a program', async () => {
    // Given the following program.
    const node = programNode({
        instructions: [
            instructionNode({ name: 'mintTokens' }),
            instructionNode({ name: 'transferTokens' }),
            instructionNode({ name: 'updateAuthority' }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the instruction-type union on the aggregate instructions page.
    await renderMapContains(renderMap, 'instructions/splToken.instructions.ts', [
        "export type SplTokenInstructionType = | 'mintTokens' | 'transferTokens' | 'updateAuthority';",
    ]);
    await renderMapDoesNotContain(renderMap, 'programs/splToken.ts', ['SplTokenInstructionType']);
});

test('it renders an function that identifies instructions in a program', async () => {
    // Given the following program with 3 instructions. Two of which have discriminators.
    const node = programNode({
        instructions: [
            // Field discriminator.
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'mintTokens',
            }),
            // Size and byte discriminators.
            instructionNode({
                discriminators: [
                    sizeDiscriminatorNode(72),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '010203'), 4),
                ],
                name: 'transferTokens',
            }),
            // No discriminator.
            instructionNode({ discriminators: [], name: 'updateAuthority' }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following identifier function to be rendered.
    // Notice it does not include the `updateAuthority` instruction because it has no discriminators.
    await renderMapContains(renderMap, 'instructions/splToken.instructions.ts', [
        `export function identifySplTokenInstruction ( instruction: { data: ReadonlyUint8Array } | ReadonlyUint8Array ): SplTokenInstructionType | null { ` +
            `const data = 'data' in instruction ? instruction.data : instruction; ` +
            `if ( containsBytes(data, getU8Encoder().encode(MINT_TOKENS_DISCRIMINATOR), 0) ) { return 'mintTokens'; } ` +
            `if ( data.length === 72 && containsBytes(data, TRANSFER_TOKENS_DISCRIMINATOR, 4) ) { return 'transferTokens'; } ` +
            `return null; ` +
            `}`,
    ]);

    // And we expect the per-instruction constants to be imported from their sibling pages.
    await renderMapContainsImports(renderMap, 'instructions/splToken.instructions.ts', {
        './mintTokens.js': ['MINT_TOKENS_DISCRIMINATOR'],
        './transferTokens.js': ['TRANSFER_TOKENS_DISCRIMINATOR'],
        '@solana/kit': ['containsBytes', 'ReadonlyUint8Array'],
    });
});

test('it checks the discriminator of sub-instructions before their parents.', async () => {
    // Given the following program with a parent instruction and a sub-instruction.
    const node = programNode({
        instructions: [
            // Parent instruction.
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'parentDiscriminator',
                        type: numberTypeNode('u8'),
                    }),
                    instructionArgumentNode({
                        name: 'subDiscriminator',
                        type: numberTypeNode('u32'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('parentDiscriminator')],
                name: 'mintTokens',
                subInstructions: [
                    // Sub instruction.
                    instructionNode({
                        arguments: [
                            instructionArgumentNode({
                                defaultValue: numberValueNode(1),
                                name: 'parentDiscriminator',
                                type: numberTypeNode('u8'),
                            }),
                            instructionArgumentNode({
                                defaultValue: numberValueNode(1),
                                name: 'subDiscriminator',
                                type: numberTypeNode('u32'),
                            }),
                        ],
                        discriminators: [
                            fieldDiscriminatorNode('parentDiscriminator'),
                            fieldDiscriminatorNode('subDiscriminator', 1),
                        ],
                        name: 'mintTokensV1',
                    }),
                ],
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it whilst making sure we render both the parent and sub-instruction.
    const renderMap = visit(node, getRenderMapVisitor({ renderParentInstructions: true }));

    // Then we expect the sub-instruction condition to be rendered before the parent instruction condition.
    await renderMapContains(renderMap, 'instructions/splToken.instructions.ts', [
        `if ( containsBytes( data, getU8Encoder().encode(MINT_TOKENS_V1_PARENT_DISCRIMINATOR), 0 ) && ` +
            `containsBytes( data, getU32Encoder().encode(MINT_TOKENS_V1_SUB_DISCRIMINATOR), 1 ) ) ` +
            `{ return 'mintTokensV1'; } ` +
            `if ( containsBytes( data, getU8Encoder().encode(MINT_TOKENS_PARENT_DISCRIMINATOR), 0 ) ) ` +
            `{ return 'mintTokens'; }`,
    ]);
});

test('it renders a parsed union type of all available instructions for a program', async () => {
    // Given the following program.
    const node = programNode({
        instructions: [
            instructionNode({ name: 'mintTokens' }),
            instructionNode({ name: 'transferTokens' }),
            instructionNode({ name: 'updateAuthority' }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following program parsed instruction union type.
    await renderMapContains(renderMap, 'instructions/splToken.instructions.ts', [
        "export type ParsedSplTokenInstruction < TProgram extends string = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' >",
        "| ({ instructionType: 'mintTokens' } & ParsedMintTokensInstruction<TProgram>)",
        "| ({ instructionType: 'transferTokens'; } & ParsedTransferTokensInstruction<TProgram>)",
        "| ({ instructionType: 'updateAuthority'; } & ParsedUpdateAuthorityInstruction<TProgram>)",
    ]);
    await renderMapContainsImports(renderMap, 'instructions/splToken.instructions.ts', {
        './mintTokens.js': ['ParsedMintTokensInstruction'],
        './transferTokens.js': ['ParsedTransferTokensInstruction'],
        './updateAuthority.js': ['ParsedUpdateAuthorityInstruction'],
    });
});

test('it renders a function that parses instructions in a program', async () => {
    // Given the following program with instructions that have discriminators.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'mintTokens',
            }),
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(2),
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'transferTokens',
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following parse function to be rendered.
    await renderMapContains(renderMap, 'instructions/splToken.instructions.ts', [
        'export function parseSplTokenInstruction',
        'TProgram extends string',
        'instruction: Instruction',
        'InstructionWithData',
        'ParsedSplTokenInstruction<TProgram> | null',
        'const instructionType = identifySplTokenInstruction(instruction)',
        'if (instructionType === null) return null;',
        'switch (instructionType)',
        "case 'mintTokens'",
        'parseMintTokensInstruction(instruction)',
        "case 'transferTokens'",
        'parseTransferTokensInstruction(instruction)',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/splToken.instructions.ts', ['default:', 'throw new']);

    // And we expect the following imports.
    await renderMapContainsImports(renderMap, 'instructions/splToken.instructions.ts', {
        '@solana/kit': ['Instruction', 'InstructionWithData', 'ReadonlyUint8Array'],
    });
});

test('the program plugin re-exposes identifyAccount, identifyInstruction and parseInstruction when discriminators exist', async () => {
    // Given a program where one account and one instruction carry discriminators.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(5),
                        name: 'key',
                        type: numberTypeNode('u8'),
                    }),
                ]),
                discriminators: [fieldDiscriminatorNode('key')],
                name: 'metadata',
            }),
        ],
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'mintTokens',
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the plugin type wires the helpers as `typeof` references...
    await renderMapContains(renderMap, 'plugins/splToken.ts', [
        'identifyAccount: typeof identifySplTokenAccount;',
        'identifyInstruction: typeof identifySplTokenInstruction;',
        'parseInstruction: typeof parseSplTokenInstruction;',
    ]);

    // ...and the plugin function exposes them on the extended client.
    await renderMapContains(renderMap, 'plugins/splToken.ts', [
        'identifyAccount: identifySplTokenAccount',
        'identifyInstruction: identifySplTokenInstruction',
        'parseInstruction: parseSplTokenInstruction',
    ]);
});

test('the program plugin exposes identifyInstruction/parseInstruction when only a sub-instruction has a discriminator', async () => {
    // Given a program whose top-level instruction has no discriminator,
    // but whose sub-instruction does. The leaves-only walk in
    // getProgramInstructionsPageFragment still emits identify*/parse*.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'subDiscriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [],
                name: 'mintTokens',
                subInstructions: [
                    instructionNode({
                        arguments: [
                            instructionArgumentNode({
                                defaultValue: numberValueNode(1),
                                name: 'subDiscriminator',
                                type: numberTypeNode('u8'),
                            }),
                        ],
                        discriminators: [fieldDiscriminatorNode('subDiscriminator')],
                        name: 'mintTokensV2',
                    }),
                ],
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the plugin must expose the helpers even though the top-level
    // instruction itself has no discriminator.
    await renderMapContains(renderMap, 'plugins/splToken.ts', [
        'identifyInstruction: typeof identifySplTokenInstruction;',
        'parseInstruction: typeof parseSplTokenInstruction;',
        'identifyInstruction: identifySplTokenInstruction',
        'parseInstruction: parseSplTokenInstruction',
    ]);
});

test('the program plugin omits identify/parse keys when no node carries a discriminator', async () => {
    // Given a program with accounts and instructions but no discriminators.
    const node = programNode({
        accounts: [accountNode({ discriminators: [], name: 'mint' })],
        instructions: [instructionNode({ discriminators: [], name: 'mintTokens' })],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the program file does not reference any of the new plugin keys.
    await renderMapDoesNotContain(renderMap, 'plugins/splToken.ts', [
        'identifyAccount',
        'identifyInstruction',
        'parseInstruction',
    ]);
});

test('the program plugin honors renderParentInstructions when deciding whether to expose identify/parse', async () => {
    // Given a program whose parent instruction has a discriminator but the
    // sub-instruction does not. Without renderParentInstructions the parent
    // is filtered out by the leaves-only walk, so no identifier is emitted.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'parentDiscriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('parentDiscriminator')],
                name: 'mintTokens',
                subInstructions: [
                    instructionNode({
                        arguments: [
                            instructionArgumentNode({
                                defaultValue: numberValueNode(1),
                                name: 'parentDiscriminator',
                                type: numberTypeNode('u8'),
                            }),
                        ],
                        discriminators: [],
                        name: 'mintTokensV1',
                    }),
                ],
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render with renderParentInstructions: true, the parent is
    // included in the walk and its discriminator drives identifier emission.
    const renderMap = visit(node, getRenderMapVisitor({ renderParentInstructions: true }));

    // Then the plugin exposes identifyInstruction/parseInstruction.
    await renderMapContains(renderMap, 'plugins/splToken.ts', [
        'identifyInstruction: typeof identifySplTokenInstruction;',
        'parseInstruction: typeof parseSplTokenInstruction;',
        'identifyInstruction: identifySplTokenInstruction',
        'parseInstruction: parseSplTokenInstruction',
    ]);
});

test('it does not render parse function when no instructions have discriminators', async () => {
    // Given the following program with instructions without discriminators.
    const node = programNode({
        instructions: [
            instructionNode({ discriminators: [], name: 'mintTokens' }),
            instructionNode({ discriminators: [], name: 'transferTokens' }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the instruction-type union to be rendered without identify/parse helpers.
    await renderMapContains(renderMap, 'instructions/splToken.instructions.ts', [
        "export type SplTokenInstructionType = 'mintTokens' | 'transferTokens';",
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/splToken.instructions.ts', [
        'identifySplTokenInstruction',
        'parseSplTokenInstruction',
    ]);
});

test('it renders event helpers in the events folder instead of the program page', async () => {
    const discriminator = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() })]),
                    [discriminator],
                ),
                discriminators: [constantDiscriminatorNode(discriminator)],
                name: 'guardCreatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapDoesNotContain(renderMap, 'programs/myProgram.ts', [
        'MyProgramEventType',
        'identifyMyProgramEvent',
        'ParsedMyProgramEvent',
        'parseMyProgramEvent',
    ]);
    await renderMapContains(renderMap, 'events/myProgram.events.ts', ['identifyMyProgramEvent', 'parseMyProgramEvent']);
});

test('it renders a custom parsed instruction discriminator key via nameTransformers', async () => {
    // Given a program with two instructions with field discriminators.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'mintTokens',
            }),
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(2),
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'transferTokens',
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When we render it with an overridden parsed-instruction discriminator key.
    const renderMap = visit(
        node,
        getRenderMapVisitor({
            nameTransformers: { programInstructionsParsedDiscriminatorKey: () => 'kind' },
        }),
    );

    // Then the custom key applies to the union and switch cases, not the local `instructionType` variable.
    await renderMapContains(renderMap, 'instructions/splToken.instructions.ts', [
        "| ({ kind: 'mintTokens' } & ParsedMintTokensInstruction<TProgram>)",
        "| ({ kind: 'transferTokens' } & ParsedTransferTokensInstruction<TProgram>)",
        'const instructionType = identifySplTokenInstruction(instruction)',
        /return\s*{\s*kind:\s*'mintTokens',\s*\.\.\.parseMintTokensInstruction\(instruction\)/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/splToken.instructions.ts', ['instructionType:']);
});

test('it throws when the parsed instruction discriminator key collides with a parsed instruction field', () => {
    // Given a program with one instruction.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(1),
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'mintTokens',
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    // When the key collides with a parsed instruction field, the spread would
    // clobber the tag at runtime, so generation throws instead.
    expect(() =>
        visit(
            node,
            getRenderMapVisitor({
                nameTransformers: { programInstructionsParsedDiscriminatorKey: () => 'data' },
            }),
        ),
    ).toThrow(/programInstructionsParsedDiscriminatorKey.*'data'/);
});
