---
'@codama/renderers-js': minor
---

Build against the latest Codama core, which types every node array attribute as optional and omits empty arrays when constructing nodes. All readers of formerly-required arrays now normalise an absent array to `[]`, so generated output is unchanged for IDLs that still serialise empty arrays. Codama core additionally introduces `accountFieldValueNode`, a contextual value that can only be resolved at display time by fetching the referenced account; generated builders therefore treat it the same way they treat identity and payer values, leaving the corresponding input required rather than promising a default no builder can apply. The minimum supported `@codama/errors`, `@codama/nodes`, `@codama/renderers-core`, and `@codama/visitors-core` ranges move up accordingly.
