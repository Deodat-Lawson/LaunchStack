# @launchstack/evidence

Pure company-state logic for Launchstack: immutable evidence records,
citation anchors (`anchorKey`/`parseAnchorKey`), source-version
supersession, content diffing, conflict detection, reconciliation, and
freshness. Every function takes its clock/policy as a parameter — no IO,
no environment, no tenant/billing/auth concepts.

See `docs/architecture/ADR-005-evidence-model.md`.
