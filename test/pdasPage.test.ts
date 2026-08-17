import {
    accountBumpValueNode,
    accountNode,
    accountValueNode,
    constantPdaSeedNodeFromProgramId,
    constantPdaSeedNodeFromString,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    optionTypeNode,
    pdaLinkNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import {
    renderMapContains,
    renderMapContainsImports,
    renderMapDoesNotContain,
    renderMapDoesNotContainImports,
} from './_setup';

test('it renders a PDA helper function and its input type', async () => {
    // Given the following PDA node.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'myPrefix'),
                    variablePdaSeedNode('myAccount', publicKeyTypeNode()),
                    variablePdaSeedNode('myArg', numberTypeNode('u64')),
                ],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following PDA function using an empty seeds array to derive the address.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export type FooSeeds = { myAccount: Address; myArg: number | bigint; }',
        'export async function findFooPda( seeds: FooSeeds ): Promise<ProgramDerivedAddress>',
        'programAddress: MY_PROGRAM_PROGRAM_ADDRESS',
        "[ getUtf8Encoder().encode('myPrefix'), getAddressEncoder().encode(seeds.myAccount), getU64Encoder().encode(seeds.myArg) ]",
    ]);

    // And it references the generated program constant rather than inlining its address.
    await renderMapContainsImports(renderMap, 'pdas/foo.ts', {
        '../programs/index.js': ['MY_PROGRAM_PROGRAM_ADDRESS'],
    });
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ["'1111' as Address<'1111'>"]);
});

test('it renders a PDA helper function with a default program address', async () => {
    // Given the following PDA node with a default program address.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                programId: 'myProgramId',
                seeds: [constantPdaSeedNodeFromString('utf8', 'myPrefix')],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the address stays inline: a foreign program has no generated constant to reference.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export async function findFooPda(): Promise<ProgramDerivedAddress>',
        "programAddress: 'myProgramId' as Address<'myProgramId'>",
    ]);
    await renderMapDoesNotContainImports(renderMap, 'pdas/foo.ts', {
        '../programs/index.js': ['MY_PROGRAM_PROGRAM_ADDRESS'],
    });
});

test('it references the program constant when a PDA is pinned to the program being rendered', async () => {
    // Given a PDA pinned to the very program it is rendered under.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                programId: '1111',
                seeds: [constantPdaSeedNodeFromString('utf8', 'myPrefix')],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the pin resolves to the generated constant rather than a second copy of the address.
    await renderMapContains(renderMap, 'pdas/foo.ts', ['programAddress: MY_PROGRAM_PROGRAM_ADDRESS']);
    await renderMapContainsImports(renderMap, 'pdas/foo.ts', {
        '../programs/index.js': ['MY_PROGRAM_PROGRAM_ADDRESS'],
    });
});

test('it renders an empty array of seeds for seedless PDAs', async () => {
    // Given the following program with 1 account and 1 pda with empty seeds.
    const node = programNode({
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following PDA function using an empty seeds array to derive the address.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export async function findFooPda(): Promise<ProgramDerivedAddress>',
        'getProgramDerivedAddress({ programAddress: MY_PROGRAM_PROGRAM_ADDRESS, seeds: [] })',
    ]);
});

test('it does not import strict types for variable seeds', async () => {
    // Given the following PDA node.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                seeds: [variablePdaSeedNode('myAccount', optionTypeNode(publicKeyTypeNode()))],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the `Option` string type should not be imported.
    await renderMapDoesNotContainImports(renderMap, 'pdas/foo.ts', {
        '@solana/kit': ['type Option'],
    });

    // But the `OptionOrNullable` loose type should be imported.
    await renderMapContainsImports(renderMap, 'pdas/foo.ts', {
        '@solana/kit': ['type OptionOrNullable'],
    });
});

test('it pins the PDA function to the program address the client was generated for', async () => {
    // Given a program whose PDA is only ever derived under that same program.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo'),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'myPrefix')] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect no config parameter: the PDA resolves under exactly one program.
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ['config', 'programAddress?']);
});

test('it requires a program address config when an instruction derives the PDA under a runtime program', async () => {
    // Given a program whose PDA is derived under a caller-supplied program on one of its instructions.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo', [], accountValueNode('myProgram')),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'myPrefix')] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the config is required with no fallback: defaulting to the enclosing program would
    // silently derive a wrong address.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export async function findFooPda(config: { programAddress: Address; }): Promise<ProgramDerivedAddress>',
        'const { programAddress } = config;',
        'getProgramDerivedAddress({ programAddress, seeds:',
    ]);
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ['= {}', "'1111'"]);
});

test('it drops the program address config when the runtime program reference is already pinned', async () => {
    // Given a program reference Codama resolved: Anchor's conversion pins the definition and keeps the reference.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo', [], accountValueNode('myProgram')),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', programId: '2222', seeds: [constantPdaSeedNodeFromString('utf8', 'myPrefix')] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect no config parameter: the reference can only resolve to the baked-in address.
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ['config', 'programAddress?']);
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export async function findFooPda(): Promise<ProgramDerivedAddress>',
        "programAddress: '2222' as Address<'2222'>",
    ]);

    // And the use-site calls it without a config.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['await findFooPda()']);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', ['findFooPda({ programAddress']);
});

test('it only requires a program address config on the PDAs a runtime program is passed to', async () => {
    // Given a program with two PDAs, only one of which is derived under a runtime program.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo', [], accountValueNode('myProgram')),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('bar'),
                        isSigner: false,
                        isWritable: false,
                        name: 'bar',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'foo')] }),
            pdaNode({ name: 'bar', seeds: [constantPdaSeedNodeFromString('utf8', 'bar')] }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then only the overridden PDA takes the config parameter.
    await renderMapContains(renderMap, 'pdas/foo.ts', ['config: { programAddress: Address; }']);
    await renderMapDoesNotContain(renderMap, 'pdas/bar.ts', ['config']);
    await renderMapContains(renderMap, 'pdas/bar.ts', ['programAddress: MY_PROGRAM_PROGRAM_ADDRESS']);
});

test('it uses the program constant in program ID seeds of pinned PDAs', async () => {
    // Given a PDA that uses the deriving program as one of its seeds.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                seeds: [constantPdaSeedNodeFromProgramId(), variablePdaSeedNode('myAccount', publicKeyTypeNode())],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the seed uses the generated program constant rather than a local variable or a literal.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'getAddressEncoder().encode(MY_PROGRAM_PROGRAM_ADDRESS)',
        'programAddress: MY_PROGRAM_PROGRAM_ADDRESS',
    ]);
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ["'1111'"]);
});

test('it uses the resolved program address in program ID seeds of overridable PDAs', async () => {
    // Given the same PDA, this time derived under a caller-supplied program.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            'foo',
                            [pdaSeedValueNode('myAccount', accountValueNode('myProgram'))],
                            accountValueNode('myProgram'),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                seeds: [constantPdaSeedNodeFromProgramId(), variablePdaSeedNode('myAccount', publicKeyTypeNode())],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the seed follows whichever program the caller derived the PDA under.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'const { programAddress } = config;',
        'getAddressEncoder().encode(programAddress)',
    ]);
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ["'1111'"]);
});

test('it requires a program address config when another program of the root overrides it', async () => {
    // Given a root whose first program derives a PDA of the second under a runtime program.
    const node = rootNode(
        programNode({
            instructions: [
                instructionNode({
                    accounts: [
                        instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                        instructionAccountNode({
                            defaultValue: pdaValueNode(
                                pdaLinkNode('foo', 'programB'),
                                [],
                                accountValueNode('myProgram'),
                            ),
                            isSigner: false,
                            isWritable: false,
                            name: 'foo',
                        }),
                    ],
                    name: 'myInstruction',
                }),
            ],
            name: 'programA',
            publicKey: '1111',
        }),
        [
            programNode({
                name: 'programB',
                pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'myPrefix')] })],
                publicKey: '2222',
            }),
        ],
    );

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the config survives: all programs of a root share the same `pdas` folder.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export async function findFooPda(config: { programAddress: Address; }): Promise<ProgramDerivedAddress>',
        'const { programAddress } = config;',
    ]);
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ["'2222'"]);
});

test('it passes the enclosing program at the use-sites of an overridable PDA that do not override it', async () => {
    // Given a PDA derived under a runtime program by one instruction and under its own program by another.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo', [], accountValueNode('myProgram')),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'withOverride',
            }),
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo'),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'withoutOverride',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'myPrefix')] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the config is required, so the use-site that does not override it passes the enclosing
    // program — which is what an un-overridden `pdaValueNode` derives under.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export async function findFooPda(config: { programAddress: Address; }): Promise<ProgramDerivedAddress>',
    ]);
    await renderMapContains(renderMap, 'instructions/withoutOverride.ts', ['await findFooPda({ programAddress })']);
    await renderMapContains(renderMap, 'instructions/withOverride.ts', [
        "await findFooPda({ programAddress: getAddressFromResolvedInstructionAccount( 'myProgram', accounts.myProgram.value ) })",
    ]);
});

test('it throws when an account is linked to a PDA derived under a runtime program', () => {
    // Given an account whose PDA is also derived under a runtime program by an instruction.
    const node = programNode({
        accounts: [accountNode({ name: 'myAccount', pda: pdaLinkNode('foo') })],
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            'foo',
                            [pdaSeedValueNode('authority', accountValueNode('myProgram'))],
                            accountValueNode('myProgram'),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())] })],
        publicKey: '1111',
    });

    // When we render it, then generation fails: `decodeMyAccount` guards ownership against the
    // program being rendered, not the program the address derives under.
    expect(() => visit(node, getRenderMapVisitor())).toThrow(
        /Account \[myAccount\] is linked to PDA \[foo\].*only known at runtime.*owner guard.*cannot be determined/s,
    );

    // And the error points at both ways out of the contradiction.
    expect(() => visit(node, getRenderMapVisitor())).toThrow(/"programId" on PDA \[foo\]/);
    expect(() => visit(node, getRenderMapVisitor())).toThrow(/address-constrain the account/);
});

test('it fetches an account from the seeds of a PDA pinned at generation time', async () => {
    // Given an account whose PDA always derives under the program being rendered.
    const node = programNode({
        accounts: [accountNode({ name: 'myAccount', pda: pdaLinkNode('foo') })],
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'authority' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo', [
                            pdaSeedValueNode('authority', accountValueNode('authority')),
                        ]),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account helper calls the finder with seeds alone.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', ['const [address] = await findFooPda(seeds);']);
});

const MY_PROGRAM_ADDRESS = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const OTHER_PROGRAM_ADDRESS = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

test('it exports the address of a PDA whose seeds are all constant', async () => {
    // Given a PDA of the program being rendered with a single constant seed.
    const node = programNode({
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the address is resolved here. Same one the Rust renderer bakes for this program and seed.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        "export const FOO_PDA_ADDRESS = 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh' as Address<'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh'>;",
        'export function findFooPda(): ProgramDerivedAddress',
        'return [FOO_PDA_ADDRESS, 250 as ProgramDerivedAddressBump];',
    ]);

    // And nothing is hashed at runtime.
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ['getProgramDerivedAddress', 'MY_PROGRAM_PROGRAM_ADDRESS']);
});

test('it resolves a PDA under the program it is pinned to rather than the one being rendered', async () => {
    // Given a PDA pinned to a foreign program.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                programId: OTHER_PROGRAM_ADDRESS,
                seeds: [constantPdaSeedNodeFromString('utf8', 'vault_and_lp_mint_auth_seed')],
            }),
        ],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the pin decides the derivation, so the constant is the foreign program's PDA.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        "export const FOO_PDA_ADDRESS = 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL' as Address<'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL'>;",
        'return [FOO_PDA_ADDRESS, 253 as ProgramDerivedAddressBump];',
    ]);
});

test('it keeps deriving a PDA with a variable seed at runtime', async () => {
    // Given a PDA whose address depends on a caller-supplied seed.
    const node = programNode({
        name: 'myProgram',
        pdas: [
            pdaNode({
                name: 'foo',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'vault_auth_seed'),
                    variablePdaSeedNode('myAccount', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then there is nothing to resolve at generation time.
    await renderMapContains(renderMap, 'pdas/foo.ts', ['getProgramDerivedAddress({ programAddress:']);
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ['FOO_PDA_ADDRESS']);
});

test('it keeps deriving a PDA at runtime when the deriving program is only known then', async () => {
    // Given constant seeds, but a use-site that derives the PDA under a caller-supplied program.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myOtherProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo', [], accountValueNode('myOtherProgram')),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then constant seeds are not enough: the address depends on the program the caller passes.
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        'export async function findFooPda(config: { programAddress: Address; }): Promise<ProgramDerivedAddress>',
    ]);
    await renderMapDoesNotContain(renderMap, 'pdas/foo.ts', ['FOO_PDA_ADDRESS']);
});

test('it assigns the address constant at the use-sites of a resolved PDA', async () => {
    // Given an instruction that defaults an account to a PDA with only constant seeds.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo'),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder reads the constant instead of awaiting a finder that only returns it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['accounts.foo.value = FOO_PDA_ADDRESS;']);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', ['await findFooPda()']);
    await renderMapContainsImports(renderMap, 'instructions/myInstruction.ts', {
        '../pdas/index.js': ['FOO_PDA_ADDRESS'],
    });
});

test('it keeps calling the finder when the instruction reads the bump of the resolved account', async () => {
    // Given an instruction that also feeds that account's bump into an argument.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo'),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: accountBumpValueNode('foo'),
                        name: 'fooBump',
                        type: numberTypeNode('u8'),
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the bump reader keeps the whole tuple, and the synchronous finder keeps the builder sync-only.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['accounts.foo.value = findFooPda();']);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'accounts.foo.value = FOO_PDA_ADDRESS',
        'await findFooPda',
        'getMyInstructionInstructionAsync',
    ]);
});

test('it fetches an account from a resolved PDA without seeds', async () => {
    // Given an account linked to a PDA with only constant seeds.
    const node = programNode({
        accounts: [accountNode({ name: 'myAccount', pda: pdaLinkNode('foo') })],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the fetch helper goes through the finder without awaiting it.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', ['const [address] = findFooPda();']);
    await renderMapDoesNotContain(renderMap, 'accounts/myAccount.ts', ['await findFooPda']);
});

test('it renders no async builder when a resolved PDA was the only asynchronous default', async () => {
    // Given an instruction whose single default is a PDA with only constant seeds.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo'),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then there is no async variant: it would await nothing.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'getMyInstructionInstructionAsync',
        'MyInstructionAsyncInput',
    ]);

    // And the sync builder assigns the constant itself; the account is not a caller-facing input at all.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export function getMyInstructionInstruction()',
        'const originalAccounts = { foo: { value: null, isWritable: false } }',
        'accounts.foo.value = FOO_PDA_ADDRESS;',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', ['export type MyInstructionInput']);
});

test('it still renders an async builder when another default remains asynchronous', async () => {
    // Given the same resolved PDA alongside a PDA that genuinely derives at runtime.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'authority' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo'),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('bar', [
                            pdaSeedValueNode('authority', accountValueNode('authority')),
                        ]),
                        isSigner: false,
                        isWritable: false,
                        name: 'bar',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] }),
            pdaNode({ name: 'bar', seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())] }),
        ],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the async variant survives for the PDA that still derives, and resolves both defaults.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export async function getMyInstructionInstructionAsync',
        'accounts.bar.value = await findBarPda({',
        'accounts.foo.value = FOO_PDA_ADDRESS;',
    ]);

    // And the sync builder resolves only the one that needs nothing at call time.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export function getMyInstructionInstruction',
    ]);
});

test('it names the resolved address in the type parameter of the account it defaults', async () => {
    // Given one account defaulting to a resolved PDA and one to a PDA with a variable seed.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'authority' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('foo'),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('bar', [
                            pdaSeedValueNode('authority', accountValueNode('authority')),
                        ]),
                        isSigner: false,
                        isWritable: false,
                        name: 'bar',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({ name: 'foo', seeds: [constantPdaSeedNodeFromString('utf8', 'vault_auth_seed')] }),
            pdaNode({ name: 'bar', seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())] }),
        ],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the resolved account carries its one legal address in the instruction type, and it is the
    // same address the exported constant holds.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        "TAccountFoo extends string | AccountMeta<string> = 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh'",
    ]);
    await renderMapContains(renderMap, 'pdas/foo.ts', [
        "export const FOO_PDA_ADDRESS = 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh'",
    ]);

    // And the one that still derives at runtime keeps the widest type it can have.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'TAccountBar extends string | AccountMeta<string> = string',
    ]);
});
