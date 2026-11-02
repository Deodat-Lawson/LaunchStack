# Accelerators — discovery and matching handoff

## Current delivery scope

Help a startup find accelerator **Programs**, understand how they fit its **Core profile**, and reach the official website or application portal.

This branch keeps the latest Program list/detail layout, sourced logos and locations, saved fit scores, and Program detail preview. It removes the LaunchStack Form-filling workflow: Form navigation, Application creation, answer editing, autosave, submission tracking, AI drafting, and selected-text suggestions. These are not hidden behind a beta switch; their active UI, API, and execution paths are removed.

Kien will investigate application assistance separately, including a possible browser extension. That research does not block this delivery. Do not reintroduce the removed workflow as a dependency of Program discovery.

This scope replaces the Form-related assignments in [issue #510](https://github.com/Deodat-Lawson/LaunchStack/issues/510), [issue #559](https://github.com/Deodat-Lawson/LaunchStack/issues/559), [the earlier technical design](technical-design.md), and [its review](technical-design-review.md). Those documents describe historical scope, not additional requirements for this branch.

## Terms

| Term            | Meaning                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Program         | An accelerator that a startup can apply to. The Catalogue does not list other startup companies.                   |
| Cycle           | A particular batch or rolling intake of a Program.                                                                 |
| Catalogue       | The reviewed collection of public Program records.                                                                 |
| Program profile | Sourced descriptions of the Program and its target applicants, including identified AI interpretations.            |
| Core profile    | The existing company profile and its supporting evidence, not a new profile store.                                 |
| Fit result      | A company-specific comparison of a Program profile with the Core profile. A score is not an admission probability. |

## What this branch must do

- Show compact, fully clickable Program rows with official logos, sourced locations when available, and saved fit rings.
- Open a Program detail preview with its description, target applicants, fit reasons, concerns, unknowns, available Cycle/deadline information, and official website/application links.
- Read saved fit results without starting paid work. Matching starts only when the user selects **Match Programs**.
- Mark affected results out of date when the Core profile or Program record changes. Do not present an unknown score as zero.
- Keep the public Catalogue separate from company-private fit results.
- Require active membership, unrestricted access to all company documents, and the existing read/edit permission for the requested action. Enforce this on direct APIs and background work as well as the UI.
- Recheck access before committing matching output. Save output, complete the run, and debit credits atomically; a failed final check publishes no output or debit.
- Keep historical Accelerator Applications and runs out of Grants screens, APIs, counts, and actions.

The existing matching price is **2,000 credits per successful matching run**, shown before the action. Opening a Program does not run matching. A Program remains useful even when its application Form is inaccessible or unknown.

The current base provides Catalogue browsing and fit ranking. New text search, filters, automated collection schedules, application assistance, and extension support are not delivered by this cutover.

## Team responsibilities

### Tony — Catalogue coverage and accuracy

Own a bounded, reviewed collection for the agreed startup audience, not a quota of arbitrary scraped sites.

- Research official Program information and collect its source URLs and checked dates.
- Supply the required official logo asset with its source reference.
- Produce Program descriptions and target-applicant narratives from collected information. Identify AI interpretations; do not turn a preference into an eligibility requirement.
- Preserve useful narrative detail. Target applicants are not limited to a fixed `pre_idea` / `early_stage` enum.
- Include available location, Cycle, deadline, and other supported information. Unknown information stays unknown.
- Validate records, import them through the operator command, inspect them in the product, and prove that re-import does not create duplicates.
- Report coverage, inaccessible sources, and outstanding checks.

A one-off collector is acceptable. A maintained pipeline is welcome but not required. **Complete Form questions are not an acceptance requirement.** Cycles can omit Form metadata; never invent questions or mark an unchecked Form as checked to satisfy an import.

### Tiffany — discovery experience and match quality

The next main-product lane is making the existing finder useful with a larger Catalogue, not continuing the removed selected-text workflow.

- Build on the existing Program list/detail surfaces and shared matcher rather than creating a second implementation.
- Develop agreed discovery improvements, such as name/description search and filters backed by reliable data, on a fresh branch.
- Make fit reasons, concerns, missing information, and outdated results clear to users.
- Exercise representative startup profiles with different stages, sectors, locations, and incomplete information.
- Own the agreed matching or presentation fixes those cases reveal, not just a QA report. Do not make fit scores imply admission probability or invented company facts.

These are follow-on tasks, not claims that the new controls or a production-quality matching evaluation already exist in this base. Agree the specific acceptance cases with Kien before expanding the matcher or its data contract.

### Kien — product scope, integration, and application-assistance research

Set the initial startup audience, required Program coverage, and release acceptance cases. Own shared-contract changes and integration. Investigate extension/Form assistance separately; it must not block the team's discovery and matching work.

## Code and branch workflow

Start from the latest published **`origin/grants-pipeline`**, not Tiffany's earlier selected-text branch or the earlier documentation-only handoff commit. Use a clean checkout and choose the command for your task:

```sh
git fetch origin
git switch -c accelerators/tony-catalogue origin/grants-pipeline
```

```sh
git fetch origin
git switch -c accelerators/tiffany-discovery origin/grants-pipeline
```

Push your own branch and open a PR with **`grants-pipeline` as the base**. Do not push directly to the shared integration branch. Include the starting SHA, changed files, exercised checks, screenshots for UI changes, data limitations, and any schema or shared-file dependencies. Rebase or merge the latest integration base before final handoff; do not use force pushes against the shared branch.

Suggested ownership:

- Tony: `fixtures/accelerators/programs/`, `apps/web/public/accelerators/logos/`, and his collection scripts.
- Tiffany: `apps/web/src/app/employer/tools/accelerators/`, corresponding message catalogues and behavioral tests. Coordinate matcher changes in `apps/web/src/server/accelerators/` with Kien.
- Shared integration: Catalogue schemas/import, shared Proposals engine and storage, migrations, permissions, metering, and global registration. Discuss changes before editing these surfaces in parallel.

## Contracts and implementation map

| Area                                             | Location                                                        |
| ------------------------------------------------ | --------------------------------------------------------------- |
| Catalogue, Cycle, fit and API types              | `pipelines/src/proposals/accelerators/types.ts`                 |
| Catalogue import and company matches             | `pipelines/src/proposals/accelerators/db.ts`                    |
| Canonical content hashes                         | `pipelines/src/proposals/accelerators/hash.ts`                  |
| Trusted import command                           | `apps/web/scripts/import-accelerators.ts`                       |
| Access gate and matching preparation             | `apps/web/src/server/accelerators/`                             |
| Matching-only HTTP API                           | `apps/web/src/app/api/accelerators/`                            |
| Program UI and client/provider                   | `apps/web/src/app/employer/tools/accelerators/`                 |
| Existing shared AI execution and credit handling | `pipelines/src/proposals/` and `apps/web/src/server/proposals/` |

### Catalogue records

Use **schema version 2**. Existing records remain valid; Cycle Form metadata is optional. Form/Field schema definitions and historical storage can remain for existing data, but there is no active Form editor, answer API, drafting run, or suggestion contract in this delivery.

A Program contains stable identity, name, required sourced logo, official website/application URLs, sourced description and target applicants, sources, optional sourced location, and Cycles. Source references must resolve inside the same Program. Logos use committed non-empty assets under `apps/web/public/accelerators/logos/`; do not use arbitrary external image URLs or invent a replacement mark.

Importing a changed Program updates its content hash and makes affected saved fits out of date. It does not start another paid match. Company users do not receive installation-wide Catalogue write access: there is no user-facing import endpoint.

### Remaining HTTP API

The server resolves the authenticated company; clients cannot supply tenancy. Reads require `documents.read`; matching requires `documents.edit`; both require unrestricted company-document access.

| Method and path                      | Result                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `GET /api/accelerators`              | Programs, saved company fits, profile readiness, edit permission, and matching cost |
| `GET /api/accelerators/programs/:id` | Program detail and company fit                                                      |
| `POST /api/accelerators/match`       | Starts explicit matching and returns `{ run }`                                      |
| `GET /api/accelerators/runs/:id`     | Matching progress/result summary within the authenticated company                   |

The active Accelerator run kind is **`programs`**. The `accel_draft` and `accel_edit` kinds and all `/api/accelerators/applications/...` endpoints are removed. Retired stored runs must not be claimed, charged, exposed through current APIs, or allowed to block a new active run.

Existing database migrations and historical answers/results are retained. Do not drop columns or reset a database as part of this cutover. Retaining history does not make the removed feature callable.

## Local setup and operator commands

Run from the repository root. Set `DATABASE_URL` to an explicit, isolated development installation first. Do not migrate, seed, test, or import into production or an unspecified database.

```sh
pnpm install --frozen-lockfile
pnpm --filter @launchstack/web db:migrate

# Validation does not write to a database.
pnpm --filter @launchstack/web accelerators:import -- --validate \
  ../../fixtures/accelerators/programs/y-combinator.json \
  ../../fixtures/accelerators/programs/abovea-startup-accelerator.json \
  ../../fixtures/accelerators/programs/techstars-london.json

# Trusted operator only. DATABASE_URL selects the target; the label does not.
pnpm --filter @launchstack/web accelerators:import -- --installation local-accelerators \
  ../../fixtures/accelerators/programs/y-combinator.json \
  ../../fixtures/accelerators/programs/abovea-startup-accelerator.json \
  ../../fixtures/accelerators/programs/techstars-london.json
```

For a local synthetic demonstration, set `DEV_SEED_PASSWORD` yourself, then run:

```sh
DEV_SEED_WORKSPACE='Accelerators Demo — Northwind fixture' pnpm --filter @launchstack/web db:seed
DEV_SEED_WORKSPACE='Accelerators Demo — Northwind fixture' pnpm --filter @launchstack/web accelerators:demo
PROPOSALS_EXECUTOR=inline pnpm --filter @launchstack/web dev
```

The demo seeder requires a named workspace and loopback database, and refuses to overwrite an existing Core profile. It uses synthetic Northwind facts; its fit results are not evidence of production matching accuracy. Configure the existing model provider and credit balance, open `/employer/documents?feature=accelerators&at=/programs`, and explicitly select **Match Programs** for real model output. For local execution without a configured worker, use the existing `PROPOSALS_EXECUTOR=inline` setting; production must use its configured worker and credit policy.

YC, aboveA Startup Accelerator, and Techstars London remain reference records. They demonstrate the record format, logos, descriptions, fit inputs, and location/Cycle metadata where known. They do not establish adequate release coverage or current accuracy for every deadline. Recheck sources for the target release.

## Development and acceptance guidelines

- Follow `apps/web/README.md`: kit primitives, semantic tokens, Lucide icons, and English/Simplified Chinese message parity. Do not introduce raw UI colours, inline English, or a second component system.
- Keep public Program information separate from private company profiles and fits. Preserve membership, action permissions, full-document access, scope checks, and final-access rechecks.
- Reuse the existing matching run, configured model, credit adapter, and atomic commit path. Do not create unmetered model calls or a second AI job system.
- Never commit credentials, private application answers, browser sessions, or applicant data in Catalogue fixtures or screenshots.
- Keep changes focused. Do not change Grants behavior, perform unrelated rewrites, or add Form assistance to satisfy discovery acceptance.
- Run pipeline/web typechecks and affected behavioral suites. Validate record/logo assets with the real import command. UI changes need actual browser proof at desktop and narrow widths.
- For the release, prove that a startup can find relevant Programs within the agreed coverage, understand fit and uncertainty, and reach an official application link **without using a LaunchStack Form**.

## Cutover verification

- Pipeline suite: 55 files, 629 tests passed. Pipeline and web typechecks passed.
- Affected web coverage: 19 suites, 261 tests passed, including actual disposable-Postgres matching, Grants isolation, retired-run rejection, access revocation, debit rollback, self-host recording, fit-state presentation, interpretation labels, and localized credit failures.
- Affected-feature lint passed. The repository-wide lint command was not rerun: its previous attempts exhausted the Node heap. Do not report a full-repository lint or production-build pass for this cutover.
- Drizzle's snapshot check passed. The 16 Run columns have the same physical order in the migrated review database and the schema declaration, with historical `result` last.
- All three reference records and their local logo assets passed the real import command's validation mode.
- In the running app, checked Program rows and the YC detail preview at desktop and 400px widths. Form navigation and visible answer editors were absent.
- Clicked Match Programs once with the configured model and synthetic Core profile. All three fits refreshed, reload recovered progress/results, and the ledger recorded exactly one 2,000-credit debit.
- A temporary matching-progress `503` retained the stored run reference, showed the error, and prevented duplicate matching. Restoring access to the endpoint recovered the result and cleared the reference.
- All eight removed Application/Form API operations and a historical selected-edit run returned `404`. Restoring that retired run reference cleared recovery storage and left matching available. Grants APIs still returned only the existing grant and excluded Accelerator runs.
- Fingerprints of the local review database's historical Application, ten answer sections, and eight retired runs were unchanged after the smoke checks. No migrations or resets were applied to the demo database during this cutover.

The matching port also now rejects a `null` ledger debit result inside the existing finalization transaction. This closes a pre-existing failure path where an exhausted cloud balance could otherwise publish output without a debit; it does not change the deployment's negative-balance policy.

Verification limits: the live model smoke used the inline executor, not a live worker. Restored-run `404` and temporary `503` recovery have browser proof, but the provider has no automated lifecycle tests for a `403` racing a late Home response or disposal during polling. LSP was unavailable; surviving static callers were checked by text search and typechecks, not by a complete dynamic/external-caller inventory.
