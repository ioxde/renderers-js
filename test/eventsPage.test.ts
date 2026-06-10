import {
    bytesTypeNode,
    bytesValueNode,
    camelCase,
    CamelCaseString,
    constantDiscriminatorNode,
    constantValueNode,
    constantValueNodeFromBytes,
    eventNode,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    hiddenPrefixTypeNode,
    numberTypeNode,
    numberValueNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    sizeDiscriminatorNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { getRenderMapVisitor } from '../src';
import { renderMapContains, renderMapContainsImports, renderMapDoesNotContain } from './_setup';

test('it renders an event with a constant discriminator', async () => {
    const discriminator = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'c80c5f2c6b0b021f'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([
                        structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() }),
                        structFieldTypeNode({ name: 'mint', type: publicKeyTypeNode() }),
                    ]),
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

    await renderMapContains(renderMap, 'events/guardCreatedEvent.ts', [
        'export type GuardCreatedEvent',
        'export function getGuardCreatedEventDecoder()',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/guardCreatedEvent.ts', [
        'getGuardCreatedEventEncoder',
        'getGuardCreatedEventCodec',
        'GuardCreatedEventArgs',
    ]);
    await renderMapContains(renderMap, 'events/guardCreatedEvent.ts', [
        'export const GUARD_CREATED_EVENT_DISCRIMINATOR',
        'export function getGuardCreatedEventDiscriminatorBytes()',
    ]);
    await renderMapContains(renderMap, 'events/guardCreatedEvent.ts', [
        'export function decodeGuardCreatedEvent',
        'data: ReadonlyUint8Array',
        /containsBytes\(.*data,.*GUARD_CREATED_EVENT_DISCRIMINATOR,.*0\)/s,
        /getGuardCreatedEventDecoder\(\)\.decode\(\s*data,\s*GUARD_CREATED_EVENT_DISCRIMINATOR\.length/s,
    ]);
});

test('it renders an event without a discriminator', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                name: 'simpleEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/simpleEvent.ts', [
        'export type SimpleEvent',
        'export function getSimpleEventDecoder()',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/simpleEvent.ts', [
        'getSimpleEventEncoder',
        'getSimpleEventCodec',
        'SimpleEventArgs',
    ]);
});

test('it lazily memoizes the event decoder', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                name: 'simpleEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/simpleEvent.ts', [
        'let getSimpleEventDecoderCache: FixedSizeDecoder<SimpleEvent> | undefined;',
        /return\s*\(getSimpleEventDecoderCache\s*\?\?=\s*getStructDecoder\(/,
    ]);
});

test('it renders events in the events index', async () => {
    const node = rootNode(
        programNode({
            events: [
                eventNode({
                    data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    name: 'myEvent',
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/index.ts', ["export * from './myEvent.js'"]);
});

test('it renders events in the root index', async () => {
    const node = rootNode(
        programNode({
            events: [
                eventNode({
                    data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    name: 'myEvent',
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'index.ts', ["export * from './events/index.js'"]);
});

test('it does not render events module when there are no events', async () => {
    const node = rootNode(
        programNode({
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapDoesNotContain(renderMap, 'index.ts', ["export * from './events/index.js'"]);
});

test('it renders correct imports for event with discriminator', async () => {
    const discriminator = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [discriminator],
                ),
                discriminators: [constantDiscriminatorNode(discriminator)],
                name: 'tradeEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContainsImports(renderMap, 'events/tradeEvent.ts', {
        '@solana/kit': ['containsBytes', 'ReadonlyUint8Array'],
    });
});

test('it renders event docs', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u32') })]),
                docs: ['Some documentation.', 'Second line.'],
                name: 'documentedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/documentedEvent.ts', [
        /\* Some documentation\./,
        /\* Second line\./,
        'export type DocumentedEvent',
    ]);
});

test('it does not render decode function for events without discriminator', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                name: 'simpleEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapDoesNotContain(renderMap, 'events/simpleEvent.ts', ['DISCRIMINATOR', 'decodeSimpleEvent']);
});

test('it renders field discriminator constants on events', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(7),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode' as const,
                        name: camelCase('eventType'),
                        offset: 0,
                    },
                ],
                name: 'typedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/typedEvent.ts', ['TYPED_EVENT_EVENT_TYPE']);
    await renderMapDoesNotContain(renderMap, 'events/typedEvent.ts', ['decodeTypedEvent']);
});

test('it renders an event with an empty struct', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([]),
                name: 'emptyEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/emptyEvent.ts', [
        'export type EmptyEvent',
        'export function getEmptyEventDecoder()',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/emptyEvent.ts', [
        'getEmptyEventEncoder',
        'getEmptyEventCodec',
        'EmptyEventArgs',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/emptyEvent.ts', ['DISCRIMINATOR', 'decodeEmptyEvent']);
});

test('it renders an event with a nested struct field', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
                    structFieldTypeNode({
                        name: 'metadata',
                        type: structTypeNode([
                            structFieldTypeNode({ name: 'label', type: numberTypeNode('u8') }),
                            structFieldTypeNode({ name: 'version', type: numberTypeNode('u16') }),
                        ]),
                    }),
                ]),
                name: 'complexEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/complexEvent.ts', [
        'export type ComplexEvent',
        'metadata: { label: number; version: number }',
    ]);
});

test('it skips decode for constant discriminator without hidden prefix', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(7),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') }),
                ]),
                discriminators: [
                    {
                        kind: 'fieldDiscriminatorNode' as const,
                        name: camelCase('eventType'),
                        offset: 0,
                    },
                    constantDiscriminatorNode(
                        constantValueNode(
                            fixedSizeTypeNode(bytesTypeNode(), 8),
                            bytesValueNode('base16', 'aabbccdd11223344'),
                        ),
                    ),
                ],
                name: 'mixedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/mixedEvent.ts', ['MIXED_EVENT_EVENT_TYPE', 'MIXED_EVENT_DISCRIMINATOR']);
    await renderMapDoesNotContain(renderMap, 'events/mixedEvent.ts', ['decodeMixedEvent']);
});

test('it validates all constant discriminators in decode function', async () => {
    const discriminator1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const discriminator2 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 4),
        bytesValueNode('base16', '11223344'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [discriminator1],
                ),
                discriminators: [
                    constantDiscriminatorNode(discriminator1),
                    constantDiscriminatorNode(discriminator2, 12),
                ],
                name: 'multiDiscEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/multiDiscEvent.ts', [
        'export function decodeMultiDiscEvent',
        /containsBytes\(.*data,.*MULTI_DISC_EVENT_DISCRIMINATOR,.*0\)/s,
        /containsBytes\(.*data,.*MULTI_DISC_EVENT_DISCRIMINATOR2,.*12\)/s,
        'MULTI_DISC_EVENT_DISCRIMINATOR.length',
    ]);
});

test('it renders decode function with non-zero discriminator offset', async () => {
    const discriminator = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [discriminator],
                ),
                discriminators: [constantDiscriminatorNode(discriminator, 4)],
                name: 'offsetEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/offsetEvent.ts', [
        'export function decodeOffsetEvent',
        /containsBytes\(.*data,.*OFFSET_EVENT_DISCRIMINATOR,.*4\)/s,
    ]);
});

test('it renders decode function with multiple hidden prefixes using summed offset', async () => {
    const prefix1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const prefix2 = constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 4), bytesValueNode('base16', '55667788'));
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [prefix1, prefix2],
                ),
                discriminators: [constantDiscriminatorNode(prefix1)],
                name: 'multiPrefixEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/multiPrefixEvent.ts', [
        'export function decodeMultiPrefixEvent',
        /getMultiPrefixEventDecoder\(\)\.decode\(\s*data,\s*12\s*\)/s,
    ]);
});

// Shared fixtures for the CPI-framed event tests below.
const cpiFraming = { kind: 'anchorEventCpi', sharedConstantName: 'eventCpiPrefix' as CamelCaseString };
const framingPrefix = constantValueNode(
    fixedSizeTypeNode(bytesTypeNode(), 8),
    bytesValueNode('base16', 'aabbccdd11223344'),
);
const tradeDisc = constantValueNode(
    fixedSizeTypeNode(bytesTypeNode(), 8),
    bytesValueNode('base16', '1122334455667788'),
);
const settleDisc = constantValueNode(
    fixedSizeTypeNode(bytesTypeNode(), 8),
    bytesValueNode('base16', '99aabbccddeeff00'),
);

function framedEvent(name: string, eventDisc: ReturnType<typeof constantValueNode>) {
    return eventNode({
        data: hiddenPrefixTypeNode(
            structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
            [framingPrefix, eventDisc],
        ),
        discriminators: [constantDiscriminatorNode(framingPrefix, 0), constantDiscriminatorNode(eventDisc, 8)],
        framing: cpiFraming,
        name,
    });
}

test('it hoists the shared framing constant to a dedicated events page', async () => {
    const node = rootNode(
        programNode({
            events: [framedEvent('tradeEvent', tradeDisc), framedEvent('settleEvent', settleDisc)],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/eventCpiPrefix.framing.ts', [
        'export const EVENT_CPI_PREFIX',
        /new Uint8Array\(\[\s*170,\s*187,\s*204,\s*221,\s*17,\s*34,\s*51,\s*68,?\s*\]\)/,
        'export function getEventCpiPrefixBytes()',
    ]);
    await renderMapContains(renderMap, 'events/index.ts', ["export * from './eventCpiPrefix.framing.js'"]);
});

test('it renders per-event discriminator constants with IDL bytes, not framing bytes', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/tradeEvent.ts', [
        'export const TRADE_EVENT_DISCRIMINATOR',
        /new Uint8Array\(\[\s*17,\s*34,\s*51,\s*68,\s*85,\s*102,\s*119,\s*136,?\s*\]\)/,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/tradeEvent.ts', [
        'TRADE_EVENT_DISCRIMINATOR2',
        /170,\s*187,\s*204,\s*221/,
        'export const EVENT_CPI_PREFIX',
    ]);
});

test('it generates decode that validates both the framing prefix and the event discriminator', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/tradeEvent.ts', [
        'export function decodeTradeEvent',
        'containsBytes(data, EVENT_CPI_PREFIX, 0)',
        "throw new Error('Invalid event CPI framing for tradeEvent');",
        'containsBytes(data, TRADE_EVENT_DISCRIMINATOR, 8)',
        "throw new Error('Invalid event discriminator for tradeEvent');",
        /decode\(\s*data,\s*EVENT_CPI_PREFIX\.length \+ TRADE_EVENT_DISCRIMINATOR\.length,?\s*\)/s,
    ]);
    await renderMapContainsImports(renderMap, 'events/tradeEvent.ts', {
        './eventCpiPrefix.framing.js': ['EVENT_CPI_PREFIX'],
    });
});

test('it references the hoisted framing constant in the aggregate identify and parse helpers', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc), framedEvent('settleEvent', settleDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'export function identifyMyProgramEvent',
        'containsBytes(data, EVENT_CPI_PREFIX, 0) && containsBytes(data, TRADE_EVENT_DISCRIMINATOR, 8)',
        'containsBytes(data, EVENT_CPI_PREFIX, 0) && containsBytes(data, SETTLE_EVENT_DISCRIMINATOR, 8)',
        'EVENT_CPI_PREFIX.length + TRADE_EVENT_DISCRIMINATOR.length',
        'EVENT_CPI_PREFIX.length + SETTLE_EVENT_DISCRIMINATOR.length',
    ]);
    await renderMapContainsImports(renderMap, 'events/myProgram.events.ts', {
        './eventCpiPrefix.framing.js': ['EVENT_CPI_PREFIX'],
        './settleEvent.js': ['getSettleEventDecoder', 'SETTLE_EVENT_DISCRIMINATOR'],
        './tradeEvent.js': ['getTradeEventDecoder', 'TRADE_EVENT_DISCRIMINATOR'],
    });
});

test('it falls back to unframed rendering when discriminators do not start with the framing constant', async () => {
    // The event declares a framing but its discriminators omit the framing discriminator.
    const event = eventNode({
        data: hiddenPrefixTypeNode(
            structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
            [framingPrefix, tradeDisc],
        ),
        discriminators: [constantDiscriminatorNode(tradeDisc, 8)],
        framing: cpiFraming,
        name: 'tradeEvent',
    });
    const node = programNode({ events: [event], name: 'myProgram', publicKey: '1111' });

    const renderMap = visit(node, getRenderMapVisitor());

    expect(renderMap.has('events/eventCpiPrefix.framing.ts')).toBe(false);
    await renderMapContains(renderMap, 'events/tradeEvent.ts', [
        'export const TRADE_EVENT_DISCRIMINATOR',
        /new Uint8Array\(\[\s*17,\s*34,\s*51,\s*68,\s*85,\s*102,\s*119,\s*136,?\s*\]\)/,
        'containsBytes(data, TRADE_EVENT_DISCRIMINATOR, 8)',
        /getTradeEventDecoder\(\)\.decode\(\s*data,\s*16\s*\)/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/tradeEvent.ts', ['EVENT_CPI_PREFIX']);
});

test('it falls back to unframed rendering when an event framing diverges from the hoisted constant', async () => {
    // Same shared constant name as `framingPrefix` but different bytes.
    const divergingPrefix = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'ffffffffffffffff'),
    );
    const divergingEvent = eventNode({
        data: hiddenPrefixTypeNode(
            structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
            [divergingPrefix, settleDisc],
        ),
        discriminators: [constantDiscriminatorNode(divergingPrefix, 0), constantDiscriminatorNode(settleDisc, 8)],
        framing: cpiFraming,
        name: 'settleEvent',
    });
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc), divergingEvent],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    // The first event's framing is hoisted and still used.
    await renderMapContains(renderMap, 'events/eventCpiPrefix.framing.ts', [
        /new Uint8Array\(\[\s*170,\s*187,\s*204,\s*221,\s*17,\s*34,\s*51,\s*68,?\s*\]\)/,
    ]);
    await renderMapContains(renderMap, 'events/tradeEvent.ts', ['containsBytes(data, EVENT_CPI_PREFIX, 0)']);
    // The diverging event keeps its own discriminator constants and validation.
    await renderMapContains(renderMap, 'events/settleEvent.ts', [
        'export const SETTLE_EVENT_DISCRIMINATOR',
        'export const SETTLE_EVENT_DISCRIMINATOR2',
        'containsBytes(data, SETTLE_EVENT_DISCRIMINATOR, 0)',
        'containsBytes(data, SETTLE_EVENT_DISCRIMINATOR2, 8)',
        /getSettleEventDecoder\(\)\.decode\(\s*data,\s*16\s*\)/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/settleEvent.ts', ['EVENT_CPI_PREFIX']);
});

test('it renders a string-literal union of all available events for a program', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(1),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() }),
                ]),
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'guardCreatedEvent',
            }),
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'version', type: numberTypeNode('u8') })]),
                discriminators: [sizeDiscriminatorNode(1)],
                name: 'guardUpdatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        "export type MyProgramEventType = 'guardCreatedEvent' | 'guardUpdatedEvent';",
    ]);
});

test('it does not render an aggregate events page when no events have discriminators', () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() })]),
                name: 'guardCreatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    expect(renderMap.has('events/myProgram.events.ts')).toBe(false);
});

test('it does not render an aggregate events page when there are no events', () => {
    const node = programNode({
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    expect(renderMap.has('events/myProgram.events.ts')).toBe(false);
});

test('it renders a function that identifies events in a program', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(1),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() }),
                ]),
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'guardCreatedEvent',
            }),
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'version', type: numberTypeNode('u8') })]),
                discriminators: [
                    sizeDiscriminatorNode(40),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', 'aabb'), 0),
                ],
                name: 'guardUpdatedEvent',
            }),
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                discriminators: [],
                name: 'simpleEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'export function identifyMyProgramEvent',
        'event: { data: ReadonlyUint8Array } | ReadonlyUint8Array',
        'MyProgramEventType | null',
        "return 'guardCreatedEvent';",
        "return 'guardUpdatedEvent';",
        'return null;',
    ]);

    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ["'simpleEvent'", 'throw new Error']);
});

test('it renders a parsed union type of all available events for a program', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(1),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() }),
                ]),
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'guardCreatedEvent',
            }),
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'version', type: numberTypeNode('u8') })]),
                discriminators: [sizeDiscriminatorNode(1)],
                name: 'guardUpdatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'export type ParsedMyProgramEvent =',
        "| { eventType: 'guardCreatedEvent'; data: GuardCreatedEvent }",
        "| { eventType: 'guardUpdatedEvent'; data: GuardUpdatedEvent }",
    ]);
    await renderMapContainsImports(renderMap, 'events/myProgram.events.ts', {
        './guardCreatedEvent.js': ['GuardCreatedEvent'],
        './guardUpdatedEvent.js': ['GuardUpdatedEvent'],
    });
});

test('it renders a function that parses events in a program', async () => {
    const discriminator1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const discriminator2 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', '1122334455667788'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() })]),
                    [discriminator1],
                ),
                discriminators: [constantDiscriminatorNode(discriminator1)],
                name: 'guardCreatedEvent',
            }),
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'version', type: numberTypeNode('u8') })]),
                    [discriminator2],
                ),
                discriminators: [constantDiscriminatorNode(discriminator2)],
                name: 'guardUpdatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'export function parseMyProgramEvent',
        'event: { data: ReadonlyUint8Array } | ReadonlyUint8Array',
        'ParsedMyProgramEvent | null',
        'const eventType = identifyMyProgramEvent(event);',
        'if (eventType === null) return null;',
        'switch (eventType)',
        "case 'guardCreatedEvent'",
        /data:\s*getGuardCreatedEventDecoder\(\)\.decode\(\s*data,\s*GUARD_CREATED_EVENT_DISCRIMINATOR\.length,?\s*\)/s,
        "case 'guardUpdatedEvent'",
        /data:\s*getGuardUpdatedEventDecoder\(\)\.decode\(\s*data,\s*GUARD_UPDATED_EVENT_DISCRIMINATOR\.length,?\s*\)/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['default:', 'throw new Error']);

    await renderMapContainsImports(renderMap, 'events/myProgram.events.ts', {
        './guardCreatedEvent.js': ['GUARD_CREATED_EVENT_DISCRIMINATOR', 'getGuardCreatedEventDecoder'],
        './guardUpdatedEvent.js': ['GUARD_UPDATED_EVENT_DISCRIMINATOR', 'getGuardUpdatedEventDecoder'],
    });
});

test('it renders parse function using decoder for events without decode function', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([
                    structFieldTypeNode({
                        defaultValue: numberValueNode(1),
                        name: 'eventType',
                        type: numberTypeNode('u8'),
                    }),
                    structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() }),
                ]),
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'guardCreatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'parseMyProgramEvent',
        /data:\s*getGuardCreatedEventDecoder\(\)\.decode\(data\)/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['decodeGuardCreatedEvent']);
});

test('it exports the aggregate events page from the events and root indexes', async () => {
    const node = rootNode(
        programNode({
            events: [framedEvent('tradeEvent', tradeDisc)],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/index.ts', ["export * from './myProgram.events.js'"]);
    await renderMapContains(renderMap, 'index.ts', ["export * from './events/index.js'"]);
});

test('it renders the aggregate events page alongside an event named like the program aggregate', async () => {
    const node = rootNode(
        programNode({
            events: [
                eventNode({
                    data: structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    discriminators: [
                        constantDiscriminatorNode(constantValueNodeFromBytes('base16', 'aabbccdd11223344'), 0),
                    ],
                    name: 'myProgramEvents',
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    const renderMap = visit(node, getRenderMapVisitor());

    // The dotted aggregate file name cannot collide with the camelCase event page; both coexist.
    await renderMapContains(renderMap, 'events/myProgramEvents.ts', ['MY_PROGRAM_EVENTS_DISCRIMINATOR']);
    await renderMapContains(renderMap, 'events/myProgram.events.ts', ['identifyMyProgramEvent', 'parseMyProgramEvent']);
    const eventsIndex = renderMap.get('events/index.ts');
    expect(eventsIndex?.content.match(/'\.\/myProgramEvents\.js'/g)).toHaveLength(1);
    expect(eventsIndex?.content.match(/'\.\/myProgram\.events\.js'/g)).toHaveLength(1);
});

test('it renders custom parsed event keys via nameTransformers', async () => {
    // Given two events with constant discriminators.
    const discriminator1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const discriminator2 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', '1122334455667788'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'guard', type: publicKeyTypeNode() })]),
                    [discriminator1],
                ),
                discriminators: [constantDiscriminatorNode(discriminator1)],
                name: 'guardCreatedEvent',
            }),
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'version', type: numberTypeNode('u8') })]),
                    [discriminator2],
                ),
                discriminators: [constantDiscriminatorNode(discriminator2)],
                name: 'guardUpdatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we render it with overridden parsed-event keys.
    const renderMap = visit(
        node,
        getRenderMapVisitor({
            nameTransformers: {
                programEventsParsedDataKey: () => 'payload',
                programEventsParsedDiscriminatorKey: () => 'kind',
            },
        }),
    );

    // Then the parsed union and switch cases use the custom keys.
    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        "| { kind: 'guardCreatedEvent'; payload: GuardCreatedEvent }",
        "| { kind: 'guardUpdatedEvent'; payload: GuardUpdatedEvent }",
        /kind:\s*'guardCreatedEvent',\s*payload:\s*getGuardCreatedEventDecoder\(\)/s,
    ]);
    // And the data-key override must not rename the identifier's local `data` variable.
    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        "const data = 'data' in event ? event.data : event;",
        /containsBytes\(\s*data,/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['eventType:', 'data: getGuard']);
});

test('it throws when the parsed event discriminator and data keys are identical', () => {
    // Given an event with a constant discriminator.
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

    // When both keys resolve to the same string, the generated objects would have
    // duplicate keys, so generation throws instead of emitting broken code.
    expect(() =>
        visit(
            node,
            getRenderMapVisitor({
                nameTransformers: {
                    programEventsParsedDataKey: () => 'kind',
                    programEventsParsedDiscriminatorKey: () => 'kind',
                },
            }),
        ),
    ).toThrow(/programEventsParsedDiscriminatorKey.*programEventsParsedDataKey/);
});
