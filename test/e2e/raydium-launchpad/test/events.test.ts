import test from 'ava';
import { getAddressEncoder, getU64Encoder } from '@solana/kit';

import {
  ANCHOR_EVENT_CPI_DISCRIMINATOR,
  CLAIM_VESTED_EVENT_DISCRIMINATOR,
  isClaimVestedEvent,
  parseClaimVestedEvent,
  RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
} from '../src/index.js';

const ADDRESS = RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS;

function claimVestedEventBytes(claimAmount: bigint): Uint8Array {
  return new Uint8Array([
    ...ANCHOR_EVENT_CPI_DISCRIMINATOR,
    ...CLAIM_VESTED_EVENT_DISCRIMINATOR,
    ...getAddressEncoder().encode(ADDRESS),
    ...getAddressEncoder().encode(ADDRESS),
    ...getU64Encoder().encode(claimAmount),
  ]);
}

test('parseClaimVestedEvent decodes matching bytes and returns null on others', (t) => {
  const eventData = claimVestedEventBytes(123n);

  const parsed = parseClaimVestedEvent(eventData);
  t.assert(parsed !== null);
  t.is(parsed?.claimAmount, 123n);
  t.is(parsed?.poolState, ADDRESS);

  // Foreign bytes are an expected miss, not an error.
  t.is(parseClaimVestedEvent(new Uint8Array(16)), null);

  // A framed event with a different discriminator is also a miss.
  const otherFramedEvent = new Uint8Array([...ANCHOR_EVENT_CPI_DISCRIMINATOR, ...new Uint8Array(8), 1, 2, 3]);
  t.is(parseClaimVestedEvent(otherFramedEvent), null);
});

test('parseClaimVestedEvent throws when the discriminators match but the body is corrupt', (t) => {
  const truncated = claimVestedEventBytes(123n).slice(0, 24);

  t.throws(() => parseClaimVestedEvent(truncated));
});

test('isClaimVestedEvent checks the discriminators without decoding', (t) => {
  t.true(isClaimVestedEvent(claimVestedEventBytes(123n)));

  // Foreign bytes and other framed events are misses.
  t.false(isClaimVestedEvent(new Uint8Array(16)));
  t.false(isClaimVestedEvent(new Uint8Array([...ANCHOR_EVENT_CPI_DISCRIMINATOR, ...new Uint8Array(8), 1, 2, 3])));

  // No decoding happens, so a corrupt body still matches. Use parse* to validate the body.
  t.true(isClaimVestedEvent(claimVestedEventBytes(123n).slice(0, 24)));
});
