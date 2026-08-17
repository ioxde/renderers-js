---
'@codama/renderers-js': patch
---

Stop the generation-time PDA search one bump short, where Solana's stops. `find_program_address` counts down from 255 and its loop runs 255 times, so it tries 255 through 1 and never returns bump 0; this renderer counted down to 0 and would have folded an address at a bump the runtime cannot produce, leaving the generated client with a constant no caller can re-derive. Reaching that bump means 255 consecutive candidates landing on the curve, so no generated address changes and nothing about this is observable — it is the contract being stated exactly rather than nearly, and it brings the search into line with `@codama/renderers-rust`, which already stops at 1.
