---
'@codama/renderers-js': minor
---

Guard the generated event helpers against events emitted by another program, finishing the program scoping already applied to accounts and instructions. Anchor derives event discriminators from names alone, so byte-identical discriminators recur across programs — an event named `TradeEvent` is `bddb7fd34ee661ee` in every program that declares one — and a CPI-framed foreign event previously parsed into a well-typed wrong answer whenever its body was layout-compatible. `is<Event>`, `parse<Event>`, `identify<Program>Event` and `parse<Program>Event` now check the emitting program before comparing framing and discriminator bytes.

Every helper now takes `{ data, programAddress }` or the raw bytes, mirroring the `identify<Program>Account`/`identify<Program>Instruction` argument shape. `programAddress` is required on the object arm so the check cannot be skipped by call shape. Framing and discriminator conditions are unchanged and every decode offset is byte-identical to before. `is<Event>` returns `false` on a foreign program and the three parse and identify helpers return `null`; none throws, because callers scan whole transactions and CPI logs, where another program's event is ordinary rather than erroneous.

The union is source-compatible, so this renderer fails OPEN: every bare-bytes call site keeps compiling and keeps its old unguarded behaviour, since bytes carry no emitter to check. Upgrading does not retrofit the guard — call sites that hold the emitting program must pass the object arm to gain the protection. Note the asymmetry with `@codama/renderers-rust`, whose event helpers take the program address as a mandatory parameter and therefore fail CLOSED. Do not assume parity between the two renderers here.
