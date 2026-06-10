import test from 'ava';
import { AccountRole, getAddressEncoder, getU64Encoder } from '@solana/kit';

import { renamed } from '../src/index.js';

const {
  ANCHOR_EVENT_CPI_DISCRIMINATOR,
  CLAIM_VESTED_EVENT_DISCRIMINATOR,
  getUpdateConfigInstructionDataEncoder,
  identifyAccount,
  identifyEvent,
  identifyInstruction,
  parseEvent,
  parseInstruction,
  POOL_STATE_DISCRIMINATOR,
  RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
} = renamed;

// generated-renamed is the same IDL rendered with overridden nameTransformers
// (unprefixed helpers, kind/payload parsed keys); verify it works at runtime.

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

test('identifyEvent recognizes framed event data and returns null on garbage', (t) => {
  const eventData = claimVestedEventBytes(123n);

  t.is(identifyEvent(eventData), 'claimVestedEvent');
  t.is(identifyEvent(new Uint8Array(16)), null);
});

test('parseEvent returns the custom kind/payload keys', (t) => {
  const parsed = parseEvent(claimVestedEventBytes(123n));

  t.assert(parsed !== null);
  t.is(parsed?.kind, 'claimVestedEvent');
  if (parsed?.kind === 'claimVestedEvent') {
    t.is(parsed.payload.claimAmount, 123n);
    t.is(parsed.payload.poolState, ADDRESS);
  }

  // The default keys must not leak through alongside the renamed ones.
  t.false('eventType' in (parsed as object));
  t.false('data' in (parsed as object));

  t.is(parseEvent(new Uint8Array(16)), null);
});

test('identifyInstruction and parseInstruction use the custom kind key', (t) => {
  const instruction = {
    accounts: [
      { address: ADDRESS, role: AccountRole.READONLY_SIGNER },
      { address: ADDRESS, role: AccountRole.WRITABLE },
    ],
    data: getUpdateConfigInstructionDataEncoder().encode({ param: 1, value: 42n }),
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
  };

  t.is(identifyInstruction(instruction), 'updateConfig');
  t.is(identifyInstruction(new Uint8Array(8)), null);

  const parsed = parseInstruction(instruction);
  t.assert(parsed !== null);
  t.is(parsed?.kind, 'updateConfig');
  if (parsed?.kind === 'updateConfig') {
    t.is(parsed.data.param, 1);
    t.is(parsed.data.value, 42n);
  }
  t.false('instructionType' in (parsed as object));

  t.is(parseInstruction({ data: new Uint8Array(8), programAddress: ADDRESS }), null);
});

test('identifyAccount works with the unprefixed name', (t) => {
  const accountData = new Uint8Array([...POOL_STATE_DISCRIMINATOR, 0, 0, 0, 0]);

  t.is(identifyAccount(accountData), 'poolState');
  t.is(identifyAccount(new Uint8Array(8)), null);
});
