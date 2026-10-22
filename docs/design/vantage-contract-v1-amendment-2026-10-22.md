# Vantage Contract v1 — Week 2 integrity amendment

Date: 2026-10-22. Baseline: `0432b4b440456ee50f1e715bb13d6ae4d72b2ce7`.

This implementation amendment covers the Tech Lead's Week 2 reconstruction.
The separately proposed context V0 interfaces do not enter the production v1
generation port. The earlier personal-machine commits `a0ebec1a`, `80186fc2`,
and `53eda9b0` were unavailable to this checkout. This reconstruction must be
verified independently; their reported test results are not acceptance evidence
for these changes.

## Topic concurrency

Every `PATCH /api/vantage/topics/:id` supplies a positive integer
`expectedContentVersion`, including status-only changes. Missing or invalid
versions return 400. Persistence compares the expected version with the current
version inside the write transaction. A mismatch returns 409 `stale_topic`
without changing the topic. A successful response remains `{topic}` and includes
the incremented `contentVersion`.

Clients retain unsaved human text after conflict, offer an explicit reload, and
require a deliberate reapplication against the latest version. They must not
automatically resend stale content with a newly fetched version. This is a
coordinated client/server amendment: old clients without the version field are
rejected rather than silently retaining last-write-wins behavior.

## Exact citation reads

Authenticated, authorized v1 operators can read an existing source in their
workspace through `GET /api/vantage/evidence/:id` (`{evidence}`) and
`GET /api/vantage/metrics/observations/:id` (`{observation}`). Existing commitment
detail reads remain canonical. These reads are independent of the 200 Evidence
and 500 Observation collection limits. Missing and other-company records return
404 without disclosing their contents or existence.

An authorized private Evidence record is viewable without an external URL.
Private-only v1 exposes no program-share action, and the development simulator
must reject unsupported sharing just as the server does. These v1 operator and
company checks are not a substitute for the future document-level and
derived-audience policy described in the V0 proposal.

## Save acknowledgement and source changes

A successful mutation is acknowledged separately from any later refresh.
Clients reconcile the returned saved DTO, or disable stale write actions until
fresh state is available. A failed refresh must not make the UI imply that the
write failed or invite an unsafe duplicate submission.

Generation validates the report state and the prepared source content again
before persistence. A changed input cannot silently commit a stale result.
Generation failures and conflicts preserve the previously saved report. No
database transaction is held open across a model call.

## Numeric observations

The v1 numeric contract remains a finite signed number. Negative values and
fractions are valid for suitable metric domains; display names and free-text
units do not establish a count domain. The old negative-Signups probe must be
reconciled with this explicit baseline, not treated as proof of a settled count
policy. The API, CSV import, client validation and tests must agree.

A future typed metric constraint such as `valueKind`, `minimum` and `integer`
requires a reviewed additive contract, migration/backfill policy, and matching
CSV behavior. It remains deferred in this reconstruction.

## Weekly workflow compatibility

The visible navigation is Weekly Review, Weekly Actions, Evidence, Metrics.
Existing agenda/commitment routes and week/deep-link parameters remain valid.
The stored entity is still Commitment. Previous-week context is deterministic,
permission-scoped and linked to its original records; missing or incomparable
data does not create an inferred metric movement.

The existing `POST /topics/:id/decide` and stable `Idempotency-Key` remain the
single atomic path for saving a decision with an optional primary commitment.
`commitment:null` saves a decision without creating an action. Existing linked
actions are edited through their existing update path, not duplicated.

## Verification and release boundary

Use the reconstruction's dedicated test resources and synthetic accounts. Do
not use the original demo database or application `.env`. Record unit/component,
real PostgreSQL, real authenticated HTTP/browser, and live-model results
separately in the Week 2 runbook. Fixture simulations are not real auth or
provider acceptance. Main, deployment, external connectors, shared audiences,
scheduled generation, and live model/research calls remain outside this work.
