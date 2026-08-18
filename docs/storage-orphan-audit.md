# Storage orphan audit

The orphan audit is read-only by default. It inventories one adapter/location with `listObjectsPrivileged`, scrapes relational references from manifest, document/version, OCR, batch, and legacy upload rows, and emits counts and estimated bytes by classification.

```powershell
pnpm --dir apps/web exec tsx scripts/audit-storage-orphans.ts --adapter s3
pnpm --dir apps/web exec tsx scripts/audit-storage-orphans.ts --adapter database --backfill
```

Use `--storage-location-id` when more than one configured location exists and `--prefix` to limit an object-store scan. A provider listing failure is reported as `unknown`; the audit never turns an unavailable listing into confirmed orphans.

`--backfill` registers only explicit, high-confidence `ObjectRef` evidence that has a tenant and document/version owner and is not already manifested. It does not delete objects, quarantine objects, or backfill URL-only evidence. Confirmed-orphan cleanup requires a separately approved grace-period configuration and operational run.

If provider listing is unavailable, results are reported as `unknown` instead of
`confirmed_orphan`. This is intentional: listing failure must never be treated
as safe-to-delete evidence.

Rollout sequencing is documented in
[storage-deletion-rollout.md](./storage-deletion-rollout.md).
