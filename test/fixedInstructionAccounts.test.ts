import {
    accountBumpValueNode,
    accountValueNode,
    argumentValueNode,
    booleanTypeNode,
    conditionalValueNode,
    constantPdaSeedNode,
    constantPdaSeedNodeFromString,
    instructionAccountNode,
    instructionArgumentNode,
    instructionByteDeltaNode,
    instructionNode,
    instructionRemainingAccountsNode,
    numberTypeNode,
    pdaLinkNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programIdValueNode,
    programLinkNode,
    programNode,
    publicKeyTypeNode,
    publicKeyValueNode,
    resolverValueNode,
    rootNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { getCommonInstructionAccountDefaultRules } from '@codama/visitors';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { renderMapContains, renderMapDoesNotContain } from './_setup';

const MY_PROGRAM_ADDRESS = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ADDRESS = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** An instruction with one pinned account plus whatever else the case under test needs. */
function programWithInstruction(instruction: Parameters<typeof instructionNode>[0]) {
    return programNode({
        instructions: [instructionNode(instruction)],
        name: 'myProgram',
        publicKey: MY_PROGRAM_ADDRESS,
    });
}

test('it drops accounts pinned by an address constraint from the instruction input', async () => {
    // Given a non-signer account pinned by an address constraint, tagged by `nodes-from-anchor` with its own name.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account is gone from the input but still resolved into the account metas.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /tokenProgram\??:\s*Address</,
        'TAccountTokenProgram extends string = string',
        'input.tokenProgram',
    ]);
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export type MyInstructionInput<TAccountMint extends string = string>',
        'tokenProgram: { value: null, isWritable: false }',
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
        `getAccountMeta('tokenProgram', accounts.tokenProgram)`,
    ]);
});

test('it keeps accounts whose default was synthesised from their name', async () => {
    // Given an unconstrained `token_program`, which the common default rules tag `splToken` with the SPL Token
    // address. Such an account must still accept Token-2022.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'splToken'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an overridable input.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
        'input.tokenProgram',
    ]);
});

test('it keeps accounts whose program id default was synthesised from their name', async () => {
    // Given an unconstrained `program_id`, which the same common default rules fill in with `programIdValueNode` —
    // the one heuristic default that is not a `publicKeyValueNode`. Nothing pinned it, so the caller keeps the say.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: programIdValueNode(),
                isSigner: false,
                isWritable: false,
                name: 'programId',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an overridable input.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'programId?: Address<TAccountProgramId>;',
        'input.programId',
    ]);
});

test('it keeps accounts whose pinned address carries no identifier', async () => {
    // Given a hand-authored default with no identifier, indistinguishable from the identifier-less sysvar heuristics.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an overridable input.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
        'input.tokenProgram',
    ]);
});

test('it keeps signer accounts even when their address is pinned', async () => {
    // Given a pinned address on a signer: the caller still has to hand over the signer object.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'admin'),
                isSigner: true,
                isWritable: false,
                name: 'admin',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an input, typed as a signer.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'admin?: TransactionSigner<TAccountAdmin>;',
        'input.admin',
    ]);
});

test('it keeps pinned accounts that another account seeds its PDA from', async () => {
    // Given an associated-token-shaped PDA seeded by the token program: swapping the token program yields a
    // different and correct address, so it is a real input.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'ata',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [variablePdaSeedNode('tokenProgram', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'ata',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the token program stays an input and the PDA keeps reading it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
        /getAddressFromResolvedInstructionAccount\(\s*'tokenProgram',\s*accounts\.tokenProgram\.value\s*\)/,
    ]);
});

test('it drops pinned accounts once their PDA seed has been baked into a constant', async () => {
    // Given the pinned token program inlined into the PDA seed by `stampPinnedAddresses`: nothing reads the account.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_2022_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'ata',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [
                            constantPdaSeedNode(publicKeyTypeNode(), publicKeyValueNode(TOKEN_2022_PROGRAM_ADDRESS)),
                        ],
                    }),
                ),
                isSigner: false,
                isWritable: true,
                name: 'ata',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then both accounts lose their input: the pinned one and the PDA it is baked into.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /tokenProgram\??:\s*Address</,
        /ata\??:\s*(Address|ProgramDerivedAddress)</,
        'await getProgramDerivedAddress',
    ]);
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        `accounts.tokenProgram.value = '${TOKEN_2022_PROGRAM_ADDRESS}' as Address<'${TOKEN_2022_PROGRAM_ADDRESS}'>;`,
    ]);
});

test('it keeps pinned accounts referenced from a conditional branch', async () => {
    // Given an account whose default only reads the pinned account inside one branch.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: conditionalValueNode({
                    condition: argumentValueNode('useTokenProgram'),
                    ifTrue: accountValueNode('tokenProgram'),
                }),
                isSigner: false,
                isWritable: false,
                name: 'owner',
            }),
        ],
        extraArguments: [instructionArgumentNode({ name: 'useTokenProgram', type: booleanTypeNode() })],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the pinned account stays an input.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
    ]);
});

test('it keeps pinned accounts referenced from byte deltas or remaining accounts', async () => {
    // Given resolvers in the byte deltas and remaining accounts that depend on the pinned account.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
        ],
        byteDeltas: [
            instructionByteDeltaNode(
                resolverValueNode('mySizeResolver', { dependsOn: [accountValueNode('tokenProgram')] }),
            ),
        ],
        name: 'myInstruction',
        remainingAccounts: [
            instructionRemainingAccountsNode(
                resolverValueNode('myRemainingAccountsResolver', { dependsOn: [accountValueNode('tokenProgram')] }),
            ),
        ],
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then it stays an input: a resolver reads it, and no account may move in a resolver-bearing instruction.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
    ]);
});

test('it removes nothing from an instruction that contains a resolver', async () => {
    // Given an instruction with a resolver: its body is opaque to the renderer and may read any account.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: resolverValueNode('myResolver'),
                isSigner: false,
                isWritable: false,
                name: 'owner',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the pinned account stays an input.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
    ]);
});

test('it drops accounts defaulting to the enclosing program id', async () => {
    // Given a required account pinned to the program itself, e.g. Anchor's `emit_cpi!` `program`.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: programIdValueNode(),
                isSigner: false,
                isWritable: false,
                name: 'program',
            }),
            instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account is gone from the input and the builder assigns the program address.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /program\??:\s*Address</,
        'TAccountProgram extends string = string',
    ]);
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['accounts.program.value = programAddress;']);
});

test('it keeps optional accounts defaulting to the program id under the programId strategy', async () => {
    // Given the one default the builder skips: `getAccountMeta` fills the omitted slot with the program address.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: programIdValueNode(),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'program',
            }),
        ],
        name: 'myInstruction',
        optionalAccountStrategy: 'programId',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an input and the instruction type names no address: omission is the caller's to choose.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'program?: Address<TAccountProgram>;',
        'TAccountProgram extends string | AccountMeta<string> = string',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        `TAccountProgram extends string | AccountMeta<string> = '${MY_PROGRAM_ADDRESS}'`,
    ]);
});

test('it keeps optional accounts pinned to a bare address, and does not force it on omission', async () => {
    // Given an optional account with a pinned address. The builder applies no default to an optional account,
    // so the input is the only way a caller can express omission.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an input, and the builder never assigns the pinned address to it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
    ]);

    // And the instruction type does not claim it either: no builder puts that address in the meta.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'TAccountTokenProgram extends string | AccountMeta<string> = string',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        `TAccountTokenProgram extends string | AccountMeta<string> = '${TOKEN_PROGRAM_ADDRESS}'`,
    ]);
});

test('it keeps optional accounts defaulting to a constant-seed PDA, and does not force it on omission', async () => {
    // Given an optional account whose PDA default folds to one address at generation time. The on-chain program
    // branches on its absence, so omitting it must leave it genuinely unset.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('globalConfig'),
                        isOptional: true,
                        isSigner: false,
                        isWritable: false,
                        name: 'globalConfig',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'globalConfig', seeds: [constantPdaSeedNodeFromString('utf8', 'global_config')] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then it stays an input, and the builder never assigns the folded constant to it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        /globalConfig\??:\s*(Address|ProgramDerivedAddress)</,
        'TAccountGlobalConfig extends string = string',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'accounts.globalConfig.value = GLOBAL_CONFIG_PDA_ADDRESS;',
    ]);

    // And the instruction type carries no literal for it, since the metas never carry one either.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'TAccountGlobalConfig extends string | AccountMeta<string> = string',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /TAccountGlobalConfig extends string \| AccountMeta<string> = '/,
    ]);
});

test('it drops accounts defaulting to a linked program', async () => {
    // Given an account pinned to another program of the same root.
    const node = rootNode(
        programNode({
            instructions: [
                instructionNode({
                    accounts: [
                        instructionAccountNode({
                            defaultValue: programLinkNode('someOtherProgram'),
                            isSigner: false,
                            isWritable: false,
                            name: 'otherProgram',
                        }),
                        instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
                    ],
                    name: 'myInstruction',
                }),
            ],
            name: 'myProgram',
            publicKey: MY_PROGRAM_ADDRESS,
        }),
        [programNode({ name: 'someOtherProgram', publicKey: TOKEN_PROGRAM_ADDRESS })],
    );

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account is gone from the input and the builder assigns the linked constant.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /otherProgram\??:\s*Address</,
        'TAccountOtherProgram extends string = string',
    ]);
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'accounts.otherProgram.value = SOME_OTHER_PROGRAM_PROGRAM_ADDRESS;',
    ]);
});

test('it keeps optional accounts defaulting to a linked program, and does not force it on omission', async () => {
    // Given an optional account pinned to another program of the same root: a known pin does not make it non-optional.
    const node = rootNode(
        programNode({
            instructions: [
                instructionNode({
                    accounts: [
                        instructionAccountNode({
                            defaultValue: programLinkNode('someOtherProgram'),
                            isOptional: true,
                            isSigner: false,
                            isWritable: false,
                            name: 'otherProgram',
                        }),
                        instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
                    ],
                    name: 'myInstruction',
                }),
            ],
            name: 'myProgram',
            publicKey: MY_PROGRAM_ADDRESS,
        }),
        [programNode({ name: 'someOtherProgram', publicKey: TOKEN_PROGRAM_ADDRESS })],
    );

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an input, and the builder never assigns the linked constant to it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'otherProgram?: Address<TAccountOtherProgram>;',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'accounts.otherProgram.value = SOME_OTHER_PROGRAM_PROGRAM_ADDRESS;',
    ]);

    // And the instruction type stays parametric for the same reason.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'TAccountOtherProgram extends string | AccountMeta<string> = string',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        `TAccountOtherProgram extends string | AccountMeta<string> = '${TOKEN_PROGRAM_ADDRESS}'`,
    ]);
});

test('it leaves the instruction type of a pinned optional account undefined under the omitted strategy', async () => {
    // Given the same pinned optional account under the `omitted` strategy: the account tuple reads `undefined`
    // as the signal to drop the slot, so that, not an address, is the default.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
        ],
        name: 'myInstruction',
        optionalAccountStrategy: 'omitted',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the type parameter stays optional and unpinned, and the builder assigns nothing.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'TAccountTokenProgram extends string | AccountMeta<string> | undefined = undefined',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        `TAccountTokenProgram extends string | AccountMeta<string> | undefined = '${TOKEN_PROGRAM_ADDRESS}'`,
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
    ]);
});

test('it pins the instruction type of an optional account whose default another account derives from', async () => {
    // Given an optional account whose value another account's PDA seeds read: the builder must apply its default
    // or the derivation throws on a null, so the address reaches the meta and the type names it.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'ata',
                        seeds: [variablePdaSeedNode('tokenProgram', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'ata',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder assigns the pinned address and the instruction type carries it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
        `TAccountTokenProgram extends string | AccountMeta<string> = '${TOKEN_PROGRAM_ADDRESS}'`,
    ]);
});

test('it pins the instruction type of a read optional account under the omitted strategy too', async () => {
    // Given the same exception under the strategy that drops omitted accounts: the builder fills the account in
    // on every call, so it is never dropped and `undefined` is a shape the builder cannot produce.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'ata',
                        seeds: [variablePdaSeedNode('tokenProgram', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'ata',
            }),
        ],
        name: 'myInstruction',
        optionalAccountStrategy: 'omitted',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the type parameter keeps its `undefined` arm but defaults to the address this builder always assigns.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
        `TAccountTokenProgram extends string | AccountMeta<string> | undefined = '${TOKEN_PROGRAM_ADDRESS}'`,
    ]);
});

test('it pins the instruction type of an optional account in an instruction containing a resolver', async () => {
    // Given the other exception: a resolver may read any account, so every default is applied, optional or not.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: resolverValueNode('resolveMint'),
                isSigner: false,
                isWritable: true,
                name: 'mint',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder assigns the pinned address and the instruction type carries it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
        `TAccountTokenProgram extends string | AccountMeta<string> = '${TOKEN_PROGRAM_ADDRESS}'`,
    ]);
});

test('it drops accounts defaulting to a constant-seed linked PDA', async () => {
    // Given a PDA whose seeds are all constants, e.g. Anchor's `emit_cpi!` `event_authority`.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('eventAuthority'),
                        isSigner: false,
                        isWritable: false,
                        name: 'eventAuthority',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({ name: 'eventAuthority', seeds: [constantPdaSeedNodeFromString('utf8', '__event_authority')] }),
        ],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account is gone from the input and the builder assigns the generated constant.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /eventAuthority\??:\s*(Address|ProgramDerivedAddress)</,
        'TAccountEventAuthority extends string = string',
    ]);
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'accounts.eventAuthority.value = EVENT_AUTHORITY_PDA_ADDRESS;',
    ]);
});

test('it drops accounts defaulting to a constant-seed inline PDA', async () => {
    // Given an inline PDA with only constant seeds: one address, folded here rather than derived at runtime.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'programData',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [constantPdaSeedNodeFromString('utf8', 'program_data')],
                    }),
                ),
                isSigner: false,
                isWritable: false,
                name: 'programData',
            }),
            instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account is gone from the input, the address is inlined, and no async builder remains.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /programData\??:\s*(Address|ProgramDerivedAddress)</,
        'TAccountProgramData extends string = string',
        'await getProgramDerivedAddress',
        'getMyInstructionInstructionAsync',
    ]);
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        /accounts\.programData\.value =\s*'[1-9A-HJ-NP-Za-km-z]{32,44}' as Address</,
    ]);
});

test('it keeps inline PDA accounts whose seeds are not all constant', async () => {
    // Given an inline PDA that still needs a caller-supplied seed.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'counter',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('authority', accountValueNode('authority'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'counter',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an input and keeps deriving at runtime.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'counter?: Address<TAccountCounter>;',
        'await getProgramDerivedAddress',
    ]);
});

test('it applies no default to an optional account whose PDA cannot be resolved without awaiting', async () => {
    // Given the shape above with `counter` optional: nothing applies the async-only default, so it stays omittable.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'counter',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('authority', accountValueNode('authority'))],
                ),
                isOptional: true,
                isSigner: false,
                isWritable: true,
                name: 'counter',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder still declares both accounts.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        /export type MyInstructionInput<\s*TAccountAuthority extends string = string,\s*TAccountCounter extends string = string,?\s*>/,
    ]);

    // And never assigns the derived address to it, so omitting `counter` reaches the account metas.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'accounts.counter.value = await getProgramDerivedAddress',
    ]);
});

test('it renders no async builder when the only asynchronous default belongs to an optional account', async () => {
    // Given an instruction whose only asynchronous work is deriving an optional account's PDA. Nothing applies
    // that default, so an `…Async` variant would duplicate the synchronous one.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'counter',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('authority', accountValueNode('authority'))],
                ),
                isOptional: true,
                isSigner: false,
                isWritable: true,
                name: 'counter',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then only the synchronous builder is rendered.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'MyInstructionAsyncInput',
        'getMyInstructionInstructionAsync',
        'await ',
    ]);
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export function getMyInstructionInstruction<',
    ]);
});

test('it still applies an optional account default that another account derives from', async () => {
    // Given an optional account pinned to a bare address, whose value another account's PDA seeds read. Skipping
    // the default would leave it null and the derivation would throw, so the reader wins.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'ata',
                        seeds: [variablePdaSeedNode('tokenProgram', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'ata',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder assigns the pinned address before the seed reads it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
    ]);
});

test('it still applies an optional account default that an argument reads the bump of', async () => {
    // Given an optional account whose PDA an argument's `accountBumpValueNode` reads. The bump comes only from
    // the derived tuple, so the account is still derived — and deriving it awaits, so the async builder stays.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'counter',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('authority', accountValueNode('authority'))],
                ),
                isOptional: true,
                isSigner: false,
                isWritable: true,
                name: 'counter',
            }),
        ],
        arguments: [
            instructionArgumentNode({
                defaultValue: accountBumpValueNode('counter'),
                name: 'counterBump',
                type: numberTypeNode('u8'),
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the asynchronous builder survives and derives the account the bump comes out of.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export async function getMyInstructionInstructionAsync<',
        'accounts.counter.value = await getProgramDerivedAddress',
    ]);
});

test('it still applies an optional account program-id default that another account derives from', async () => {
    // Given an optional account defaulting to the program id under the `programId` strategy, read by another
    // account's PDA seeds. A reader needs the value itself, not the meta `getAccountMeta` fills.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: programIdValueNode(),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'someProgram',
            }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'ata',
                        seeds: [variablePdaSeedNode('someProgram', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('someProgram', accountValueNode('someProgram'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'ata',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder assigns the program address before the seed reads it.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'accounts.someProgram.value = programAddress',
    ]);
});

test('it still applies an optional account default when the instruction contains a resolver', async () => {
    // Given an optional pinned account in an instruction that also runs a resolver. The resolver body is opaque
    // here and may read any account, so skipping the default would hand it a null — the same reason rule 5 of
    // `getFixedInstructionAccountAddress` bails on the whole instruction.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: resolverValueNode('resolveMint'),
                isSigner: false,
                isWritable: true,
                name: 'mint',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder assigns the pinned address, so the resolver sees what it always saw.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        `accounts.tokenProgram.value = '${TOKEN_PROGRAM_ADDRESS}' as Address<'${TOKEN_PROGRAM_ADDRESS}'>;`,
    ]);
});

test('it makes an extra argument optional when only a skipped optional account default reads it', async () => {
    // Given an extra argument whose sole reader is the skipped default of an optional account. Nothing consumes
    // it, so requiring it would make callers invent a value that never reaches the instruction.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: argumentValueNode('authorityOverride'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'delegate',
            }),
            instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
        ],
        extraArguments: [instructionArgumentNode({ name: 'authorityOverride', type: publicKeyTypeNode() })],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the argument is optional in the input type.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        /authorityOverride\?:\s*MyInstructionInstructionExtraArgs\['authorityOverride'\];/,
    ]);
});

test('it makes a dead extra argument optional in the asynchronous builder too', async () => {
    // Given the same dead extra argument in an instruction that also renders an `…Async` variant. No builder
    // applies `delegate`'s default, so neither input type may demand `authorityOverride`.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'counter',
                        programId: TOKEN_PROGRAM_ADDRESS,
                        seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('authority', accountValueNode('authority'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'counter',
            }),
            instructionAccountNode({
                defaultValue: argumentValueNode('authorityOverride'),
                isOptional: true,
                isSigner: false,
                isWritable: false,
                name: 'delegate',
            }),
        ],
        extraArguments: [instructionArgumentNode({ name: 'authorityOverride', type: publicKeyTypeNode() })],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then neither input type carries it in its required form.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['export type MyInstructionAsyncInput<']);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        /authorityOverride:\s*MyInstructionInstructionExtraArgs/,
    ]);
});

test('it pins the instruction type to the literal address of every removed account', async () => {
    // Given one pinned account and one caller-facing account.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the caller-facing type parameter survives and the dropped account becomes a literal in the type.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export function getMyInstructionInstruction<TAccountMint extends string>(',
        `input: MyInstructionInput<TAccountMint>`,
        new RegExp(
            `\\):\\s*MyInstructionInstruction<\\s*typeof MY_PROGRAM_PROGRAM_ADDRESS,\\s*'${TOKEN_PROGRAM_ADDRESS}',\\s*TAccountMint\\s*>`,
        ),
    ]);

    // And the instruction type itself still declares the account, defaulted to the same literal.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        new RegExp(`TAccountTokenProgram extends string \\| AccountMeta<string> =\\s*'${TOKEN_PROGRAM_ADDRESS}'`),
    ]);
});

test('it removes the same accounts from the sync and async builders', async () => {
    // Given an instruction that renders both builders, with one pinned account dropped from both.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
            instructionAccountNode({
                defaultValue: pdaValueNode(
                    pdaNode({
                        name: 'counter',
                        seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                    }),
                    [pdaSeedValueNode('authority', accountValueNode('authority'))],
                ),
                isSigner: false,
                isWritable: true,
                name: 'counter',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then both input types drop the pinned account and keep the same remaining parameters.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        /export type MyInstructionAsyncInput<\s*TAccountAuthority extends string = string,\s*TAccountCounter extends string = string,?\s*>/,
        /export type MyInstructionInput<\s*TAccountAuthority extends string = string,\s*TAccountCounter extends string = string,?\s*>/,
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [/tokenProgram\??:\s*Address</]);
});

test('it renders a zero-parameter builder when every account is pinned', async () => {
    // Given an instruction made up entirely of pinned accounts and no caller-supplied arguments.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
            instructionAccountNode({
                defaultValue: programIdValueNode(),
                isSigner: false,
                isWritable: false,
                name: 'program',
            }),
        ],
        arguments: [instructionArgumentNode({ name: 'discriminator', type: numberTypeNode('u8') })],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder still takes the data argument but no account input.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export type MyInstructionInput = {',
        "discriminator: MyInstructionInstructionDataArgs['discriminator'];",
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'export type MyInstructionInput<',
        'input.tokenProgram',
        'input.program',
    ]);
});

test('it keeps the pinned account in the parse helper', async () => {
    // Given a pinned account: the parsed instruction describes the wire, which still has every account meta.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                isSigner: false,
                isWritable: false,
                name: 'tokenProgram',
            }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the parse helper still exposes the account.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['tokenProgram: TAccountMetas[0];']);
});

test('it keeps pinned accounts whose bump another account reads', async () => {
    // Given a pinned PDA whose bump feeds an argument: the tuple, and therefore the account, is read.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('eventAuthority'),
                        isSigner: false,
                        isWritable: false,
                        name: 'eventAuthority',
                    }),
                ],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: accountBumpValueNode('eventAuthority'),
                        name: 'bump',
                        type: numberTypeNode('u8'),
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [
            pdaNode({ name: 'eventAuthority', seeds: [constantPdaSeedNodeFromString('utf8', '__event_authority')] }),
        ],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the account stays an input and keeps the whole `ProgramDerivedAddress` the bump comes from.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'eventAuthority?: ProgramDerivedAddress<TAccountEventAuthority>;',
        'accounts.eventAuthority.value = findEventAuthorityPda();',
    ]);
});

test('it keeps pinned accounts referenced by a linked PDA seed', async () => {
    // Given a linked PDA that seeds itself from a pinned account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: publicKeyValueNode(TOKEN_PROGRAM_ADDRESS, 'tokenProgram'),
                        isSigner: false,
                        isWritable: false,
                        name: 'tokenProgram',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pdaLinkNode('vault'), [
                            pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram')),
                        ]),
                        isSigner: false,
                        isWritable: true,
                        name: 'vault',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'vault', seeds: [variablePdaSeedNode('tokenProgram', publicKeyTypeNode())] })],
        publicKey: MY_PROGRAM_ADDRESS,
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the pinned account stays an input.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'tokenProgram?: Address<TAccountTokenProgram>;',
    ]);
});

// Nothing but these two tests ties rule 3 to `getCommonInstructionAccountDefaultRules`, which lives in another
// package: a rule added or reshaped there would otherwise start silently dropping guessed accounts again.

/** The kinds {@link getInstructionAccountDefaultAddress} can resolve to a single address. */
const ADDRESS_KINDS = ['pdaValueNode', 'programIdValueNode', 'programLinkNode', 'publicKeyValueNode'];
/** Kinds that name a caller, so they never resolve to an address and can never be dropped. */
const CALLER_KINDS = ['identityValueNode', 'payerValueNode'];

/**
 * An account name the rule matches, derived from its pattern by keeping the first branch of every
 * alternation and every optional part. Asserted against the rule itself, so an unhandled shape fails loudly.
 */
function accountNameMatching(pattern: RegExp | string): string {
    if (typeof pattern === 'string') return pattern;
    let source = pattern.source.replace(/^\^/, '').replace(/\$$/, '');
    while (source.includes('(')) {
        source = source.replace(/\(([^()]*)\)/, (_, group: string) => group.split('|')[0]);
    }
    const name = source.replace(/\?/g, '');
    expect(pattern.test(name), `derived "${name}" does not match ${pattern}`).toBe(true);
    return name;
}

test('every common account-default rule produces a kind rule 3 has been taught about', () => {
    // Given the rules Codama applies to every Anchor IDL.
    const kinds = [...new Set(getCommonInstructionAccountDefaultRules().map(rule => rule.defaultValue.kind))];

    // Then each is either an address rule 3 must vet, or a caller reference that resolves to none.
    // A kind outside both sets is new: teach `hasSynthesisedDefaultValue` about it before adding it here.
    expect(kinds.filter(kind => !ADDRESS_KINDS.includes(kind) && !CALLER_KINDS.includes(kind))).toEqual([]);
});

test.each(
    getCommonInstructionAccountDefaultRules()
        .filter(rule => ADDRESS_KINDS.includes(rule.defaultValue.kind))
        .map(rule => [accountNameMatching(rule.account), rule] as const),
)('it keeps %s, whose default the common rules invent from its name', async (name, rule) => {
    // Given an account as `setInstructionAccountDefaultValuesVisitor` leaves it: only its name suggested the address.
    const node = programWithInstruction({
        accounts: [
            instructionAccountNode({
                defaultValue: rule.defaultValue,
                isSigner: false,
                isWritable: false,
                name,
            }),
            instructionAccountNode({ isSigner: false, isWritable: true, name: 'mint' }),
        ],
        name: 'myInstruction',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the builder still reads it from the caller.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [`input.${name}`]);
});
