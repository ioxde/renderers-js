import {
    accountNode,
    constantDiscriminatorNode,
    constantValueNodeFromBytes,
    fieldDiscriminatorNode,
    instructionNode,
    programNode,
    structTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { renderMapContains } from './_setup';

test('it reports a descriptive error for a field discriminator whose data struct omits its fields array', () => {
    // Given an account guarded by a field discriminator whose data struct omits its fields array.
    const node = programNode({
        accounts: [
            accountNode({
                data: structTypeNode(undefined),
                discriminators: [fieldDiscriminatorNode('discriminator')],
                name: 'foo',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // Then rendering rejects the unbacked field discriminator instead of crashing on the missing array.
    expect(() => visit(node, getRenderMapVisitor())).toThrow(
        'Field discriminator "discriminator" does not have a matching argument with default value.',
    );
});

test('it renders a parse function for a custom-data instruction that omits its arguments array', async () => {
    // Given a custom-data instruction with a constant discriminator that omits its arguments array.
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

    // When we render it with custom instruction data.
    const renderMap = visit(node, getRenderMapVisitor({ customInstructionData: ['myInstruction'] }));

    // Then rendering succeeds and the parse helper is emitted.
    await renderMapContains(renderMap, 'instructions/myInstruction.ts', ['export function parse']);
});
