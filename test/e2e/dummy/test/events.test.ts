import test from 'ava';
import { getAddressEncoder, getU64Encoder, type Address, type ReadonlyUint8Array } from '@solana/kit';

import {
  ALPHA_PROGRAM_ADDRESS,
  ALPHA_TRADE_EVENT_DISCRIMINATOR,
  ANCHOR_EVENT_CPI_DISCRIMINATOR,
  BETA_PROGRAM_ADDRESS,
  BETA_TRADE_EVENT_DISCRIMINATOR,
  DUMMY_PROGRAM_ADDRESS,
  identifyAlphaEvent,
  isAlphaTradeEvent,
  parseAlphaEvent,
  parseAlphaTradeEvent,
} from '../src/index.js';

// Both events carry sha256("event:TradeEvent")[..8] — the bytes Anchor derives for any event named
// TradeEvent — even though the IDL names them alphaTradeEvent and betaTradeEvent: beta's
// discriminator is pinned to alpha's rather than its own sha256("event:BetaTradeEvent")[..8], which
// is what two programs each declaring a TradeEvent look like on the wire. One package cannot hold
// two events of the same name, so the names differ and the bytes do not. Alpha's body — a single
// address — is a strict prefix of beta's, so nothing but the emitting program separates them.
const SOME_ADDRESS = ALPHA_PROGRAM_ADDRESS;

function alphaEventBytes(): ReadonlyUint8Array {
  return new Uint8Array([
    ...ANCHOR_EVENT_CPI_DISCRIMINATOR,
    ...ALPHA_TRADE_EVENT_DISCRIMINATOR,
    ...getAddressEncoder().encode(SOME_ADDRESS),
  ]);
}

// A different poolState from alpha's, so a decode can be traced back to the bytes it read.
function betaEventBytes(): ReadonlyUint8Array {
  return new Uint8Array([
    ...ANCHOR_EVENT_CPI_DISCRIMINATOR,
    ...BETA_TRADE_EVENT_DISCRIMINATOR,
    ...getAddressEncoder().encode(BETA_PROGRAM_ADDRESS),
    ...getU64Encoder().encode(1_000n),
  ]);
}

test('alpha and beta share their framing and discriminator bytes', (t) => {
  t.deepEqual(
    Array.from(ALPHA_TRADE_EVENT_DISCRIMINATOR),
    Array.from(BETA_TRADE_EVENT_DISCRIMINATOR),
  );
  t.not(ALPHA_PROGRAM_ADDRESS, BETA_PROGRAM_ADDRESS);
});

test('isAlphaTradeEvent rejects a byte-identical event emitted by beta', (t) => {
  const data = betaEventBytes();

  t.false(isAlphaTradeEvent({ data, programAddress: BETA_PROGRAM_ADDRESS }));
  t.is(parseAlphaTradeEvent({ data, programAddress: BETA_PROGRAM_ADDRESS }), null);
  t.is(identifyAlphaEvent({ data, programAddress: BETA_PROGRAM_ADDRESS }), null);
  t.is(parseAlphaEvent({ data, programAddress: BETA_PROGRAM_ADDRESS }), null);

  // Without the guard this is what a caller got: alpha's decoder tolerates beta's trailing bytes,
  // so the same bytes parse into a well-typed wrong answer carrying beta's payload.
  t.is(parseAlphaTradeEvent(data)?.poolState, BETA_PROGRAM_ADDRESS);
});

test('the alpha helpers accept alpha events and reject a third program', (t) => {
  const data = alphaEventBytes();

  t.true(isAlphaTradeEvent({ data, programAddress: ALPHA_PROGRAM_ADDRESS }));
  t.is(parseAlphaTradeEvent({ data, programAddress: ALPHA_PROGRAM_ADDRESS })?.poolState, SOME_ADDRESS);
  t.is(identifyAlphaEvent({ data, programAddress: ALPHA_PROGRAM_ADDRESS }), 'alphaTradeEvent');
  t.is(parseAlphaEvent({ data, programAddress: ALPHA_PROGRAM_ADDRESS })?.eventType, 'alphaTradeEvent');

  t.false(isAlphaTradeEvent({ data, programAddress: DUMMY_PROGRAM_ADDRESS }));
  t.is(parseAlphaTradeEvent({ data, programAddress: DUMMY_PROGRAM_ADDRESS }), null);
  t.is(identifyAlphaEvent({ data, programAddress: DUMMY_PROGRAM_ADDRESS }), null);
  t.is(parseAlphaEvent({ data, programAddress: DUMMY_PROGRAM_ADDRESS }), null);
});

test('bare bytes skip the program check', (t) => {
  // The union is source-compatible, so a call site that predates the guard keeps its old behaviour:
  // bytes carry no emitter, so beta's event still matches alpha's helpers. The JS renderer fails open.
  const data = betaEventBytes();

  t.true(isAlphaTradeEvent(data));
  t.not(parseAlphaTradeEvent(data), null);
  t.is(identifyAlphaEvent(data), 'alphaTradeEvent');
  t.not(parseAlphaEvent(data), null);
});

test('is is true exactly when parse is non-null', (t) => {
  const cases: { data: ReadonlyUint8Array; programAddress: Address }[] = [
    { data: alphaEventBytes(), programAddress: ALPHA_PROGRAM_ADDRESS },
    { data: alphaEventBytes(), programAddress: BETA_PROGRAM_ADDRESS },
    { data: betaEventBytes(), programAddress: ALPHA_PROGRAM_ADDRESS },
    { data: betaEventBytes(), programAddress: BETA_PROGRAM_ADDRESS },
    { data: new Uint8Array(0), programAddress: ALPHA_PROGRAM_ADDRESS },
    { data: new Uint8Array(4), programAddress: ALPHA_PROGRAM_ADDRESS },
    { data: alphaEventBytes().slice(0, 12), programAddress: ALPHA_PROGRAM_ADDRESS },
  ];

  for (const event of cases) {
    t.is(isAlphaTradeEvent(event), parseAlphaTradeEvent(event) !== null, JSON.stringify(event.programAddress));
    t.is(identifyAlphaEvent(event) === null, parseAlphaEvent(event) === null);
  }
});

test('data shorter than the discriminators is a mismatch, not a range error', (t) => {
  // `containsBytes` compares against a clamped slice, so truncation reads as a miss.
  for (const length of [0, 1, 8, 12, 15]) {
    const data = alphaEventBytes().slice(0, length);
    const event = { data, programAddress: ALPHA_PROGRAM_ADDRESS };
    t.false(isAlphaTradeEvent(event));
    t.is(parseAlphaTradeEvent(event), null);
    t.is(identifyAlphaEvent(event), null);
    t.is(parseAlphaEvent(event), null);
  }
});

test('a getter-backed event is read once, so its bytes cannot change under the guard', (t) => {
  // `{ data, programAddress }` is satisfied by an object with getters, so a helper that reads a
  // property twice can guard one value and decode another. Each of these objects returns alpha's
  // view on the first read of a property and beta's on every read after it; the helpers must
  // behave exactly as if handed a plain snapshot of those first reads.

  // Alpha bytes under alpha's id: the snapshot parses, and the decode must not pick up beta's
  // payload from a second read of `data`.
  const bytesFlip = () => {
    let reads = 0;
    return {
      get data() {
        return reads++ === 0 ? alphaEventBytes() : betaEventBytes();
      },
      programAddress: ALPHA_PROGRAM_ADDRESS,
    };
  };
  t.is(parseAlphaTradeEvent(bytesFlip())?.poolState, SOME_ADDRESS);
  const parsed = parseAlphaEvent(bytesFlip());
  t.is(parsed?.eventType, 'alphaTradeEvent');
  if (parsed?.eventType === 'alphaTradeEvent') t.is(parsed.data.poolState, SOME_ADDRESS);

  // Beta bytes under beta's id: rejected on the first read, and a later read returning alpha's id
  // must not rescue it.
  const idFlip = () => {
    let reads = 0;
    return {
      data: betaEventBytes(),
      get programAddress() {
        return reads++ === 0 ? BETA_PROGRAM_ADDRESS : ALPHA_PROGRAM_ADDRESS;
      },
    };
  };
  t.false(isAlphaTradeEvent(idFlip()));
  t.is(parseAlphaTradeEvent(idFlip()), null);
  t.is(identifyAlphaEvent(idFlip()), null);
  t.is(parseAlphaEvent(idFlip()), null);

  // Both properties flipping at once must still agree with the plain first-read snapshot.
  const bothFlip = () => {
    let dataReads = 0;
    let programReads = 0;
    return {
      get data() {
        return dataReads++ === 0 ? alphaEventBytes() : betaEventBytes();
      },
      get programAddress() {
        return programReads++ === 0 ? ALPHA_PROGRAM_ADDRESS : BETA_PROGRAM_ADDRESS;
      },
    };
  };
  const snapshot = { data: alphaEventBytes(), programAddress: ALPHA_PROGRAM_ADDRESS };
  t.is(isAlphaTradeEvent(bothFlip()), isAlphaTradeEvent(snapshot));
  t.deepEqual(parseAlphaTradeEvent(bothFlip()), parseAlphaTradeEvent(snapshot));
  t.is(identifyAlphaEvent(bothFlip()), identifyAlphaEvent(snapshot));
  t.deepEqual(parseAlphaEvent(bothFlip()), parseAlphaEvent(snapshot));
});
