---
'@codama/renderers-js': patch
---

Fix uncompilable builders for instructions whose byte deltas are the only reader of an argument. The dependency walk that decides which arguments a builder must accept visited an instruction's accounts, arguments and extra arguments but never its byte deltas, so an extra argument read only by an `instructionByteDeltaNode` was classified as unused. When that argument's sole default was an async-only resolver, the sync builder was rendered with no `input` parameter and no `const args = { ...input }` declaration, yet the byte-delta fragment still emitted `Number(args.space)` — leaving generated clients that referenced an undeclared `args` and failed to typecheck. Byte-delta values now flow through the same recursive walk as every other input value, so the arguments and accounts they read count as dependencies and the builder keeps the input it needs.
