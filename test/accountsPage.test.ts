import {
    accountNode,
    booleanTypeNode,
    constantDiscriminatorNode,
    constantValueNodeFromBytes,
    definedTypeLinkNode,
    definedTypeNode,
    enumEmptyVariantTypeNode,
    enumTypeNode,
    enumValueNode,
    fieldDiscriminatorNode,
    numberTypeNode,
    numberValueNode,
    pdaLinkNode,
    pdaNode,
    programNode,
    publicKeyTypeNode,
    sizeDiscriminatorNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { renderMapContains, renderMapContainsImports, renderMapDoesNotContain } from './_setup';

test('it renders PDA helpers for PDA with no seeds', async () => {
    // Given the following program with 1 account and 1 pda with empty seeds.
    const node = programNode({
        accounts: [accountNode({ name: 'foo', pda: pdaLinkNode('bar') })],
        name: 'myProgram',
        pdas: [pdaNode({ name: 'bar', seeds: [] })],
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the whole config forwarded, so a `programAddress` override reaches the decode owner check.
    await renderMapContains(renderMap, 'accounts/foo.ts', [
        'export async function fetchFooFromSeeds',
        'export async function fetchMaybeFooFromSeeds',
        'await findBarPda({ programAddress })',
        'return await fetchMaybeFoo(rpc, address, config)',
    ]);
});

test('it renders an account with a defined type link as discriminator', async () => {
    // Given the following program with 1 account with a discriminator.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: enumValueNode('key', 'Asset'),
                        defaultValueStrategy: 'omitted',
                        name: 'key',
                        type: definedTypeLinkNode('Key'),
                    }),
                    structFieldTypeNode({
                        name: 'mutable',
                        type: booleanTypeNode(),
                    }),
                    structFieldTypeNode({
                        name: 'owner',
                        type: publicKeyTypeNode(),
                    }),
                ]),
                discriminators: [fieldDiscriminatorNode('key', 0)],
                name: 'asset',
            }),
        ],
        definedTypes: [
            definedTypeNode({
                name: 'key',
                type: enumTypeNode([enumEmptyVariantTypeNode('Uninitialized'), enumEmptyVariantTypeNode('Asset')]),
            }),
        ],
        name: 'splToken',
        publicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following import list with a reference to the disciminator type.
    await renderMapContains(renderMap, 'accounts/asset.ts', ['import { getKeyDecoder, getKeyEncoder, Key }']);
});

test('it renders constants for account field discriminators', async () => {
    // Given the following account with a field discriminator.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(42),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: numberTypeNode('u8'),
                    }),
                ]),
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following constant and function to be rendered
    // And we expect the field default value to use that constant.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', [
        'export const MY_ACCOUNT_MY_DISCRIMINATOR = 42;',
        'export function getMyAccountMyDiscriminatorBytes(): ReadonlyUint8Array { return getU8Encoder().encode(MY_ACCOUNT_MY_DISCRIMINATOR); }',
        '(value) => ({ ...value, myDiscriminator: MY_ACCOUNT_MY_DISCRIMINATOR })',
    ]);
});

test('it renders constants for bigint account field discriminators', async () => {
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(7),
                        defaultValueStrategy: 'omitted',
                        name: 'myDiscriminator',
                        type: numberTypeNode('u64'),
                    }),
                ]),
                discriminators: [fieldDiscriminatorNode('myDiscriminator')],
                name: 'myAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });
    const renderMap = visit(node, getRenderMapVisitor());
    await renderMapContains(renderMap, 'accounts/myAccount.ts', [
        'export const MY_ACCOUNT_MY_DISCRIMINATOR = 7n;',
        'export function getMyAccountMyDiscriminatorBytes(): ReadonlyUint8Array { return getU64Encoder().encode(MY_ACCOUNT_MY_DISCRIMINATOR); }',
    ]);
});

test('it renders constants for account constant discriminators', async () => {
    // Given the following account with two constant discriminators.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '1111')),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '2222'), 2),
                ],
                name: 'myAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the following constants and functions to be rendered.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', [
        'export const MY_ACCOUNT_DISCRIMINATOR: ReadonlyUint8Array = new Uint8Array([ 17, 17 ]);',
        'export function getMyAccountDiscriminatorBytes(): ReadonlyUint8Array { return getBytesEncoder().encode(MY_ACCOUNT_DISCRIMINATOR); }',
        'export const MY_ACCOUNT_DISCRIMINATOR2: ReadonlyUint8Array = new Uint8Array([ 34, 34 ]);',
        'export function getMyAccountDiscriminator2Bytes(): ReadonlyUint8Array { return getBytesEncoder().encode(MY_ACCOUNT_DISCRIMINATOR2); }',
    ]);
});

test('it can extracts account data and import it from another source', async () => {
    // Given the following account.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u32') })]),
                name: 'counter',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it using the following custom account data options.
    const renderMap = visit(
        node,
        getRenderMapVisitor({
            customAccountData: [
                {
                    extract: true,
                    importFrom: 'someModule',
                    name: 'counter',
                },
            ],
        }),
    );

    // Then we expect the account data to be fetched from the hooked directory (by default).
    await renderMapContainsImports(renderMap, 'accounts/counter.ts', {
        someModule: ['getCounterAccountDataDecoder', 'type CounterAccountData'],
    });

    // And we expect the existing account data to be extracted into a new type
    // so it can be imported from the hooked directory.
    await renderMapContains(renderMap, 'types/counterAccountData.ts', [
        'export type CounterAccountData',
        'export type CounterAccountDataArgs',
        'export function getCounterAccountDataEncoder',
        'export function getCounterAccountDataDecoder',
        'export function getCounterAccountDataCodec',
    ]);
});

test('it renders an owner guard in the account decode function', async () => {
    // Given the following program with 1 account.
    const node = programNode({
        accounts: [accountNode({ name: 'myAccount' })],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the decode function to reject foreign-owned accounts, narrowing on `exists` first so
    // non-existing accounts keep returning `{ exists: false }`; callers match the stable error name, not the message.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', [
        'programAddress: Address = MY_PROGRAM_PROGRAM_ADDRESS',
        "if (!('exists' in encodedAccount) || encodedAccount.exists) { " +
            'if (encodedAccount.programAddress !== programAddress) { ' +
            'const error = new Error( `decodeMyAccount: account ${encodedAccount.address} is owned by ' +
            "${encodedAccount.programAddress}, expected ${programAddress}` ); error.name = 'AccountOwnerMismatchError'; " +
            'throw error; } }',
    ]);

    // And we expect the following imports.
    await renderMapContainsImports(renderMap, 'accounts/myAccount.ts', {
        '../programs/index.js': ['MY_PROGRAM_PROGRAM_ADDRESS'],
    });
});

test('it renders a discriminator guard in the account decode function', async () => {
    // Given the following program with 1 discriminated account.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [constantDiscriminatorNode(constantValueNodeFromBytes('base16', '1111'))],
                name: 'myAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect the decode function to reject sibling accounts of the same program, which the
    // owner guard lets through. Callers match the stable error name, not the message.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', [
        'if (!containsBytes(encodedAccount.data, MY_ACCOUNT_DISCRIMINATOR, 0)) { ' +
            'const error = new Error( `decodeMyAccount: account ${encodedAccount.address} ' +
            'does not match the MyAccount discriminator` ); ' +
            "error.name = 'AccountDiscriminatorMismatchError'; throw error; }",
    ]);

    // And we expect the following imports.
    await renderMapContainsImports(renderMap, 'accounts/myAccount.ts', {
        '@solana/kit': ['containsBytes'],
    });
});

test('it renders the account discriminator guard inside the same exists narrowing as the owner guard', async () => {
    // Given the following program with 1 discriminated account.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [constantDiscriminatorNode(constantValueNodeFromBytes('base16', '1111'))],
                name: 'myAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect both guards to share the `exists` narrowing, so the `{ exists: false }` variant
    // — which carries neither a programAddress nor data — keeps returning unthrown.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', [
        "if (!('exists' in encodedAccount) || encodedAccount.exists) { " +
            'if (encodedAccount.programAddress !== programAddress) {',
        "error.name = 'AccountOwnerMismatchError'; throw error; } " +
            'if (!containsBytes(encodedAccount.data, MY_ACCOUNT_DISCRIMINATOR, 0)) {',
    ]);
});

test('it renders the account discriminator guard at each discriminator offset', async () => {
    // Given the following account with two constant discriminators at different offsets.
    const node = programNode({
        accounts: [
            accountNode({
                discriminators: [
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '1111')),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', '2222'), 2),
                ],
                name: 'myAccount',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect every discriminator to be compared at its own offset, matching identify*.
    await renderMapContains(renderMap, 'accounts/myAccount.ts', [
        'if ( !( containsBytes(encodedAccount.data, MY_ACCOUNT_DISCRIMINATOR, 0) && ' +
            'containsBytes(encodedAccount.data, MY_ACCOUNT_DISCRIMINATOR2, 2) ) ) {',
    ]);
});

test('it renders no account discriminator guard when no discriminator constant is known', async () => {
    // Given the following program with one undiscriminated account and one account whose only
    // discriminator is a size, which emits no constant to compare against.
    const node = programNode({
        accounts: [
            accountNode({ name: 'bare' }),
            accountNode({ discriminators: [sizeDiscriminatorNode(42)], name: 'sized' }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it.
    const renderMap = visit(node, getRenderMapVisitor());

    // Then we expect no discriminator guard, so decode never turns into a length assertion.
    await renderMapDoesNotContain(renderMap, 'accounts/bare.ts', ['AccountDiscriminatorMismatchError']);
    await renderMapDoesNotContain(renderMap, 'accounts/sized.ts', [
        'AccountDiscriminatorMismatchError',
        'encodedAccount.data.length === 42',
    ]);
});
