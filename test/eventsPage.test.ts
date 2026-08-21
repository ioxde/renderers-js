import {
    bytesTypeNode,
    bytesValueNode,
    camelCase,
    CamelCaseString,
    constantDiscriminatorNode,
    constantValueNode,
    constantValueNodeFromBytes,
    definedTypeNode,
    enumStructVariantTypeNode,
    enumTypeNode,
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
        'export function isGuardCreatedEvent',
        'data: ReadonlyUint8Array',
        ': boolean',
        /return containsBytes\(data,\s*GUARD_CREATED_EVENT_DISCRIMINATOR,\s*0\);/s,
        'export function parseGuardCreatedEvent',
        'GuardCreatedEvent | null',
        'if (!isGuardCreatedEvent(checkedEvent))',
        'return null;',
        /getGuardCreatedEventDecoder\(\)\.decode\(\s*data,\s*GUARD_CREATED_EVENT_DISCRIMINATOR\.length/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/guardCreatedEvent.ts', [
        'decodeGuardCreatedEvent',
        'throw new Error',
    ]);
});

test('it renders parse for events with a field discriminator', async () => {
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
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'typedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/typedEvent.ts', [
        'export function parseTypedEvent',
        'TypedEvent | null',
        /containsBytes\(\s*data,\s*getU8Encoder\(\)\.encode\(TYPED_EVENT_EVENT_TYPE\),\s*0,?\s*\)/s,
        /return getTypedEventDecoder\(\)\.decode\(data\);/,
    ]);
});

test('it renders parse combining size and constant discriminators', async () => {
    const node = programNode({
        events: [
            eventNode({
                data: structTypeNode([structFieldTypeNode({ name: 'version', type: numberTypeNode('u8') })]),
                discriminators: [
                    sizeDiscriminatorNode(40),
                    constantDiscriminatorNode(constantValueNodeFromBytes('base16', 'aabb'), 0),
                ],
                name: 'guardUpdatedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/guardUpdatedEvent.ts', [
        'export function parseGuardUpdatedEvent',
        /data\.length === 40\s*&&\s*containsBytes\(data,\s*GUARD_UPDATED_EVENT_DISCRIMINATOR,\s*0\)/s,
        'return null;',
        /return getGuardUpdatedEventDecoder\(\)\.decode\(data\);/,
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

test('it does not render parse for events without discriminator', async () => {
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

    await renderMapDoesNotContain(renderMap, 'events/simpleEvent.ts', [
        'DISCRIMINATOR',
        'parseSimpleEvent',
        'decodeSimpleEvent',
        'isSimpleEvent',
    ]);
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
    await renderMapDoesNotContain(renderMap, 'events/emptyEvent.ts', ['DISCRIMINATOR', 'parseEmptyEvent']);
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

test('it renders parse for events with mixed discriminators and no hidden prefix', async () => {
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
    await renderMapContains(renderMap, 'events/mixedEvent.ts', [
        'export function parseMixedEvent',
        /return getMixedEventDecoder\(\)\.decode\(data\);/,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/mixedEvent.ts', ['decodeMixedEvent']);
});

test('it validates all constant discriminators in parse', async () => {
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
        'export function parseMultiDiscEvent',
        /containsBytes\(.*data,.*MULTI_DISC_EVENT_DISCRIMINATOR,.*0\)/s,
        /containsBytes\(.*data,.*MULTI_DISC_EVENT_DISCRIMINATOR2,.*12\)/s,
        'MULTI_DISC_EVENT_DISCRIMINATOR.length',
    ]);
});

test('it renders parse with non-zero discriminator offset', async () => {
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
        'export function parseOffsetEvent',
        /containsBytes\(.*data,.*OFFSET_EVENT_DISCRIMINATOR,.*4\)/s,
    ]);
});

test('it renders parse with multiple hidden prefixes using summed offset', async () => {
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
        'export function parseMultiPrefixEvent',
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

/** An event whose only discriminator is the shared framing — wire-indistinguishable from siblings. */
function framingOnlyEvent(name: string) {
    return eventNode({
        data: hiddenPrefixTypeNode(
            structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
            [framingPrefix],
        ),
        discriminators: [constantDiscriminatorNode(framingPrefix, 0)],
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

test('it generates parse that validates both the framing prefix and the event discriminator', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/tradeEvent.ts', [
        'export function isTradeEvent',
        'export function parseTradeEvent',
        'data: ReadonlyUint8Array',
        'TradeEvent | null',
        /return \(?\s*containsBytes\(data,\s*EVENT_CPI_PREFIX,\s*0\)\s*&&\s*containsBytes\(data,\s*TRADE_EVENT_DISCRIMINATOR,\s*8\)\s*\)?;/s,
        'if (!isTradeEvent(checkedEvent))',
        'return null;',
        /decode\(\s*data,\s*EVENT_CPI_PREFIX\.length \+ TRADE_EVENT_DISCRIMINATOR\.length,?\s*\)/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/tradeEvent.ts', ['decodeTradeEvent', 'throw new Error']);
    await renderMapContainsImports(renderMap, 'events/tradeEvent.ts', {
        './eventCpiPrefix.framing.js': ['EVENT_CPI_PREFIX'],
    });
});

test('it documents the parse contract and the decode-free identify alternative', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/tradeEvent.ts', [
        'without decoding. Never throws.',
        '@see parseTradeEvent to decode the matching data',
        'Returns `null` on framing or discriminator',
        '@see isTradeEvent to check without decoding',
        '@see identifyMyProgramEvent to identify any program event',
    ]);
    await renderMapContains(renderMap, 'events/myProgram.events.ts', ['without decoding']);
});

test('it hoists the framing check in identify and keeps the framing constant in parse', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc), framedEvent('settleEvent', settleDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'export function identifyMyProgramEvent',
        // The framing check is hoisted once and guards the per-event discriminator chain.
        /if \(containsBytes\(data, EVENT_CPI_PREFIX, 0\)\) \{\s*if \(containsBytes\(data, TRADE_EVENT_DISCRIMINATOR, 8\)\)\s*\{?\s*return 'tradeEvent';/s,
        /if \(containsBytes\(data, SETTLE_EVENT_DISCRIMINATOR, 8\)\)\s*\{?\s*return 'settleEvent';/s,
        'EVENT_CPI_PREFIX.length + TRADE_EVENT_DISCRIMINATOR.length',
        'EVENT_CPI_PREFIX.length + SETTLE_EVENT_DISCRIMINATOR.length',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['isTradeEvent', 'isSettleEvent']);
    await renderMapContainsImports(renderMap, 'events/myProgram.events.ts', {
        './eventCpiPrefix.framing.js': ['EVENT_CPI_PREFIX'],
        './settleEvent.js': ['getSettleEventDecoder', 'SETTLE_EVENT_DISCRIMINATOR'],
        './tradeEvent.js': ['getTradeEventDecoder', 'TRADE_EVENT_DISCRIMINATOR'],
    });
});

test('it skips parse and aggregate membership for events identified only by the framing', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc), framingOnlyEvent('mysteryEvent')],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    // The unidentifiable event still gets its type and decoder for manual decoding.
    await renderMapContains(renderMap, 'events/mysteryEvent.ts', [
        'export type MysteryEvent',
        'export function getMysteryEventDecoder()',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/mysteryEvent.ts', ['parseMysteryEvent', 'isMysteryEvent']);
    // The aggregate excludes it: matching on framing alone would shadow every other event.
    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        "export type MyProgramEventType = 'tradeEvent';",
    ]);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['mysteryEvent']);
});

test('it does not render an aggregate events page when no event is identifiable beyond the framing', () => {
    const node = programNode({
        events: [framingOnlyEvent('mysteryEvent')],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    expect(renderMap.has('events/myProgram.events.ts')).toBe(false);
});

test('it throws when an event name collides with the aggregate parse helper', () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'trade',
        publicKey: '1111',
    });

    // eventParseFunction('tradeEvent') and programEventsParseFunction('trade') both
    // resolve to 'parseTradeEvent'; dual `export *` would silently exclude the symbol.
    expect(() => visit(node, getRenderMapVisitor())).toThrow(/parseTradeEvent/);
});

test('it throws when an event is helper collides with a discriminated-union type guard', () => {
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'tradeEvent',
                type: enumTypeNode([
                    enumStructVariantTypeNode(
                        'filled',
                        structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
                    ),
                ]),
            }),
        ],
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    // eventIsFunction('tradeEvent') and isDiscriminatedUnionFunction('tradeEvent') both
    // resolve to 'isTradeEvent'; the barrel's `export *` would silently drop the duplicate.
    expect(() => visit(node, getRenderMapVisitor())).toThrow(/isTradeEvent/);
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
        'export function parseTradeEvent',
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
        'data: ReadonlyUint8Array',
        'MyProgramEventType | null',
        "return 'guardCreatedEvent';",
        /data\.length === 40\s*&&\s*containsBytes\(data,\s*GUARD_UPDATED_EVENT_DISCRIMINATOR,\s*0\)/s,
        "return 'guardUpdatedEvent';",
        'return null;',
    ]);

    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ["'simpleEvent'", 'throw new Error']);
    await renderMapContainsImports(renderMap, 'events/myProgram.events.ts', {
        './guardUpdatedEvent.js': ['GUARD_UPDATED_EVENT_DISCRIMINATOR'],
    });
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
        "const checkedEvent = 'data' in event ? { data: event.data, programAddress: event.programAddress } : event;",
        'data: ReadonlyUint8Array',
        'ParsedMyProgramEvent | null',
        'const eventType = identifyMyProgramEvent(checkedEvent);',
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

test('it renders the aggregate parse using the raw decoder without re-validating discriminators', async () => {
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
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['parseGuardCreatedEvent(']);
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
    // And the data-key override must not rename the identifier's `data` parameter.
    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'data: ReadonlyUint8Array',
        /containsBytes\(data,\s*GUARD_CREATED_EVENT_DISCRIMINATOR,\s*0\)/s,
    ]);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['eventType:', 'data: getGuard']);
});

test('it renders custom event parse names via nameTransformers', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(
        node,
        getRenderMapVisitor({
            nameTransformers: {
                eventIsFunction: (name, { pascalCase }) => `matches${pascalCase(name)}`,
                eventParseFunction: (name, { pascalCase }) => `extract${pascalCase(name)}`,
            },
        }),
    );

    await renderMapContains(renderMap, 'events/tradeEvent.ts', [
        'export function matchesTradeEvent',
        'export function extractTradeEvent',
        'if (!matchesTradeEvent(checkedEvent))',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/tradeEvent.ts', ['parseTradeEvent', 'isTradeEvent']);
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

test('it guards the per-event helpers with the program address', async () => {
    const discriminator = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'c80c5f2c6b0b021f'),
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

    // The object arm requires `programAddress`, so the check cannot be skipped by call shape,
    // and the raw-bytes arm stays as the explicit opt-out.
    await renderMapContains(renderMap, 'events/guardCreatedEvent.ts', [
        'export function isGuardCreatedEvent',
        /event:\s*\|?\s*\{\s*data:\s*ReadonlyUint8Array;\s*programAddress:\s*Address\s*\}\s*\|\s*ReadonlyUint8Array/s,
        /if \(\s*'data' in event &&\s*event\.programAddress !== MY_PROGRAM_PROGRAM_ADDRESS\s*\)\s*return false;/s,
        "const data = 'data' in event ? event.data : event;",
        'export function parseGuardCreatedEvent',
        // Each property is read once into a snapshot, so a getter cannot swap bytes under the guard.
        "const checkedEvent = 'data' in event ? { data: event.data, programAddress: event.programAddress } : event;",
        'if (!isGuardCreatedEvent(checkedEvent))',
    ]);
    // No expected-program override: the program address is fixed at generation time.
    await renderMapDoesNotContain(renderMap, 'events/guardCreatedEvent.ts', [
        'programAddress: Address =',
        'programAddress?: Address',
    ]);
    // The guard lives in `is*` alone, which `parse*` delegates to, so the two cannot drift.
    const eventPage = renderMap.get('events/guardCreatedEvent.ts');
    expect(eventPage?.content.match(/event\.programAddress !==/g)).toHaveLength(1);
    await renderMapContainsImports(renderMap, 'events/guardCreatedEvent.ts', {
        '../programs/index.js': ['MY_PROGRAM_PROGRAM_ADDRESS'],
    });
});

test('it guards the per-event helpers of an event without framing', async () => {
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
                discriminators: [fieldDiscriminatorNode('eventType')],
                name: 'typedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/typedEvent.ts', [
        /if \(\s*'data' in event &&\s*event\.programAddress !== MY_PROGRAM_PROGRAM_ADDRESS\s*\)\s*return false;/s,
        /return containsBytes\(\s*data,\s*getU8Encoder\(\)\.encode\(TYPED_EVENT_EVENT_TYPE\),\s*0,?\s*\)/s,
        'if (!isTypedEvent(checkedEvent))',
        /return getTypedEventDecoder\(\)\.decode\(data\);/,
    ]);
});

test('it guards the aggregate event helpers with the program address', async () => {
    const node = programNode({
        events: [framedEvent('tradeEvent', tradeDisc)],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/myProgram.events.ts', [
        'export function identifyMyProgramEvent',
        /event:\s*\|?\s*\{\s*data:\s*ReadonlyUint8Array;\s*programAddress:\s*Address\s*\}\s*\|\s*ReadonlyUint8Array/s,
        // Foreign events are ordinary in a transaction scan, so the aggregate returns null.
        /if \(\s*'data' in event &&\s*event\.programAddress !== MY_PROGRAM_PROGRAM_ADDRESS\s*\)\s*return null;/s,
        "const data = 'data' in event ? event.data : event;",
        'export function parseMyProgramEvent',
        "const checkedEvent = 'data' in event ? { data: event.data, programAddress: event.programAddress } : event;",
        'const eventType = identifyMyProgramEvent(checkedEvent);',
    ]);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', [
        'programAddress: Address =',
        'programAddress?: Address',
    ]);
    // The guard lives in `identify*` alone, which `parse*` funnels through.
    const eventsPage = renderMap.get('events/myProgram.events.ts');
    expect(eventsPage?.content.match(/event\.programAddress !==/g)).toHaveLength(1);
    await renderMapContainsImports(renderMap, 'events/myProgram.events.ts', {
        '../programs/index.js': ['MY_PROGRAM_PROGRAM_ADDRESS'],
    });
});

test('it makes the gate prove a decode offset the discriminators fall short of', async () => {
    const prefix1 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const prefix2 = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', '5566778899aabbcc'),
    );
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [prefix1, prefix2],
                ),
                discriminators: [constantDiscriminatorNode(prefix1)],
                name: 'skewedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/skewedEvent.ts', ['data.length >= 16', /decode\(\s*data,\s*16\s*\)/s]);
    await renderMapContains(renderMap, 'events/myProgram.events.ts', ['data.length >= 16']);
});

test('it omits the length clause when the discriminators already prove the decode offset', async () => {
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
                name: 'coveredEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapContains(renderMap, 'events/coveredEvent.ts', ['COVERED_EVENT_DISCRIMINATOR.length']);
    await renderMapDoesNotContain(renderMap, 'events/coveredEvent.ts', ['data.length >=']);
    await renderMapDoesNotContain(renderMap, 'events/myProgram.events.ts', ['data.length >=']);
});

test('it drops parse helpers when a hidden prefix entry has no statically known width', async () => {
    const discriminator = constantValueNode(
        fixedSizeTypeNode(bytesTypeNode(), 8),
        bytesValueNode('base16', 'aabbccdd11223344'),
    );
    const unsized = constantValueNode(bytesTypeNode(), bytesValueNode('base16', 'aabb'));
    const node = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(
                    structTypeNode([structFieldTypeNode({ name: 'value', type: numberTypeNode('u64') })]),
                    [discriminator, unsized],
                ),
                discriminators: [constantDiscriminatorNode(discriminator)],
                name: 'unsizedEvent',
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    const renderMap = visit(node, getRenderMapVisitor());

    await renderMapDoesNotContain(renderMap, 'events/unsizedEvent.ts', [
        'export function parseUnsizedEvent',
        'export function isUnsizedEvent',
    ]);
});
