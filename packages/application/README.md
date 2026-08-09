# @launchstack/application

Launchstack use cases and the ports they depend on: command acceptance for
source uploads, the outbox processing tick with bounded retries
(ADR-003), the pipeline event dispatch table, and citation building for
the query path. Implementations of the ports live in
`@launchstack/adapters`; composition happens in `apps/web` and
`apps/worker`.

See `docs/architecture/ADR-002-layered-engine-packages.md` and
`ADR-003-transactional-outbox-and-worker.md`.
