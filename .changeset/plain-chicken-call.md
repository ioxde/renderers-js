---
'@codama/renderers-js': patch
---

Memoize generated event decoders and distinguish the CPI framing error. Generated `get*Decoder` functions on event pages now lazily cache the decoder in a module-level variable so hot paths like event streaming reuse one instance instead of rebuilding the decoder graph on every `decode*`/`parse*` call, while staying tree-shakable. The framing check in generated `decode*` event helpers now throws 'Invalid event CPI framing for X' instead of reusing the event discriminator message, so framing failures are distinguishable from discriminator mismatches.
