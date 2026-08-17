---
'@codama/renderers-js': major
---

Stop pinning the instruction type of an IDL-optional account to the address its default resolves to. The `TAccountX` parameter of a generated instruction type defaults to the address a builder assigns when the caller passes nothing, which is how a consumer writing `MyInstruction<typeof MY_PROGRAM_ADDRESS>` learns what an unparameterised instruction looks like. For an IDL-optional account no builder assigns anything: omitting it leaves the account unset and `getAccountMeta` then substitutes the program address under the `programId` strategy or drops the meta from the list entirely under `omitted`. Neither of those is the pinned public key, the linked program or the folded PDA constant the default names, so the type claimed an address that never reaches the wire. Such a parameter now defaults to `string` under `programId` and stays `undefined` under `omitted`, exactly as an optional account carrying no default already did.

The exceptions the optional-account rule already draws come with it, in the other direction. An optional account another input derives from, and every optional account in an instruction containing a resolver, do still receive their default from the builder — so their address really is what the meta carries when the field is left out, and the instruction type keeps naming it. Under the `omitted` strategy that is a correction too: those accounts are filled in on every call and can never drop out of the account list, yet their type parameter defaulted to `undefined`, which told the account tuple to leave the slot out. They now default to the literal address.

Nothing about the account metas changes. This is a change to the generated types alone, and the rendered builders, their `accounts` objects, their return expressions and the parse helpers are byte-for-byte what they were; an instruction that was correct on the wire stays correct on the wire.

The rule lives in `getInstructionAccountAddressOnOmission`, alongside the fixed-account rule that now defines its first condition in terms of it, so a builder cannot drop an input for an address the instruction type declines to name.

This is breaking for consumers who wrote one of these instruction types with fewer type arguments than it has accounts and relied on the pinned literal — for instance to narrow an account meta's `address` to a string literal. Such code was reading a claim the builder did not honour; it must now supply the type argument, or accept `Address<string>`.
