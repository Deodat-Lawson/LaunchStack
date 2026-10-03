---
"@launchstack/store": patch
---

`db:verify` is read-only again. Since the feature reorganization it ran the
migration runner with `--verify`, a flag the runner never recognized, so it fell
through to apply mode: "verifying" an outdated database applied every pending
engine migration and exited 0. CI's "Assert no migrations pending" steps could
therefore never fail on the engine set. It now passes `--check`, which lists
pending migrations and exits non-zero without applying them.
