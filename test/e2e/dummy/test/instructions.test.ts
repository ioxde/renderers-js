import test from 'ava';
import {
  AccountRole,
  address,
  createNoopSigner,
  type AccountMeta,
} from '@solana/kit';
import {
  DUMMY_PROGRAM_ADDRESS,
  dummyProgram,
  GLOBAL_CONFIG_PDA_ADDRESS,
  findDerivedFromSourcePda,
  getInstruction1Instruction,
  getInstruction10Instruction,
  getInstruction11Instruction,
  getInstruction12Instruction,
  getInstruction13InstructionAsync,
  getInstruction14InstructionAsync,
  getInstruction3Instruction,
  getInstruction7Instruction,
  identifyDummyInstruction,
  parseDummyInstruction,
  type DummyPluginRequirements,
  type Instruction11Instruction,
} from '../src/index.js';

const PINNED_ADDRESS = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

test('it can create instruction 1', (t) => {
  // When we create a dummy instruction.
  const instruction = getInstruction1Instruction();

  // Then we expect the instruction to have the correct program address.
  t.is(instruction.programAddress, DUMMY_PROGRAM_ADDRESS);
});

test('identifyDummyInstruction recognizes a real instruction built by the generator', (t) => {
  // Given two instructions built by the generated builders.
  const ix3 = getInstruction3Instruction();
  const ix10 = getInstruction10Instruction();

  // Then identifying the encoded data round-trips back to the right variant.
  t.is(identifyDummyInstruction(ix3), 'instruction3');
  t.is(identifyDummyInstruction(ix10), 'instruction10');
});

test('parseDummyInstruction returns the matching parsed variant', (t) => {
  // Given an instruction built by the generator.
  const ix3 = getInstruction3Instruction();

  // When we parse it.
  const parsed = parseDummyInstruction(ix3);

  // Then we get the parsed variant tagged with the right kind, not null.
  t.assert(parsed !== null);
  t.is(parsed?.instructionType, 'instruction3');
  t.is(parsed?.programAddress, DUMMY_PROGRAM_ADDRESS);
});

test('the dummy program plugin re-exposes identifyInstruction and parseInstruction', (t) => {
  // Given the plugin applied to a stub client. The new identify/parse fields
  // are bare references that don't read from the client, so a stub is fine.
  const client = dummyProgram()({} as DummyPluginRequirements);

  // And an instruction built by the generated builder.
  const instruction = getInstruction3Instruction();

  // Then the plugin's identify/parse helpers behave identically to the
  // standalone helpers when given the same generator-built instruction.
  t.is(
    client.dummy.identifyInstruction(instruction),
    identifyDummyInstruction(instruction)
  );
  t.deepEqual(
    client.dummy.parseInstruction(instruction),
    parseDummyInstruction(instruction)
  );
});

test('omitting an optional account with a resolvable default yields the program id, not that default', (t) => {
  // Given instruction 11, whose three optional accounts each have a resolvable default.
  const payer = createNoopSigner(address('11111111111111111111111111111112'));

  // When we build it without supplying any of them.
  const instruction = getInstruction11Instruction({ payer });

  // Then each meta is the program-id sentinel under `programId`, not the resolved default.
  t.is(instruction.accounts.length, 4);
  t.deepEqual(instruction.accounts.slice(1), [
    { address: DUMMY_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: DUMMY_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: DUMMY_PROGRAM_ADDRESS, role: AccountRole.READONLY },
  ]);
  t.false(instruction.accounts.some((meta) => meta.address === PINNED_ADDRESS));
  t.false(
    instruction.accounts.some((meta) => meta.address === GLOBAL_CONFIG_PDA_ADDRESS)
  );

  // And the bare instruction type describes it; the assignment is the compile-time check.
  const asWrittenBare: Instruction11Instruction = instruction;
  t.is(asWrittenBare.programAddress, DUMMY_PROGRAM_ADDRESS);
});

test('an optional account with a resolvable default still takes the address the caller passes', (t) => {
  // Given the same instruction with the accounts passed explicitly — the supported
  // way to get the derived address.
  const payer = createNoopSigner(address('11111111111111111111111111111112'));

  // When we build it.
  const instruction = getInstruction11Instruction({
    payer,
    pinnedOptional: PINNED_ADDRESS,
    derivedOptional: GLOBAL_CONFIG_PDA_ADDRESS,
  });

  // Then the metas carry what we passed.
  t.is(instruction.accounts[1]?.address, PINNED_ADDRESS);
  t.is(instruction.accounts[2]?.address, GLOBAL_CONFIG_PDA_ADDRESS);
  t.is(instruction.accounts[3]?.address, DUMMY_PROGRAM_ADDRESS);
});

test('omitting an optional account under the omitted strategy drops its meta entirely', (t) => {
  // Given instruction 12, the same accounts under the other strategy.
  const payer = createNoopSigner(address('11111111111111111111111111111112'));

  // When we build it without supplying any of the optional accounts.
  const instruction = getInstruction12Instruction({ payer });

  // Then they leave the account list altogether. The widened view is on purpose:
  // `TAccountX` has no `undefined` arm, so an omitted account infers as `string`
  // and the returned tuple keeps a slot the metas do not. Known gap; keep the cast.
  const metas = instruction.accounts as readonly AccountMeta[];
  t.is(metas.length, 1);
  t.is(metas[0]?.address, payer.address);
});

test('an optional account another PDA derives from keeps its default under both strategies', async (t) => {
  // Given instructions 13/14, where `derived` seeds its PDA from `optionalSource`
  // and the reader would throw on a null — the one case where an optional
  // account's default still applies.
  const authority = createNoopSigner(address('11111111111111111111111111111112'));
  const [derived] = await findDerivedFromSourcePda({ source: PINNED_ADDRESS });

  // When we build them without supplying the optional account.
  const withProgramId = await getInstruction13InstructionAsync({ authority });
  const withOmitted = await getInstruction14InstructionAsync({ authority });

  // Then both carry the pinned address, and the derivation that reads it resolves.
  t.is(withProgramId.accounts.length, 3);
  t.is(withProgramId.accounts[1]?.address, PINNED_ADDRESS);
  t.is(withProgramId.accounts[2]?.address, derived);
  t.deepEqual([...withOmitted.accounts], [...withProgramId.accounts]);
});

test('the program-id sentinel is readonly even for a writable optional account', (t) => {
  // Given instruction 7, whose single optional account is WRITABLE in the IDL,
  // under `programId`. The substituted meta stays readonly regardless: Anchor
  // 0.29 convention, and a program account cannot be writable anyway.
  const instruction = getInstruction7Instruction({});

  // Then the role is READONLY, not WRITABLE.
  t.is(instruction.accounts.length, 1);
  t.is(instruction.accounts[0]?.address, DUMMY_PROGRAM_ADDRESS);
  t.is((instruction.accounts[0] as AccountMeta).role, AccountRole.READONLY);
  t.not((instruction.accounts[0] as AccountMeta).role, AccountRole.WRITABLE);

  // The generated type says `WritableAccount` for this slot: a builder generic
  // cannot express "the caller omitted this one". The metas above are what ships
  // and what is correct. Do not "fix" this by making the sentinel writable.
});
