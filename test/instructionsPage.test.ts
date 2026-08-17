import {
    accountFieldValueNode,
    accountValueNode,
    argumentValueNode,
    booleanTypeNode,
    booleanValueNode,
    conditionalValueNode,
    constantDiscriminatorNode,
    constantPdaSeedNodeFromString,
    constantValueNode,
    constantValueNodeFromBytes,
    definedTypeLinkNode,
    definedTypeNode,
    enumEmptyVariantTypeNode,
    enumTypeNode,
    enumValueNode,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    identityValueNode,
    instructionAccountNode,
    instructionArgumentNode,
    instructionByteDeltaNode,
    instructionNode,
    instructionRemainingAccountsNode,
    numberTypeNode,
    numberValueNode,
    payerValueNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    publicKeyValueNode,
    resolverValueNode,
    sizeDiscriminatorNode,
    stringTypeNode,
    stringValueNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { getFromRenderMap } from '@codama/renderers-core';
import { visit } from '@codama/visitors-core';
import { test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import {
    codeContains,
    codeDoesNotContain,
    renderMapContains,
    renderMapContainsImports,
    renderMapDoesNotContain,
} from './_setup';

test('it renders instruction accounts that can either be signer or non-signer', async () => {
    // Given the following instruction with a signer or non-signer account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: 'either', isWritable: false, name: 'myAccount' })],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the input to be rendered as either a signer or non-signer.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'myAccount: Address<TAccountMyAccount> | TransactionSigner<TAccountMyAccount>;',
    ]);
});

test('it renders extra arguments that default on each other', async () => {
    // Given the following instruction with two extra arguments
    // such that one defaults to the other.
    const node = programNode({
        instructions: [
            instructionNode({
                extraArguments: [
                    instructionArgumentNode({
                        defaultValue: argumentValueNode('bar'),
                        name: 'foo',
                        type: numberTypeNode('u64'),
                    }),
                    instructionArgumentNode({
                        name: 'bar',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following code to be rendered.
    await renderMapContains(renderMap, 'instructions/create.ts', [
        'const args = { ...input }',
        "if (!args.foo) { args.foo = getNonNullResolvedInstructionInput ( 'bar', args.bar ); }",
    ]);
});

test('it renders the args variable on the async function only if the extra argument has an async default value', async () => {
    // Given the following instruction with an async resolver and an extra argument.
    const node = programNode({
        instructions: [
            instructionNode({
                extraArguments: [
                    instructionArgumentNode({
                        defaultValue: resolverValueNode('myAsyncResolver'),
                        name: 'foo',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    // And split the async and sync functions.
    const [asyncFunction, syncFunction] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+function\s+getCreateInstruction/,
    );

    // Then we expect only the async function to contain the args variable.
    await codeContains(asyncFunction, ['// Original args.', 'const args = { ...input }']);
    await codeDoesNotContain(syncFunction, ['// Original args.', 'const args = { ...input }']);
});

test('it only renders the args variable on the async function if the extra argument is used in an async default value', async () => {
    // Given the following instruction with an async resolver depending on
    // an extra argument such that the instruction has no data arguments.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: resolverValueNode('myAsyncResolver', { dependsOn: [argumentValueNode('bar')] }),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                extraArguments: [
                    instructionArgumentNode({
                        name: 'bar',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    // And split the async and sync functions.
    const [asyncFunction, syncFunction] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+function\s+getCreateInstruction/,
    );

    // Then we expect only the async function to contain the args variable.
    await codeContains(asyncFunction, ['// Original args.', 'const args = { ...input }']);
    await codeDoesNotContain(syncFunction, ['// Original args.', 'const args = { ...input }']);
});

test('it renders seed-only extra arguments as optional in the sync input type but required in the async input type', async () => {
    // Given an instruction with an extra argument that is only used
    // as a PDA seed for an account default value.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('guard', [pdaSeedValueNode('mint', argumentValueNode('guardMint'))]),
                        isSigner: false,
                        isWritable: false,
                        name: 'guard',
                    }),
                ],
                extraArguments: [instructionArgumentNode({ name: 'guardMint', type: publicKeyTypeNode() })],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'guard', seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // And split the async and sync sections of the file.
    const [asyncSection, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // Then we expect the argument to stay required in the async input type
    // since the async builder reads it to derive the account.
    await codeContains(asyncSection, /guardMint:\s*CreateInstructionExtraArgs\[['"]guardMint['"]\];/);
    await codeDoesNotContain(asyncSection, /guardMint\?:/);

    // And we expect it to be optional in the sync input type
    // since the sync builder never reads it.
    await codeContains(syncSection, /guardMint\?:\s*CreateInstructionExtraArgs\[['"]guardMint['"]\];/);
});

test('it keeps extra arguments referenced by byte deltas required in the sync input type', async () => {
    // Given an instruction with an extra argument that is used both
    // as a PDA seed for an account default value and by a byte delta.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('guard', [pdaSeedValueNode('space', argumentValueNode('space'))]),
                        isSigner: false,
                        isWritable: false,
                        name: 'guard',
                    }),
                ],
                byteDeltas: [instructionByteDeltaNode(argumentValueNode('space'))],
                extraArguments: [instructionArgumentNode({ name: 'space', type: numberTypeNode('u64') })],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'guard', seeds: [variablePdaSeedNode('space', numberTypeNode('u64'))] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // And split the async and sync sections of the file.
    const [, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // Then we expect the argument to stay required in the sync input type
    // since the sync builder reads it unconditionally for the byte delta.
    await codeContains(syncSection, /space:\s*CreateInstructionExtraArgs\[['"]space['"]\];/);
    await codeDoesNotContain(syncSection, /space\?:/);
});

test('it keeps extra arguments referenced by remaining accounts required in the sync input type', async () => {
    // Given an instruction with an extra argument that is used both
    // as a PDA seed for an account default value and by remaining accounts.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode('guard', [pdaSeedValueNode('mint', argumentValueNode('payer'))]),
                        isSigner: false,
                        isWritable: false,
                        name: 'guard',
                    }),
                ],
                extraArguments: [instructionArgumentNode({ name: 'payer', type: publicKeyTypeNode() })],
                name: 'create',
                remainingAccounts: [instructionRemainingAccountsNode(argumentValueNode('payer'))],
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'guard', seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // And split the async and sync sections of the file.
    const [, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // Then we expect the argument to stay required in the sync input type
    // since the sync builder reads it unconditionally for the remaining accounts.
    await codeContains(syncSection, /payer:\s*CreateInstructionExtraArgs\[['"]payer['"]\];/);
    await codeDoesNotContain(syncSection, /payer\?:/);
});

test('it renders extra arguments only used by async resolver dependencies as optional in the sync input type', async () => {
    // Given an instruction with an extra argument that is only used
    // as a dependency of an async resolver on an account default value.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: resolverValueNode('myAsyncResolver', { dependsOn: [argumentValueNode('bar')] }),
                        isSigner: false,
                        isWritable: false,
                        name: 'foo',
                    }),
                ],
                extraArguments: [instructionArgumentNode({ name: 'bar', type: numberTypeNode('u64') })],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    // And split the async and sync sections of the file.
    const [asyncSection, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // Then we expect the argument to stay required in the async input type
    // since the async builder passes it to the resolver.
    await codeContains(asyncSection, /bar:\s*CreateInstructionExtraArgs\[['"]bar['"]\];/);
    await codeDoesNotContain(asyncSection, /bar\?:/);

    // And we expect it to be optional in the sync input type
    // since the sync builder skips the async resolver entirely.
    await codeContains(syncSection, /bar\?:\s*CreateInstructionExtraArgs\[['"]bar['"]\];/);
});

test('it keeps extra arguments referenced by sync-rendered account defaults required', async () => {
    // Given an instruction with an extra argument that is used inside
    // a conditional account default value which renders synchronously.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: conditionalValueNode({
                            condition: argumentValueNode('useDefaultMint'),
                            ifTrue: publicKeyValueNode('3333'),
                        }),
                        isSigner: false,
                        isWritable: false,
                        name: 'mint',
                    }),
                ],
                extraArguments: [instructionArgumentNode({ name: 'useDefaultMint', type: booleanTypeNode() })],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the argument to stay required in the input type
    // since the sync builder reads it to evaluate the condition.
    await renderMapContains(renderMap, 'instructions/create.ts', [
        /useDefaultMint:\s*CreateInstructionExtraArgs\[['"]useDefaultMint['"]\];/,
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/create.ts', [/useDefaultMint\?:/]);
});

test('it renders extra arguments only read by skipped conditional defaults as optional in the sync input type', async () => {
    // Given an instruction with an extra argument only used as the condition of
    // an account default whose ifTrue branch is an async-only PDA derivation.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: conditionalValueNode({
                            condition: argumentValueNode('useDefaultMint'),
                            ifTrue: pdaValueNode('mint'),
                        }),
                        isSigner: false,
                        isWritable: false,
                        name: 'mint',
                    }),
                ],
                extraArguments: [instructionArgumentNode({ name: 'useDefaultMint', type: booleanTypeNode() })],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'mint', seeds: [] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // And split the async and sync sections of the file.
    const [asyncSection, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // Then we expect the argument to stay required in the async input type
    // since the async builder reads it to evaluate the condition.
    await codeContains(asyncSection, /useDefaultMint:\s*CreateInstructionExtraArgs\[['"]useDefaultMint['"]\];/);
    await codeDoesNotContain(asyncSection, /useDefaultMint\?:/);

    // And optional in the sync input type since the whole conditional is
    // skipped on the sync path and nothing else reads the argument.
    await codeContains(syncSection, /useDefaultMint\?:\s*CreateInstructionExtraArgs\[['"]useDefaultMint['"]\];/);
});

test('it keeps data arguments with async-only defaults required in the sync input type', async () => {
    // Given an instruction with a data argument whose default value
    // can only be resolved asynchronously.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: resolverValueNode('myAsyncResolver'),
                        name: 'amount',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it with the resolver registered as async.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    // And split the async and sync sections of the file.
    const [asyncSection, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // Then we expect the argument to be optional in the async input type
    // since the async builder applies the resolver default.
    await codeContains(asyncSection, /amount\?:\s*CreateInstructionDataArgs\[['"]amount['"]\];/);

    // And required in the sync input type since the sync builder skips the
    // default and would otherwise encode undefined at runtime.
    await codeContains(syncSection, /amount:\s*CreateInstructionDataArgs\[['"]amount['"]\];/);
    await codeDoesNotContain(syncSection, /amount\?:/);
});

test('it gives the sync builder no input when its only extra argument feeds an async-only default', async () => {
    // Given an instruction where extra argument "a" is only consumed by
    // the async-only resolver default of extra argument "b".
    const node = programNode({
        instructions: [
            instructionNode({
                extraArguments: [
                    instructionArgumentNode({ name: 'a', type: numberTypeNode('u64') }),
                    instructionArgumentNode({
                        defaultValue: resolverValueNode('myAsyncResolver', { dependsOn: [argumentValueNode('a')] }),
                        name: 'b',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it with the resolver registered as async.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    const content = getFromRenderMap(renderMap, 'instructions/create.ts').content;

    // Then we expect "a" to stay required in the async input type
    // since the async builder passes it to the resolver.
    await codeContains(content, /a:\s*CreateInstructionExtraArgs\[['"]a['"]\];/);
    await codeDoesNotContain(content, /a\?:/);

    // And we expect no sync input type: that builder skips the async-only default,
    // so nothing on the sync path reads either argument.
    await codeDoesNotContain(content, /export\s+type\s+CreateInput\b/);
    await codeContains(content, /export\s+function\s+getCreateInstruction\(\s*\)/);
});

test('it gives the sync builder no input when its only extra argument is unread on that path', async () => {
    // Given an instruction with an extra argument that has an async-only
    // resolver default and no other consumers.
    const node = programNode({
        instructions: [
            instructionNode({
                extraArguments: [
                    instructionArgumentNode({
                        defaultValue: resolverValueNode('myAsyncResolver'),
                        name: 'foo',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it with the resolver registered as async.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    const content = getFromRenderMap(renderMap, 'instructions/create.ts').content;

    // Then we expect the argument to be optional in the async input type
    // since the async builder applies the resolver default.
    await codeContains(content, /foo\?:\s*CreateInstructionExtraArgs\[['"]foo['"]\];/);

    // And we expect no sync input type: nothing on that path reads the argument, and an
    // unreferenced `input` parameter would trip `noUnusedParameters` in the client.
    await codeDoesNotContain(content, /export\s+type\s+CreateInput\b/);
    await codeContains(content, /export\s+function\s+getCreateInstruction\(\s*\)/);
});

test('it keeps extra arguments with async-only defaults required in the sync input type when the sync builder reads them', async () => {
    // Given an instruction with an extra argument that has an async-only
    // resolver default but is also read by a byte delta.
    const node = programNode({
        instructions: [
            instructionNode({
                byteDeltas: [instructionByteDeltaNode(argumentValueNode('space'))],
                extraArguments: [
                    instructionArgumentNode({
                        defaultValue: resolverValueNode('myAsyncResolver'),
                        name: 'space',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it with the resolver registered as async.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    // And split the async and sync sections of the file.
    const [asyncSection, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // Then we expect the argument to be optional in the async input type
    // since the async builder applies the resolver default.
    await codeContains(asyncSection, /space\?:\s*CreateInstructionExtraArgs\[['"]space['"]\];/);

    // And required in the sync input type since the sync builder skips the
    // default but still reads the argument for the byte delta.
    await codeContains(syncSection, /space:\s*CreateInstructionExtraArgs\[['"]space['"]\];/);
    await codeDoesNotContain(syncSection, /space\?:/);
});

test('it gives the sync builder an input parameter when only a byte delta reads an extra argument', async () => {
    // Given an instruction whose byte delta is the sync builder's only reader of an
    // extra argument that has an async-only resolver default.
    const node = programNode({
        instructions: [
            instructionNode({
                byteDeltas: [instructionByteDeltaNode(argumentValueNode('space'), { withHeader: true })],
                extraArguments: [
                    instructionArgumentNode({
                        defaultValue: resolverValueNode('myAsyncResolver'),
                        name: 'space',
                        type: numberTypeNode('u64'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it with the resolver registered as async.
    const renderMap = visit(node, getRenderMapVisitor({ asyncResolvers: ['myAsyncResolver'] }));

    // Then we expect the sync builder to take an input parameter.
    await renderMapContains(renderMap, 'instructions/create.ts', [
        /export\s+function\s+getCreateInstruction\(\s*input:\s*CreateInput\s*\)/,
    ]);

    // And split the async and sync sections of the file.
    const [, syncSection] = getFromRenderMap(renderMap, 'instructions/create.ts').content.split(
        /export\s+type\s+CreateInput\b/,
    );

    // And we expect the sync builder to declare the "args" object its byte delta reads.
    await codeContains(syncSection, [
        /const\s+args\s*=\s*\{\s*\.\.\.input\s*,?\s*\}\s*;/,
        /const\s+byteDelta:\s*number\s*=\s*\[Number\(args\.space\)\s*\+\s*BASE_ACCOUNT_SIZE\]/,
    ]);
});

test('it keeps data arguments with identity or payer defaults required in the input type', async () => {
    // Given an instruction with data arguments defaulting to the identity
    // and payer values, which no builder ever resolves.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: identityValueNode(),
                        name: 'authority',
                        type: publicKeyTypeNode(),
                    }),
                    instructionArgumentNode({
                        defaultValue: payerValueNode(),
                        name: 'funder',
                        type: publicKeyTypeNode(),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect both arguments to be required in the input type since the
    // builders never apply these defaults and the encoder cannot fill them.
    await renderMapContains(renderMap, 'instructions/create.ts', [
        /authority:\s*CreateInstructionDataArgs\[['"]authority['"]\];/,
        /funder:\s*CreateInstructionDataArgs\[['"]funder['"]\];/,
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/create.ts', [/authority\?:/, /funder\?:/]);
});

test('it keeps data arguments with account field defaults required in the input type', async () => {
    // Given an instruction with a data argument defaulting to a field of
    // another account's data, which only resolves at display time.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'mint' })],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: accountFieldValueNode({ account: 'mint', path: 'decimals' }),
                        name: 'decimals',
                        type: numberTypeNode('u8'),
                    }),
                ],
                name: 'create',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the argument to be required in the input type since no
    // builder can fetch the account state the default refers to.
    await renderMapContains(renderMap, 'instructions/create.ts', [
        /decimals:\s*CreateInstructionDataArgs\[['"]decimals['"]\];/,
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/create.ts', [/decimals\?:/]);
});

test('it renders instruction accounts with linked PDAs as default value', async () => {
    // Given the following program with a PDA node and an instruction account using it as default value.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode('counter', [
                            pdaSeedValueNode('authority', accountValueNode('authority')),
                        ]),
                        isSigner: false,
                        isWritable: false,
                        name: 'counter',
                    }),
                ],
                name: 'increment',
            }),
        ],
        name: 'counter',
        pdas: [
            pdaNode({
                name: 'counter',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'counter'),
                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following default value to be rendered.
    await renderMapContains(renderMap, 'instructions/increment.ts', [
        'if (!accounts.counter.value) { ' +
            "accounts.counter.value = await findCounterPda( { authority: getAddressFromResolvedInstructionAccount ( 'authority', accounts.authority.value ) } ); " +
            '}',
    ]);
    await renderMapContainsImports(renderMap, 'instructions/increment.ts', { '../pdas/index.js': ['findCounterPda'] });
});

test('it renders instruction accounts with linked PDA default values that point to another account as the program', async () => {
    // Given the following program with a PDA node and an instruction account using it as default value
    // such that the program used to derive the PDA is another account in the instruction.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            'counter',
                            [pdaSeedValueNode('authority', accountValueNode('authority'))],
                            accountValueNode('myProgram'),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'counter',
                    }),
                ],
                name: 'increment',
            }),
        ],
        name: 'counter',
        pdas: [
            pdaNode({
                name: 'counter',
                seeds: [
                    constantPdaSeedNodeFromString('utf8', 'counter'),
                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                ],
            }),
        ],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following default value to be rendered.
    await renderMapContains(renderMap, 'instructions/increment.ts', [
        'if (!accounts.counter.value) { ' +
            "accounts.counter.value = await findCounterPda( { authority: getAddressFromResolvedInstructionAccount ( 'authority', accounts.authority.value ) }, { programAddress: getAddressFromResolvedInstructionAccount ( 'myProgram', accounts.myProgram.value ) } ); " +
            '}',
    ]);
    await renderMapContainsImports(renderMap, 'instructions/increment.ts', { '../pdas/index.js': ['findCounterPda'] });
});

test('it renders instruction accounts with inlined PDAs as default value', async () => {
    // Given the following instruction with an inlined PDA default value.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'counter',
                                seeds: [
                                    constantPdaSeedNodeFromString('utf8', 'counter'),
                                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('authority', accountValueNode('authority'))],
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'counter',
                    }),
                ],
                name: 'increment',
            }),
        ],
        name: 'counter',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following default value to be rendered.
    await renderMapContains(renderMap, 'instructions/increment.ts', [
        'if (!accounts.counter.value) { ' +
            'accounts.counter.value = await getProgramDerivedAddress( { ' +
            '  programAddress, ' +
            '  seeds: [ ' +
            "    getUtf8Encoder().encode('counter'), " +
            "    getAddressEncoder().encode( getAddressFromResolvedInstructionAccount ( 'authority', accounts.authority.value ) ) " +
            '  ] ' +
            '} ); ' +
            '}',
    ]);
    await renderMapContainsImports(renderMap, 'instructions/increment.ts', {
        '@solana/kit': ['getProgramDerivedAddress'],
    });
});

test('it renders instruction accounts with inlined PDA default values that point to another account as the program', async () => {
    // Given the following instruction with an inlined PDA default value
    // such that the program used to derive the PDA is another account in the instruction.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'myProgram' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'counter',
                                seeds: [
                                    constantPdaSeedNodeFromString('utf8', 'counter'),
                                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('authority', accountValueNode('authority'))],
                            accountValueNode('myProgram'),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'counter',
                    }),
                ],
                name: 'increment',
            }),
        ],
        name: 'counter',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following default value to be rendered.
    await renderMapContains(renderMap, 'instructions/increment.ts', [
        'if (!accounts.counter.value) { ' +
            'accounts.counter.value = await getProgramDerivedAddress( { ' +
            "  programAddress: getAddressFromResolvedInstructionAccount ( 'myProgram', accounts.myProgram.value ), " +
            '  seeds: [ ' +
            "    getUtf8Encoder().encode('counter'), " +
            "    getAddressEncoder().encode( getAddressFromResolvedInstructionAccount ( 'authority', accounts.authority.value ) ) " +
            '  ] ' +
            '} ); ' +
            '}',
    ]);
    await renderMapContainsImports(renderMap, 'instructions/increment.ts', {
        '@solana/kit': ['getProgramDerivedAddress'],
    });
});

test('it renders instruction accounts with inlined PDAs from another program as default value', async () => {
    // Given the following instruction with an inlined PDA default value from another program.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'counter',
                                programId: '2222',
                                seeds: [
                                    constantPdaSeedNodeFromString('utf8', 'counter'),
                                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('authority', accountValueNode('authority'))],
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'counter',
                    }),
                ],
                name: 'increment',
            }),
        ],
        name: 'counter',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following default value to be rendered.
    await renderMapContains(renderMap, 'instructions/increment.ts', [
        'if (!accounts.counter.value) { ' +
            'accounts.counter.value = await getProgramDerivedAddress( { ' +
            "  programAddress: '2222' as Address<'2222'>, " +
            '  seeds: [ ' +
            "    getUtf8Encoder().encode('counter'), " +
            "    getAddressEncoder().encode( getAddressFromResolvedInstructionAccount ( 'authority', accounts.authority.value ) ) " +
            '  ] ' +
            '} ); ' +
            '}',
    ]);
    await renderMapContainsImports(renderMap, 'instructions/increment.ts', {
        '@solana/kit': ['Address', 'getProgramDerivedAddress'],
    });
});

test('it prefers the pinned program over the runtime reference on inlined PDA default values', async () => {
    // Given an inlined PDA that points at another account as its program and carries the resolved pin.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
                    instructionAccountNode({
                        defaultValue: publicKeyValueNode('2222'),
                        isSigner: false,
                        isWritable: false,
                        name: 'myProgram',
                    }),
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({
                                name: 'counter',
                                programId: '2222',
                                seeds: [
                                    constantPdaSeedNodeFromString('utf8', 'counter'),
                                    variablePdaSeedNode('authority', publicKeyTypeNode()),
                                ],
                            }),
                            [pdaSeedValueNode('authority', accountValueNode('authority'))],
                            accountValueNode('myProgram'),
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'counter',
                    }),
                ],
                name: 'increment',
            }),
        ],
        name: 'counter',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the derivation uses the pinned address rather than reading the account back at runtime.
    await renderMapContains(renderMap, 'instructions/increment.ts', [
        'if (!accounts.counter.value) { ' +
            'accounts.counter.value = await getProgramDerivedAddress( { ' +
            "  programAddress: '2222' as Address<'2222'>, " +
            '  seeds: [ ' +
            "    getUtf8Encoder().encode('counter'), " +
            "    getAddressEncoder().encode( getAddressFromResolvedInstructionAccount ( 'authority', accounts.authority.value ) ) " +
            '  ] ' +
            '} ); ' +
            '}',
    ]);
});

test('it renders constants for instruction field discriminators', async () => {
    // Given the following instruction with a field discriminator.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(42),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following constant and function to be rendered
    // And we expect the field default value to use that constant.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export const MY_INSTRUCTION_MY_DISCRIMINATOR = 42;',
        'export function getMyInstructionMyDiscriminatorBytes(): ReadonlyUint8Array { return getU8Encoder().encode(MY_INSTRUCTION_MY_DISCRIMINATOR); }',
        '(value) => ({ ...value, myDiscriminator: MY_INSTRUCTION_MY_DISCRIMINATOR })',
    ]);
});

test('it renders constants for boolean field discriminators', async () => {
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: booleanValueNode(true),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: booleanTypeNode(),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });
    const renderMap = visit(node, getRenderMapVisitor());
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export const MY_INSTRUCTION_MY_DISCRIMINATOR = true;',
    ]);
});

test('it renders constants for string field discriminators', async () => {
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: stringValueNode('hello'),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: fixedSizeTypeNode(stringTypeNode('utf8'), 5),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });
    const renderMap = visit(node, getRenderMapVisitor());
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        "export const MY_INSTRUCTION_MY_DISCRIMINATOR = 'hello';",
    ]);
});

test('it renders constants for enum field discriminators', async () => {
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'key',
                type: enumTypeNode([enumEmptyVariantTypeNode('Uninitialized'), enumEmptyVariantTypeNode('Asset')]),
            }),
        ],
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: enumValueNode('key', 'Asset'),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: definedTypeLinkNode('Key'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });
    const renderMap = visit(node, getRenderMapVisitor());
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export const MY_INSTRUCTION_MY_DISCRIMINATOR: Key = Key.Asset;',
    ]);
});

test('it renders constants for bigint field discriminators', async () => {
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(7),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: numberTypeNode('u64'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });
    const renderMap = visit(node, getRenderMapVisitor());
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export const MY_INSTRUCTION_MY_DISCRIMINATOR = 7n;',
    ]);
});

test('it renders constants for bigint constant discriminators', async () => {
    const node = programNode({
        instructions: [
            instructionNode({
                discriminators: [
                    constantDiscriminatorNode(constantValueNode(numberTypeNode('u64'), numberValueNode(7))),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });
    const renderMap = visit(node, getRenderMapVisitor());
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export const MY_INSTRUCTION_DISCRIMINATOR = 7n;',
    ]);
});

test('it renders constants for instruction constant discriminators', async () => {
    // Given the following instruction with two constant discriminators.
    const node = programNode({
        instructions: [
            instructionNode({
                discriminators: [
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '1111')),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '2222'), 2),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following constants and functions to be rendered.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export const MY_INSTRUCTION_DISCRIMINATOR: ReadonlyUint8Array = new Uint8Array([ 17, 17 ]);',
        'export function getMyInstructionDiscriminatorBytes(): ReadonlyUint8Array { return getBytesEncoder().encode(MY_INSTRUCTION_DISCRIMINATOR); }',
        'export const MY_INSTRUCTION_DISCRIMINATOR2: ReadonlyUint8Array = new Uint8Array( [34, 34] );',
        'export function getMyInstructionDiscriminator2Bytes(): ReadonlyUint8Array { return getBytesEncoder().encode(MY_INSTRUCTION_DISCRIMINATOR2); }',
    ]);
});

test('it can override the import of a resolver value node', async () => {
    // Given the following node with a resolver value node.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: resolverValueNode('myResolver'),
                        isSigner: false,
                        isWritable: false,
                        name: 'myAccount',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'counter', seeds: [] })],
        publicKey: '1111',
    });

    // When we render it using a custom import.
    const renderMap = visit(
        node,
        getRenderMapVisitor({
            linkOverrides: {
                resolvers: { myResolver: 'someModule' },
            },
        }),
    );

    // Then we expect the resolver to be exported.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['myResolver(resolverScope)']);

    // And its import path to be overridden.
    await renderMapContainsImports(renderMap, 'instructions/myInstruction.ts', {
        someModule: ['myResolver'],
    });
});

test('it pins the builder to the program address the client was generated for', async () => {
    // Given the following instruction
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect no config parameter and no program type parameter: the builder resolves the program
    // from the generated constant, which keeps it in step with the PDA finders and decoders, none of which
    // can be retargeted at runtime either. To target another deployment, regenerate with a different address.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export function getMyInstructionInstruction(): MyInstructionInstruction< typeof MY_PROGRAM_PROGRAM_ADDRESS >',
        'const programAddress = MY_PROGRAM_PROGRAM_ADDRESS;',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'TProgramAddress',
        'config?: { programAddress',
    ]);
});

test('it renders instructions with no accounts and no data', async () => {
    // Given the following instruction with no accounts and no arguments.
    const node = programNode({
        instructions: [instructionNode({ name: 'myInstruction' })],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the instruction function takes no argument and no input type is generated.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export function getMyInstructionInstruction():',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'export type MyInstructionInput',
        'input: MyInstructionInput',
    ]);
});

test('it renders instructions with no accounts but with some omitted data', async () => {
    // Given the following instruction with no accounts but with a discriminator argument.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(42),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: numberTypeNode('u32'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then the instruction function takes no argument and no input type is generated.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export function getMyInstructionInstruction():',
    ]);
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'export type MyInstructionInput',
        'input: MyInstructionInput',
    ]);
});

test('it does not render an input type for instructions that take no input', async () => {
    // Given one instruction with no accounts and no arguments, and one with an account.
    const node = programNode({
        instructions: [
            instructionNode({ name: 'withoutInput' }),
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'myAccount' })],
                name: 'withInput',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect no input type for the builder that takes no parameter.
    await renderMapDoesNotContain(renderMap, 'instructions/withoutInput.ts', ['export type WithoutInputInput']);

    // And we expect an input type for the instruction whose builder takes one.
    await renderMapContains(renderMap, 'instructions/withInput.ts', [
        'export type WithInputInput <TAccountMyAccount extends string = string> = { myAccount: Address<TAccountMyAccount>; };',
        'input: WithInputInput<TAccountMyAccount>',
    ]);
});

test('it renders instructions with no accounts but with some arguments', async () => {
    // Given the following instruction with no accounts but with a non-omitted argument.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'myArgument', type: numberTypeNode('u32') })],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following input type to be rendered
    // and used as an argument of the instruction function.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        "export type MyInstructionInput = { myArgument: MyInstructionInstructionDataArgs['myArgument']; };",
        'input: MyInstructionInput',
    ]);
});

test('it renders instructions with no arguments but with some accounts', async () => {
    // Given the following instruction with no arguments but with an account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'myAccount' })],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following input type to be rendered
    // and used as an argument of the instruction function.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'export type MyInstructionInput <TAccountMyAccount extends string = string> = { myAccount: Address<TAccountMyAccount>; };',
        'input: MyInstructionInput<TAccountMyAccount>',
    ]);
});

test('it renders a program guard that throws before checking the account metas', async () => {
    // Given the following instruction with an account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'myAccount' })],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the program guard to run before the account-meta count, so a foreign
    // instruction reports the program mismatch rather than a misleading meta count.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'assertIsInstructionForProgram(instruction, MY_PROGRAM_PROGRAM_ADDRESS); ' +
            'if (instruction.accounts.length < 1) {',
    ]);
});

test('it renders a program guard in the parse function of instructions with no accounts and no data', async () => {
    // Given the following bare instruction.
    const node = programNode({
        instructions: [instructionNode({ name: 'myInstruction' })],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we still expect the program guard to be rendered.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'assertIsInstructionForProgram(instruction, MY_PROGRAM_PROGRAM_ADDRESS);',
    ]);
    await renderMapContainsImports(renderMap, 'instructions/myInstruction.ts', {
        '../programs/index.js': ['MY_PROGRAM_PROGRAM_ADDRESS'],
        '@solana/kit': ['assertIsInstructionForProgram'],
    });
});

test('it renders a discriminator guard between the program guard and the account metas', async () => {
    // Given the following discriminated instruction with an account.
    const node = programNode({
        instructions: [
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'myAccount' })],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: numberValueNode(42),
                        defaultValueStrategy: 'omitted',
                        name: 'discriminator',
                        type: numberTypeNode('u8'),
                    }),
                ],
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the discriminator guard to reject sibling instructions of the same program,
    // which the program guard lets through, and to run before the account-meta count so a
    // mis-routed instruction reports the real problem.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', [
        'assertIsInstructionForProgram(instruction, MY_PROGRAM_PROGRAM_ADDRESS); ' +
            'if ( !containsBytes( instruction.data, ' +
            'getU8Encoder().encode(MY_INSTRUCTION_DISCRIMINATOR), 0 ) ) { ' +
            'const error = new Error( ' +
            '`parseMyInstructionInstruction: instruction data does not match the MyInstruction discriminator` ); ' +
            "error.name = 'InstructionDiscriminatorMismatchError'; throw error; } " +
            'if (instruction.accounts.length < 1) {',
    ]);

    // And we expect the following imports.
    await renderMapContainsImports(renderMap, 'instructions/myInstruction.ts', {
        '@solana/kit': ['containsBytes'],
    });
});

test('it renders no instruction discriminator guard when no discriminator constant is known', async () => {
    // Given one undiscriminated instruction and one whose only discriminator is a size, which
    // emits no constant to compare against.
    const node = programNode({
        instructions: [
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'bare',
            }),
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                discriminators: [sizeDiscriminatorNode(8)],
                name: 'sized',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect no discriminator guard, so parse never turns into a length assertion.
    await renderMapDoesNotContain(renderMap, 'instructions/bare.ts', ['InstructionDiscriminatorMismatchError']);
    await renderMapDoesNotContain(renderMap, 'instructions/sized.ts', [
        'InstructionDiscriminatorMismatchError',
        'instruction.data.length === 8',
    ]);
});

test('it renders no instruction discriminator guard when the instruction carries no data', async () => {
    // Given a discriminated instruction with no arguments, whose parsed type therefore has no data.
    const node = programNode({
        instructions: [
            instructionNode({
                discriminators: [constantDiscriminatorNode(constantValueNodeFromBytes('base16', '1111'))],
                name: 'myInstruction',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect no discriminator guard: the parsed instruction type omits `data`, so there is
    // no typed field to compare against.
    await renderMapDoesNotContain(renderMap, 'instructions/myInstruction.ts', [
        'InstructionDiscriminatorMismatchError',
    ]);
});
