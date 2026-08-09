# @launchstack/adapters

Implementations of the Launchstack application ports: the Postgres
transactional outbox store, the outbox-transactional source lifecycle,
ZIP archive expansion, the two-stage document-ingestion pipeline
(extract/index), and typed HTTP clients for the compute services.
Configuration is injected by the composition roots — nothing here reads
`process.env`.

See `docs/architecture/ADR-002-layered-engine-packages.md`.
