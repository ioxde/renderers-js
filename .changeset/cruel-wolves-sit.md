---
'@codama/renderers-js': minor
---

Add three new name-transformer keys — `programEventsParsedDataKey`, `programEventsParsedDiscriminatorKey`, and `programInstructionsParsedDiscriminatorKey` — so the object keys emitted by the aggregate event and instruction parse helpers can be customized via the `nameTransformers` option. The defaults (`data`, `eventType`, and `instructionType` respectively) are unchanged, so generated output is identical unless overridden.
