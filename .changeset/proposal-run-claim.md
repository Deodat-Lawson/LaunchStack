---
"@launchstack/pipelines": patch
---

Atomically claim proposal runs so concurrent deliveries do not repeat model work or credit debits. Lazily fail running jobs after 15 minutes from their start, preserve terminal states against late executors, and allow a fresh run without expiring queued work.

Timeout updates also terminalize the run sheet atomically: running steps become failed with timeout details and completion timestamps, waiting steps are skipped, and completed step metadata and ordering remain unchanged.

Pass the finalization executor as the required second argument to `ProposalPorts.debitCredits`. The app meter now uses it for every credit query, including account provisioning, grants, ledger entries, and daily usage, so production metering and run completion commit or roll back together without acquiring another pool connection. Genuinely external credit sinks remain outside Postgres rollback guarantees.
