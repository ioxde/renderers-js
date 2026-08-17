---
'@codama/renderers-js': patch
---

Pin the on-curve check used to derive PDAs at generation time, rather than inheriting it from a library default. `computePda.ts` rejects a candidate address that lies on the ed25519 curve, and must agree with Solana's runtime, which decompresses candidates with `curve25519_dalek`'s `CompressedEdwardsY::decompress()` and accepts y-coordinate encodings that are not fully reduced mod p. `@noble/curves` calls that leniency `zip215` and its ed25519 wrapper currently defaults it on, so the behaviour was already correct — but it was correct by inheritance, and a future release that flipped the default would silently make the renderer fold a bump the runtime rejects. The flag is now passed explicitly and covered by a test that fails if the semantics ever stop matching dalek. No generated address changes.
