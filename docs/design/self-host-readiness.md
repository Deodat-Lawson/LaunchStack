# Technical Design

**Feature** Self-host readiness · **Author** Deodat-Lawson · **Date** 2026-08-29 ·
**Status** Draft · **Brief** _none — see §9_

> This doc is being written without an approved brief, which the template
> forbids. The justification is that the kill test was effectively run in
> production: a real deployment (§7) surfaced a class of defect that makes the
> "can someone else run this?" question answerable only by fixing it. If that
> reasoning is not accepted, §9 row 1 kills the doc.

---

## 1 Summary

Deploying LaunchStack outside the author's laptop currently fails in ways that
look like success. A production bring-up on Azure hit a defect where object
storage crash-looped for two days while every other service reported healthy,
because a hardcoded password in a mounted config file could not see the real
one in the environment. That is not a one-off bug; it is a category. This design
closes the category with four changes: a preflight command that validates a
deployment before it starts, a rule that config must never be hand-mirrored into
a sidecar, completion of the storage provider seam so object storage is a choice
rather than a fork, and deployment ergonomics (restart policies, a restore
drill) that let an instance survive unattended. The target reader is someone who
clones the repo and wants a running instance without reading the source.

**Ship target** Before the first external self-hoster, or before the first
paying user on the hosted instance — whichever comes first.

---

## 2 Context and constraints

**Builds on**

- `docker-compose.yml` — the deployment spec. Nine services; six run in the lean
  production shape (`docker-compose.prod.yml`).
- `apps/web/src/env.ts` — **190 declared environment variables**, validated with
  Zod at process start, bypassable with `SKIP_ENV_VALIDATION`.
- `packages/engine/src/config/types.ts` — `CoreConfig`, the composition root.
  Core never reads `process.env`; the app builds one config object and hands it
  down. This is the right shape and the design leans on it.
- `packages/runtime/src/storage-port/` — `StoragePort`, a four-method interface
  (`upload` / `download` / `delete` / `provider`) that core uses for document
  bytes.
- ADR-002 (layered engine packages), ADR-003 (outbox + worker), ADR-004 (compute
  service consolidation).

**Not changing**

- The deployment model. Container images to GHCR plus Compose stays; this is not
  a move to Kubernetes, Helm, or a PaaS.
- The ADR-003 split. The worker remains the sole durable coordinator, and
  nothing here tries to make the app self-sufficient.
- `CoreConfig` and the ports. The seams are correct; the work is in what fills
  them and what validates them.
- The 190-variable surface itself. Reducing it is a separate, larger piece of
  work. This design makes the existing surface *safe*, not smaller.

---

## 3 Architecture / Design

Four workstreams. W1 and W2 are the safety work; W3 and W4 are the
self-hostability work.

### W1 — Preflight validation (`pnpm deploy:check`)

Today `env.ts` validates types at process start, inside the container, per
process. That misses three whole classes of misconfiguration, all of which have
already occurred:

1. **Paired variables.** Base URL and API key are read as a pair at every level.
   Setting `EMBEDDING_API_KEY` without `EMBEDDING_API_BASE_URL` type-checks
   fine, then fails at call time with "API key not configured" — hours later,
   inside a background job.
2. **Cross-process agreement.** `FILE_ACCESS_TOKEN_SECRET`, the S3 credential
   triple, `NEXT_PUBLIC_S3_ENDPOINT`, and every `*_SERVICE_API_KEY` must be
   *identical* between app and worker. Each process validates its own copy and
   is satisfied. Nothing compares them.
3. **Defaults that are only safe locally.** `docker-compose.yml` ships
   `pdr_local_sidecar_key`, `pdr_local_adeu_key`, `pdr_local_converter_key`,
   `pdr_local_file_access_secret`, and `POSTGRES_PASSWORD=password` so `make up`
   works with no `.env`. Every one is a production compromise, and nothing stops
   them shipping.

`deploy:check` is a single command, run against a `.env` before the stack
starts, that exits non-zero with actionable messages:

| Check | Failure message names |
|---|---|
| Required set present | which variable, which feature dies without it |
| Pairs complete | the missing half, not the present one |
| Cross-process identity | which two services disagree |
| No `pdr_local_*` / `password` when `DOMAIN` is set | the specific defaults still in place |
| Secret entropy floor | the variable, and the length required |
| Reachability | DB, object store, and each compute service, probed with the configured credentials |

Reachability probing is what separates this from a linter — it catches the
SeaweedFS defect directly, because the filer's Postgres credential is exercised
rather than merely present.

### W2 — Config must never be hand-mirrored

The SeaweedFS defect in full: SeaweedFS stores filer metadata in Postgres.
`docker/filer.toml` is mounted read-only and contains a literal
`password = "password"`. In local development that matches
`POSTGRES_PASSWORD`'s default and everything works. Any deployment that sets a
real password gets `FATAL: password authentication failed`, SeaweedFS exits, and
— because that service carried no restart policy — stays dead. The app, worker,
database, and both document services remain healthy. The only visible symptom is
a 502 from the file origin, which nothing alerts on.

The fix already applied: `docker-compose.yml` now sets
`WEED_POSTGRES_PASSWORD` from `POSTGRES_PASSWORD`, because SeaweedFS overlays
any `filer.toml` key from `WEED_<SECTION>_<KEY>`. The filer authenticates with
the real value; the literal in the file is now only a local-default fallback.

The generalizable rule, and the actual design content:

> **A sidecar's configuration is either injected from the environment or
> generated at startup from the environment. It is never a static file that
> restates a value the environment also holds.**

The repo already has the good pattern —
`docker/seaweedfs-entrypoint.sh` generates `s3-config.json` from
`S3_ACCESS_KEY` / `S3_SECRET_KEY` at boot. `filer.toml` is the same file in the
same container that did not get the same treatment. Audit for the rest:
`docker/Caddyfile*`, `apps/web/config/chat-models.yaml`, and any future mounted
config.

Enforcement is a CI job, not a convention (see §7): boot the stack with
randomized non-default secrets and assert an end-to-end upload. That test fails
today against the pre-fix code, which is the only proof that it is testing
anything.

### W3 — Complete the storage provider seam

`StoragePort` is a clean four-method interface, and core is correctly unaware of
which backend fills it. But backend *selection* is hardcoded in
`apps/web/src/lib/storage.ts`: `resolveStorageBackend()` returns the union
`"s3" | "database"`, and `uploadFile()` branches to exactly two
implementations. Adding a backend means editing that union and that branch.

This is why "can we use Azure Blob Storage?" currently reads as a fork. It
should not:

- **Object storage** is the category — immutable blobs addressed by key over
  HTTP, no filesystem semantics.
- **The S3 API** is Amazon's interface to that category, and it became the de
  facto standard. SeaweedFS, MinIO, Cloudflare R2, Backblaze B2, and
  DigitalOcean Spaces all speak it. For all of these, switching backends is
  **configuration**: change `NEXT_PUBLIC_S3_ENDPOINT` and the credentials.
- **Azure Blob Storage** is the same category with a *different* API — containers
  rather than buckets, shared-key/SAS auth, its own SDK. For this one, switching
  is **code**.

The design: make backends registered rather than enumerated. A backend supplies
a name and a `StoragePort` implementation; `resolveStorageBackend()` picks from
the registry by `NEXT_PUBLIC_STORAGE_PROVIDER`, with the current S3/database
inference preserved as the default. An Azure Blob backend then becomes one file
implementing four methods, and the same is true for GCS or a future provider.

Scope note: `@vercel/blob` remains for reading legacy URLs only — `uploadFile()`
already cannot write to it. The registry makes that status explicit instead of
implied by a `deleteFileByUrl` comment.

### W4 — Deployment ergonomics

Smaller, but this is where a self-hoster actually gives up.

- **Restart policies on every service.** SeaweedFS had none; six of seven did.
  A single failed start left object storage down indefinitely. Fixed in the
  production overlay, but it belongs in the base file.
- **Health checks on every service.** The app currently has none, so
  `docker compose ps` reports it `Up` before it can serve.
- **A documented restore drill.** Backups that have never been restored are not
  backups. The runbook has the restore command; nothing has run it.
- **One documented bring-up path** with the overlay, rather than a Compose
  invocation reconstructed from three docs.

---

## 4 Impacts

**Graph changes** None. This design touches no node types, edges, or
properties.

**Provider interfaces touched** `StoragePort` — implementations added, the
interface unchanged. This sits on the **OSS side** of the boundary: a
self-hoster choosing MinIO or Azure Blob must not need anything proprietary.
`LLMProvider` and `AuthProvider` are untouched.

**Public surface**

- New: `pnpm deploy:check` (root script, runnable in CI and against a `.env`).
- New env var: `WEED_POSTGRES_PASSWORD` — set by Compose, not by operators.
- Extended: `NEXT_PUBLIC_STORAGE_PROVIDER` gains registry-supplied values
  (`azure-blob`, …) alongside `s3` / `database`.
- No API routes, no CLI commands, no SDK exports change.

**External services, and how they fail**

| Service | When it is down or misconfigured | Behaviour |
|---|---|---|
| Object store (SeaweedFS / S3 / Blob) | Wrong credential, unreachable endpoint | **Today:** silent crash-loop, 502 on file reads, uploads fail late. **After W1:** preflight refuses to start and names the credential. |
| Postgres | Unreachable or wrong password | App and worker fail fast and loudly; already acceptable. Preflight catches it before boot. |
| Document converter / adeu | Key mismatch | 401 on every call, fail-closed by design. Preflight compares the app's copy to the service's. |
| Chat / embedding provider | Missing base URL, or key without URL | Falls through to "API key not configured" at call time. Preflight catches the unpaired half. |
| Inngest Cloud | Absent | Background verticals off; **ingestion unaffected** (outbox). Warns at boot. Correct as-is. |

**Background jobs** Ingestion runs through the transactional outbox and the
worker; nothing in this design changes that path. The CI verification job (§7)
runs a full ingestion to completion, so it is bounded by real processing time —
budget several minutes, and it must fail rather than hang if the worker never
claims the event.

---

## 5 Alternatives considered

| Option | Why it was rejected | What would change our mind |
|---|---|---|
| **Ship Kubernetes manifests / a Helm chart** | Solves distribution, not correctness — the same mirrored-password bug reappears as a ConfigMap that restates a Secret. Adds an operational burden no current deployment needs. | A self-hoster who already runs Kubernetes and wants to adopt this; or multi-node scale-out becoming real. |
| **Move to managed services (Container Apps + Flexible Server + Blob)** | Does not make the project self-hostable — it makes *our* instance someone else's problem, and forecloses air-gapped deployment. Measured cost is ~2–3× current for the same functionality at present scale. | Traffic that justifies autoscaling, or a compliance requirement for managed data services. |
| **Documentation only — write the gotchas down** | The SeaweedFS defect *was* documented behaviour (the compose file says "override all of them in production") and still shipped broken. Docs do not fail a build. | Never on its own; docs ship alongside W1–W4 regardless. |
| **Do nothing** | The next person to deploy repeats the same two days of debugging, and the failure mode is silent rather than loud. Blocks external self-hosting entirely. | Deciding LaunchStack is a hosted-only product and self-hosting is not a goal — which contradicts the self-hosting defaults already built into `deployment.md`. |

---

## 6 Failure modes

The four standing rows, answered as the template requires. Three are not
applicable to this feature and one reframes cleanly — see §9 row 4.

| What breaks | Blast radius | How we detect it | Fallback |
|---|---|---|---|
| **Venue network blocks outbound calls** | Reframed: a self-hoster deploys behind an egress-restricted firewall. Chat, embeddings, and hosted OCR all fail; ingestion of text files still works. | Preflight reachability probes fail at deploy time rather than at first upload. | Self-hosting defaults already assume this is legitimate — no telemetry, no third-party asset fetches, pdf.js served locally. Document the egress allowlist; Ollama covers fully air-gapped chat. |
| **Event page or rules change format mid-event** | Not applicable — this feature parses no third-party page. | — | — |
| **Repo is private, enormous, or barely committed** | Partially applicable: the GHCR images are public today. If they are made private, every `docker compose pull` fails on a fresh host. | Preflight pulls before it validates. | Document the registry-credential path; the images are reproducible from source in-tree. |
| **Upload fails, or the video lands private** | Reframed and **live**: uploads fail, or objects land unreadable, when the object store is misconfigured. This is exactly the SeaweedFS defect. | W1 reachability probe; W2's CI boot test; a health check on SeaweedFS. | Fall back to the `database` storage backend, which needs no external service — already implemented, currently undocumented as a fallback. |
| **A default secret reaches production** | Total: forgeable file-access tokens, a compute service anyone can call, a guessable database password. | Preflight refuses to start when `DOMAIN` is set and any `pdr_local_*` or `password` default remains. | None — this must be prevented, not recovered from. |
| **App and worker drift on a shared secret** | Ingestion silently fails or file URLs 401; both processes report healthy. | Preflight compares the two environments. | None today; the mismatch is invisible at runtime. |
| **Migrations applied to the wrong database** | Severe if the app and worker point at different `DATABASE_URL`s — the outbox is written to one and polled from the other. | Preflight asserts a single resolved `DATABASE_URL` across processes. | Migrations are ordered and idempotent; re-running against the correct database is safe. |
| **Backup has never been restored** | Discovered only during an incident. | A quarterly restore drill into a scratch database. | None — an unrestored backup is a hypothesis. |

**The worst thing this can do to a team** — A self-hoster runs for weeks on
default secrets, believing the stack is healthy because every container reports
healthy, and their documents are readable by anyone who finds the file origin.
They find out from someone else.

---

## 7 Verification

**Automated**

- A CI job that boots the full Compose stack with **randomized, non-default**
  secrets and asserts an end-to-end upload → outbox → worker → evidence →
  retrieval. This is the regression test for the entire W2 category; it fails
  against the pre-fix `filer.toml` and passes after, which is what makes it
  meaningful rather than decorative.
- `deploy:check` unit tests over crafted `.env` fixtures: unpaired provider
  variables, drifted cross-process secrets, surviving defaults, weak secrets.
- `deploy:check --ci` runs in the same job, so the checker and the stack it
  describes cannot diverge.

**End-to-end dry run** Already performed against the live Azure instance
(`launchstack-vm`, eastus2): schema applied and `vector` extension confirmed;
worker `/healthz` green; an object written through the app's real S3 credentials
and read back over public HTTPS with a valid certificate. That run is what
surfaced the SeaweedFS defect, and it is the shape the CI job automates.

**The check that catches the worst failure in §6** Preflight's default-secret
refusal, which is non-overridable when `DOMAIN` is set, plus the randomized-secret
CI boot. The pairing matters: the first stops a human shipping defaults, the
second stops us shipping a stack that only works *with* them.

**Instrumentation**

- Log the resolved storage provider, chat/embedding provider names, and metering
  mode once at boot — enough to reconstruct a deployment's shape from its logs
  without asking for the `.env`.
- Emit a structured event when a compute service returns 401, distinguishing key
  mismatch from service-down.
- Count outbox events claimed vs. completed per interval; a claimed-not-completed
  gap is the signature of a half-configured deployment.

---

## 8 Team assignment (after approval)

| Workstream | Owner | Notes |
|---|---|---|
| W1 Preflight (`deploy:check`) | _unassigned_ | Largest piece; start here — W2's CI job depends on the checker |
| W2 No hand-mirrored config | _unassigned_ | Fix landed; audit + CI job outstanding |
| W3 Storage registry | _unassigned_ | Blocked on the §9 Azure Blob decision |
| W4 Deploy ergonomics | _unassigned_ | Small, independent, parallelizable |

---

## 9 Open questions

| Question | Who decides | By when |
|---|---|---|
| This doc has no approved brief. Does the production defect count as the kill test, or is a brief required first? | Repository maintainers | Before any W1 work starts |
| Where does production Postgres live — self-hosted container, Azure Flexible Server, or a third party (Neon / Supabase / Crunchy)? All support `pgvector`; the design is indifferent, but §7's CI job needs one target. | Deodat-Lawson | Before W1 lands |
| Is an Azure Blob `StoragePort` implementation in scope now, or does W3 ship as a registry with the two existing backends? | Deodat-Lawson | Before W3 starts |
| The template's four standing failure modes (venue network, event page format, repo size, video upload) appear to belong to a different product surface. Should they be revised for the document-platform context, or kept as-is? | Repository maintainers | Next template revision |
| Should `SKIP_ENV_VALIDATION` be refused outright when `DOMAIN` is set, or remain an escape hatch? | Repository maintainers | With W1 |
