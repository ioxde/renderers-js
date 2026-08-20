import test from 'ava';
import {
  AccountRole,
  address,
  getAddressEncoder,
  getBase64Decoder,
  getU64Encoder,
  isSolanaError,
  lamports,
  SOLANA_ERROR__INSTRUCTION__PROGRAM_ID_MISMATCH,
  type AccountMeta,
  type ReadonlyUint8Array,
} from '@solana/kit';

import {
  ANCHOR_EVENT_CPI_DISCRIMINATOR,
  CLAIM_VESTED_EVENT_DISCRIMINATOR,
  decodeVestingRecord,
  getBuyExactInInstructionDataEncoder,
  getSellExactInInstructionDataEncoder,
  getVestingRecordEncoder,
  identifyRaydiumLaunchpadAccount,
  identifyRaydiumLaunchpadEvent,
  identifyRaydiumLaunchpadInstruction,
  isClaimVestedEvent,
  parseBuyExactInInstruction,
  parseClaimVestedEvent,
  parseRaydiumLaunchpadEvent,
  parseRaydiumLaunchpadInstruction,
  POOL_STATE_DISCRIMINATOR,
  RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
  raydiumLaunchpadProgram,
  type RaydiumLaunchpadPluginRequirements,
} from '../src/index.js';

// Anchor discriminators derive from names alone, so identical bytes routinely belong to a different
// program. These tests pin the per-site behaviour of the generated program guards.
const FOREIGN_PROGRAM_ADDRESS = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SOME_ADDRESS = address('So11111111111111111111111111111111111111112');

function buyExactInData(): ReadonlyUint8Array {
  return getBuyExactInInstructionDataEncoder().encode({
    amountIn: 1_000n,
    minimumAmountOut: 900n,
    shareFeeRate: 0n,
  });
}

function accountMetas(count: number): AccountMeta[] {
  return Array.from({ length: count }, () => ({ address: SOME_ADDRESS, role: AccountRole.READONLY }));
}

// buyExactIn and sellExactIn share a layout — discriminator plus three u64s — so a mis-routed
// sibling parses into a well-typed wrong answer unless the discriminator is compared.
function sellExactInData(): ReadonlyUint8Array {
  return getSellExactInInstructionDataEncoder().encode({
    amountIn: 1_000n,
    minimumAmountOut: 900n,
    shareFeeRate: 0n,
  });
}

function vestingRecordData(): ReadonlyUint8Array {
  return getVestingRecordEncoder().encode({
    beneficiary: SOME_ADDRESS,
    claimedAmount: 7n,
    epoch: 42n,
    padding: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    pool: SOME_ADDRESS,
    tokenShareAmount: 21n,
  });
}

test('parseBuyExactInInstruction throws on a foreign program and parses its own', (t) => {
  const accounts = accountMetas(15);
  const data = buyExactInData();

  const error = t.throws(() =>
    parseBuyExactInInstruction({ accounts, data, programAddress: FOREIGN_PROGRAM_ADDRESS }),
  );
  t.true(isSolanaError(error, SOLANA_ERROR__INSTRUCTION__PROGRAM_ID_MISMATCH));
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION__PROGRAM_ID_MISMATCH)) {
    t.is(error.context.expectedProgramAddress, RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS);
    t.is(error.context.actualProgramAddress, FOREIGN_PROGRAM_ADDRESS);
  }

  // Positive control: the same instruction under its own program parses.
  const parsed = parseBuyExactInInstruction({
    accounts,
    data,
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
  });
  t.is(parsed.programAddress, RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS);
  t.is(parsed.data.amountIn, 1_000n);
});

test('parseBuyExactInInstruction reports the program mismatch before the account-meta count', (t) => {
  // Too few account metas *and* the wrong program: the program mismatch is the real problem.
  const error = t.throws(() =>
    parseBuyExactInInstruction({
      accounts: accountMetas(0),
      data: buyExactInData(),
      programAddress: FOREIGN_PROGRAM_ADDRESS,
    }),
  );
  t.true(isSolanaError(error, SOLANA_ERROR__INSTRUCTION__PROGRAM_ID_MISMATCH));
});

test('parseRaydiumLaunchpadInstruction returns null on a foreign program and parses its own', (t) => {
  const accounts = accountMetas(15);
  const data = buyExactInData();

  // Callers iterate whole transactions, where other programs are ordinary rather than erroneous.
  t.is(parseRaydiumLaunchpadInstruction({ accounts, data, programAddress: FOREIGN_PROGRAM_ADDRESS }), null);

  const parsed = parseRaydiumLaunchpadInstruction({
    accounts,
    data,
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
  });
  t.is(parsed?.instructionType, 'buyExactIn');
});

test('decodeVestingRecord throws on a foreign owner and decodes its own', (t) => {
  const encodedAccount = {
    address: SOME_ADDRESS,
    data: vestingRecordData(),
    executable: false,
    lamports: lamports(1_000_000n),
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
    space: 112n,
  };

  const error = t.throws(() =>
    decodeVestingRecord({ ...encodedAccount, programAddress: FOREIGN_PROGRAM_ADDRESS }),
  );
  t.is(error?.name, 'AccountOwnerMismatchError');
  t.true(error?.message.includes(RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS));
  t.true(error?.message.includes(FOREIGN_PROGRAM_ADDRESS));

  // Positive control: an account owned by the program decodes.
  const decoded = decodeVestingRecord(encodedAccount);
  t.is(decoded.data.epoch, 42n);
  t.is(decoded.data.claimedAmount, 7n);
});

test('the plugin self-fetch goes through the owner guard', async (t) => {
  // Without this delegation to the fetch helpers, the raw codec silently decodes foreign-owned accounts.
  const rpcAccount = (owner: string) => ({
    context: { slot: 0n },
    value: {
      data: [getBase64Decoder().decode(vestingRecordData()), 'base64'],
      executable: false,
      lamports: 1_000_000n,
      owner,
      rentEpoch: 0n,
      space: 112n,
    },
  });
  const makeClient = (owner: string) => {
    const rpc = { getAccountInfo: () => ({ send: () => Promise.resolve(rpcAccount(owner)) }) };
    return raydiumLaunchpadProgram()({ rpc } as unknown as RaydiumLaunchpadPluginRequirements);
  };

  const error = await t.throwsAsync(
    makeClient(FOREIGN_PROGRAM_ADDRESS).raydiumLaunchpad.accounts.vestingRecord.fetchMaybe(SOME_ADDRESS),
  );
  t.is(error?.name, 'AccountOwnerMismatchError');

  // Positive control: an account owned by the program fetches through the plugin.
  const maybeAccount = await makeClient(RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS)
    .raydiumLaunchpad.accounts.vestingRecord.fetchMaybe(SOME_ADDRESS);
  t.true(maybeAccount.exists);
  if (maybeAccount.exists) t.is(maybeAccount.data.epoch, 42n);
});

test('decodeVestingRecord keeps returning non-existing accounts without throwing', (t) => {
  // The `{ address, exists: false }` variant carries neither a `programAddress` nor data, so both
  // the owner and discriminator checks must narrow on `exists` first and let it through.
  const decoded = decodeVestingRecord({ address: SOME_ADDRESS, exists: false });
  t.false(decoded.exists);
  t.is(decoded.address, SOME_ADDRESS);
});

test('parseBuyExactInInstruction throws on a sibling instruction of the same program', (t) => {
  // The program guard passes and the account-meta count passes; only the discriminator separates
  // buyExactIn from sellExactIn, which would otherwise parse into a well-typed wrong answer.
  const error = t.throws(() =>
    parseBuyExactInInstruction({
      accounts: accountMetas(15),
      data: sellExactInData(),
      programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
    }),
  );
  t.is(error?.name, 'InstructionDiscriminatorMismatchError');
  t.true(error?.message.includes('parseBuyExactInInstruction'));
  t.true(error?.message.includes('BuyExactIn'));
});

test('parseBuyExactInInstruction reports the discriminator mismatch before the account-meta count', (t) => {
  // Too few account metas *and* the wrong instruction: the mis-route is the real problem.
  const error = t.throws(() =>
    parseBuyExactInInstruction({
      accounts: accountMetas(0),
      data: sellExactInData(),
      programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
    }),
  );
  t.is(error?.name, 'InstructionDiscriminatorMismatchError');
});

test('parseBuyExactInInstruction reports short data as a mismatch rather than a range error', (t) => {
  // `containsBytes` compares against `data.slice(offset, offset + bytes.length)`, which clamps, so
  // data shorter than the discriminator is unequal rather than out of range.
  for (const data of [new Uint8Array([]), new Uint8Array([250, 234])]) {
    const error = t.throws(() =>
      parseBuyExactInInstruction({
        accounts: accountMetas(15),
        data,
        programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
      }),
    );
    t.is(error?.name, 'InstructionDiscriminatorMismatchError');
  }
});

test('parseRaydiumLaunchpadInstruction still dispatches siblings to their own parser', (t) => {
  // The aggregate identifies before dispatching, so the per-instruction guard is redundant here —
  // it must not turn a correct dispatch into a throw.
  const parsed = parseRaydiumLaunchpadInstruction({
    accounts: accountMetas(15),
    data: sellExactInData(),
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
  });
  t.is(parsed?.instructionType, 'sellExactIn');

  // Data matching no known instruction stays a null, not a throw.
  t.is(
    parseRaydiumLaunchpadInstruction({
      accounts: accountMetas(15),
      data: new Uint8Array(24),
      programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
    }),
    null,
  );
});

test('decodeVestingRecord throws on a sibling account of the same program', (t) => {
  // The owner guard passes — a PoolState is owned by the same program — and kit's fixed-size
  // decoders tolerate trailing bytes, so without this check the decode returns garbage.
  const poolStateAccount = {
    address: SOME_ADDRESS,
    data: new Uint8Array([...POOL_STATE_DISCRIMINATOR, ...new Uint8Array(200)]),
    executable: false,
    lamports: lamports(1_000_000n),
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
    space: 208n,
  };

  const error = t.throws(() => decodeVestingRecord(poolStateAccount));
  t.is(error?.name, 'AccountDiscriminatorMismatchError');
  t.true(error?.message.includes('decodeVestingRecord'));
  t.true(error?.message.includes('VestingRecord'));
  t.true(error?.message.includes(SOME_ADDRESS));
});

test('decodeVestingRecord reports short data as a mismatch rather than a range error', (t) => {
  for (const data of [new Uint8Array([]), new Uint8Array([106, 243])]) {
    const error = t.throws(() =>
      decodeVestingRecord({
        address: SOME_ADDRESS,
        data,
        executable: false,
        lamports: lamports(1_000_000n),
        programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
        space: BigInt(data.length),
      }),
    );
    t.is(error?.name, 'AccountDiscriminatorMismatchError');
  }
});

test('the plugin self-fetch goes through the discriminator guard', async (t) => {
  // The plugin delegates to the generated fetch helpers, so it inherits this check for free.
  const rpcAccount = (data: ReadonlyUint8Array) => ({
    context: { slot: 0n },
    value: {
      data: [getBase64Decoder().decode(data), 'base64'],
      executable: false,
      lamports: 1_000_000n,
      owner: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
      rentEpoch: 0n,
      space: 112n,
    },
  });
  const makeClient = (data: ReadonlyUint8Array) => {
    const rpc = { getAccountInfo: () => ({ send: () => Promise.resolve(rpcAccount(data)) }) };
    return raydiumLaunchpadProgram()({ rpc } as unknown as RaydiumLaunchpadPluginRequirements);
  };

  const poolStateData = new Uint8Array([...POOL_STATE_DISCRIMINATOR, ...new Uint8Array(200)]);
  const error = await t.throwsAsync(
    makeClient(poolStateData).raydiumLaunchpad.accounts.vestingRecord.fetchMaybe(SOME_ADDRESS),
  );
  t.is(error?.name, 'AccountDiscriminatorMismatchError');

  // Positive control: the right account still fetches through the plugin.
  const maybeAccount = await makeClient(vestingRecordData())
    .raydiumLaunchpad.accounts.vestingRecord.fetchMaybe(SOME_ADDRESS);
  t.true(maybeAccount.exists);
});

test('identifyRaydiumLaunchpadAccount rejects an account owned by another program', (t) => {
  const encodedAccount = {
    address: SOME_ADDRESS,
    data: vestingRecordData(),
    executable: false,
    lamports: lamports(1_000_000n),
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
    space: 112n,
  };

  t.is(identifyRaydiumLaunchpadAccount(encodedAccount), 'vestingRecord');
  t.is(
    identifyRaydiumLaunchpadAccount({ ...encodedAccount, programAddress: FOREIGN_PROGRAM_ADDRESS }),
    null,
  );

  // Bytes-only callers opt out of the check explicitly, so the discriminator still matches.
  t.is(identifyRaydiumLaunchpadAccount(vestingRecordData()), 'vestingRecord');
});

test('identifyRaydiumLaunchpadInstruction rejects an instruction of another program', (t) => {
  const instruction = {
    accounts: accountMetas(15),
    data: buyExactInData(),
    programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS,
  };

  t.is(identifyRaydiumLaunchpadInstruction(instruction), 'buyExactIn');
  t.is(
    identifyRaydiumLaunchpadInstruction({ ...instruction, programAddress: FOREIGN_PROGRAM_ADDRESS }),
    null,
  );
  t.is(identifyRaydiumLaunchpadInstruction(buyExactInData()), 'buyExactIn');
});

function claimVestedEventData(claimAmount: bigint): ReadonlyUint8Array {
  return new Uint8Array([
    ...ANCHOR_EVENT_CPI_DISCRIMINATOR,
    ...CLAIM_VESTED_EVENT_DISCRIMINATOR,
    ...getAddressEncoder().encode(SOME_ADDRESS),
    ...getAddressEncoder().encode(SOME_ADDRESS),
    ...getU64Encoder().encode(claimAmount),
  ]);
}

test('parseClaimVestedEvent returns null for an event emitted by another program', (t) => {
  const data = claimVestedEventData(123n);

  // Callers scan whole transactions, where another program's event is ordinary rather than erroneous.
  t.is(parseClaimVestedEvent({ data, programAddress: FOREIGN_PROGRAM_ADDRESS }), null);
  t.false(isClaimVestedEvent({ data, programAddress: FOREIGN_PROGRAM_ADDRESS }));

  const parsed = parseClaimVestedEvent({ data, programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS });
  t.is(parsed?.claimAmount, 123n);
  t.true(isClaimVestedEvent({ data, programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS }));

  // Bytes-only callers opt out of the check explicitly.
  t.is(parseClaimVestedEvent(data)?.claimAmount, 123n);
  t.true(isClaimVestedEvent(data));
});

test('parseRaydiumLaunchpadEvent returns null for an event emitted by another program', (t) => {
  const data = claimVestedEventData(123n);

  t.is(identifyRaydiumLaunchpadEvent({ data, programAddress: FOREIGN_PROGRAM_ADDRESS }), null);
  t.is(parseRaydiumLaunchpadEvent({ data, programAddress: FOREIGN_PROGRAM_ADDRESS }), null);

  t.is(identifyRaydiumLaunchpadEvent({ data, programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS }), 'claimVestedEvent');
  const parsed = parseRaydiumLaunchpadEvent({ data, programAddress: RAYDIUM_LAUNCHPAD_PROGRAM_ADDRESS });
  t.is(parsed?.eventType, 'claimVestedEvent');
  if (parsed?.eventType === 'claimVestedEvent') t.is(parsed.data.claimAmount, 123n);

  // Bytes-only callers opt out of the check explicitly.
  t.is(identifyRaydiumLaunchpadEvent(data), 'claimVestedEvent');
  t.is(parseRaydiumLaunchpadEvent(data)?.eventType, 'claimVestedEvent');
});
