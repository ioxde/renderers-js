---
'@codama/renderers-js': minor
---

Fix argument optionality in sync instruction input types. Arguments whose default is async-only (a PDA derivation or async resolver) are now required in the sync input type — the sync builder skips those defaults, so omitting the argument type-checked but crashed at runtime. Extra arguments only read by skipped defaults on the sync path are now optional instead. Arguments with identity or payer defaults, which neither builder resolves, are likewise required now.
