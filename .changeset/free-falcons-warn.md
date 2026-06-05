---
'@codama/renderers-js': minor
---

Make extra arguments that are only read by async-only account default values (e.g. PDA seeds) optional in the sync instruction input type. The sync builder skips those defaults entirely, so the argument was never read on any sync code path and requiring it forced callers to pass a value that was always ignored. Async input types keep these arguments required so that deriving the account from them remains compile-time checked. Arguments referenced by remaining accounts, byte deltas, argument defaults, or sync-rendered account defaults stay required everywhere.
