# Storage deletion rollout

Deletion lifecycle rollout is staged so an inventory or worker problem cannot
silently become a data-loss event.

1. **Shadow inventory** — run the orphan audit for each configured adapter and
   location. Treat an unavailable provider listing as unknown.
2. **Dual-write** — require new successful writes to return an `ObjectRef` and
   register a manifest row before the document/version becomes active.
3. **Dry-run deletes** — inspect request plans and status responses without
   enabling provider cleanup for a new cohort.
4. **Manifest-backed cohort** — enable `STORAGE_DELETION_LIFECYCLE_ENABLED`
   for the selected cohort and confirm the UI waits for terminal status.
5. **Worker cleanup** — enable
   `STORAGE_DELETION_WORKER_ENABLED`, then watch
   `/api/storage/deletion-metrics` for backlog, retries, blocked items, and
   SQL-purge completion.
6. **Orphan cleanup** — only after an approved grace period and an explicit
   operator run. The audit's default mode never deletes confirmed orphans.

Rollback turns off the worker flag first, then the lifecycle flag. Turning off
the worker leaves the durable outbox intact for later retry; turning off the
lifecycle gate prevents new requests. `deleteFileByUrl` remains only as a
deprecated historical-row shim. Live lifecycle writers use `ObjectRef` and
`deleteFileByRef`; URL promotion is limited to unmanifested legacy rows.
