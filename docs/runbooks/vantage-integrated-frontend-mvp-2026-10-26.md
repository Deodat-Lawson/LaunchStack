# Vantage integrated frontend MVP — 2026-10-26

This is a local, authenticated, synthetic demonstration of the existing Vantage weekly workflow with an opt-in contextual report. It is separate from the in-memory `/dev/vantage` simulator and from production Vantage generation.

**Acceptance status: verified working.** The existing draft was completed, launched against the recovered owned PostgreSQL instance, and exercised in a real authenticated browser. Two fresh Azure contextual generations succeeded. Exact citations, historical questions, Keep/Dismiss, Needs more evidence, pending dismissal, refresh, native-generation isolation, desktop and 390-pixel mobile navigation were verified. The application is left running on localhost:3104. No push or merge occurred.

## Checkout and scope

- Baseline: `9971ad0625c38cdb32dc28f37f15e93b29ce4371`, the completed Sophia integration runbook commit.
- Branch: `demo/vantage-integrated-mvp`.
- Isolated worktree: `C:/Users/junku/orca/LaunchStack/test-output/vantage-frontend-mvp/20261026161746Z/source`.
- Implementation commit: `59fd03280d2f923f3778ec59a9fdd393606f5c44` (25 code/test files). This runbook is committed separately.
- The separate `integration/vantage-sophia-v0` checkout is the earlier committed pipeline experiment. It does not itself contain this new frontend.

The default production Vantage route remains V1. This feature adds no task tracker, Company Profile generator, role-mapping system, retrieval architecture or public research activation. Shared V0 contracts and canonical V1 report DTOs remain separate from the demo extension.

## What is integrated

```text
Normal BetterAuth sign-in + native workspace membership
  → server-gated /dev/vantage-context
  → existing VantageTool / ToolFrame / native weekly screens
  → dedicated authenticated /api/vantage/demo extension
  → existing Company Architecture host + Sophia retrieval + TL assembly/freeze
  → explicit contextual model request
  → TL/native freshness checks and encrypted sidecar save
  → saved summary, human topic reviews, exact-source inspection

Existing native pending-question endpoints and Weekly Actions remain independent.
```

| Component               | Actual implementation versus fixture                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication          | Normal sign-in/session path; native auth user, account, membership and permissions are seeded for the owned synthetic workspace. No browser auth bypass                        |
| Database                | Existing dedicated PostgreSQL target on loopback port `55437`, database `vantage_week2_tl_contract_v1`; native document/profile/evidence/report/ACL rows                       |
| Company Architecture    | Existing adapter and conservative provenance/ACL checks. Its projected claims stay `unreviewed`; inspection works before model generation                                      |
| Roles / personal Stars  | Explicit synthetic Joseph-compatible descriptor ports, with version/freshness checks. No production role or Star discovery                                                     |
| Sophia retrieval        | Actual bounded provider over an authorized native catalog; no production vector/BM25 connector or embedding call                                                               |
| Registry / assembler    | Existing TL implementations and exact source versions, hashes, audiences and freeze checks                                                                                     |
| Model                   | Actual approved Azure `gpt-6-luna` response and persisted contextual report; explicit demo-only reasoning effort `none`. Automated transport doubles remain separately labeled |
| Research                | The configured context pipeline reports its actual mode/status. No public research connector is enabled                                                                        |
| Historical questions    | Existing native pending-question reader/review endpoints and original question IDs; current progress remains unverified                                                        |
| Contextual topic review | Dedicated saved sidecar Keep/Dismiss and Go/No-go/Needs more evidence records. These do not create Commitments or close native pending questions                               |
| Weekly Actions          | Existing V1 screen, endpoints, human decisions and explicit action rules                                                                                                       |

The fixture uses backfilled reporting weeks with current recorded generation/review timestamps. It is synthetic historical context, not proof that a real report or human decision existed on those historical dates. The deterministic demo cutoff is `2026-10-26T23:59:00.000Z`; the configured reporting weeks are supplied by the local descriptor.

## Entry point and startup

Open **`http://localhost:3104/dev/vantage-context`**. An unauthenticated visit redirects to `/signin?next=/dev/vantage-context`, so normal sign-in returns directly to this demonstration rather than the unrelated workspace landing screen.

The page and APIs require `NODE_ENV=development` and `VANTAGE_CONTEXT_DEMO_ENABLED=true`. APIs additionally require the dedicated database target, the matching synthetic actor/company descriptor, native Vantage access and the marked synthetic company. A public client flag cannot activate the service in production.

Run commands from the isolated worktree root:

```powershell
Set-Location 'C:\Users\junku\orca\LaunchStack\test-output\vantage-frontend-mvp\20261026161746Z\source'
$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
docker start launchstack-vantage-week2-tl-20261022-db
node scripts/dev/vantage-context-demo-runtime.mjs --status
node test-output/vantage-context-demo/launch-live.cjs
```

The application is already running; open the URL first. The commands above are for restarting after it stops. Do not start a second instance on 3104. The existing ignored machine-local `launch-live.cjs` reads only CHAT_BASE_URL and CHAT_API_KEY from the original checkout into memory and supplies the absolute approved model YAML. It does not inherit the original DATABASE_URL, authentication settings or generic dotenv configuration. Its source and secret-redacted runtime logs are retained locally. When those three approved CHAT variables are already set safely in a shell, the committed alternative is `node scripts/dev/vantage-context-demo-runtime.mjs --serve`. Ordinary restart does not require `--prepare` or any database seed.

On this computer, Docker Desktop's CLI is installed under the user's local programs directory. If it is not already on PATH, prepend its actual location for this shell:

```powershell
$demoDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
$env:Path = "$demoDockerBin;$env:Path"
```

Do not substitute an assumed `Program Files` path. The helper checks the existing container/volume ownership and dedicated target before preparing or serving.

`--status` reports local descriptor paths and configured weeks without printing credentials. It does not establish database health, authentication or provider success.

`--prepare` is a **write operation** against the existing owned synthetic database. It creates or reuses the persistent synthetic workspace, local sign-in account, native Rules reports and the human question lineage. It does not call a model, reset a database, remove a volume or delete unrelated rows. Existing fixture/journal files are reused; unique proof files preserve each preparation result. The seed can update its owned descriptor selection while leaving the underlying synthetic documents preserved.

`--serve` verifies the owned Docker container/volume and database credentials, refuses an occupied port instead of killing a process, then starts Next development mode on `localhost:3104`. It starts no durable worker. Starting Next writes its normal development cache. Both preparation and serving refuse repository/app dotenv files; do not delete someone else's dotenv file to satisfy this check.

Prerequisites are:

- Existing local Docker Desktop and the owned TL PostgreSQL container/volume from the isolated integration harness.
- Existing ignored `scripts/dev/vantage-integration-tl.env.local` with the dedicated database credential.
- Installed dependencies for this worktree. The evaluated toolchain uses the repository-pinned pnpm `10.15.1`.
- For serving, approved `CHAT_BASE_URL`, `CHAT_API_KEY`, and an **absolute** `CHAT_MODELS_CONFIG` supplied to the process. The launcher accepts the verified Azure OpenAI v1 resource path with or without its trailing slash and checks the configuration SHA-256 `2b5e377779313de1e13868b4c61f0633d15b63a3eb82e03d761f399768e02bb9`. It does not substitute another deployment or service. Current allowed model identity is `gpt-6-luna`. The demo service explicitly requests reasoning effort `none`; this is disclosed in saved execution metadata and leaves production model defaults unchanged.

The launcher requires provider configuration even when only viewing saved data; visiting or reloading the context screen itself does not invoke the provider. **Generate with context** is the explicit model action. Native Weekly Review has its separate existing generation controls.

Local files are under `test-output/vantage-context-demo/runtime/`:

| File                | Purpose                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credentials.json`  | Local sign-in and encryption credentials; open privately on this computer to retrieve `loginEmail` / `loginPassword`. Do not print, paste, screenshot or commit its values |
| `fixture.json`      | Non-secret synthetic actor/company, source selectors, mocked roles/Stars and reporting weeks                                                                               |
| `seed-state.json`   | Owned seed journal and original historical-question identity                                                                                                               |
| `seed-proof-*.json` | Unique synthetic preparation/readback proofs                                                                                                                               |

Synthetic login email: **sophia-fixture-91f7010c-66b6-4a32-920a-40fb70c17610@example.invalid**.

Copy the existing password locally without displaying it in terminal output:

```powershell
$demoLogin = Get-Content -LiteralPath '.\test-output\vantage-context-demo\runtime\credentials.json' -Raw | ConvertFrom-Json
Set-Clipboard -Value $demoLogin.loginPassword
Remove-Variable demoLogin
```

Paste into the ordinary localhost sign-in password field. No password is included in this report. An ordinary private editor can also retrieve the field. Do not print the credential file. The descriptor's existence alone does not establish that a later application or model call succeeded.

## Saved state and evidence limits

The native agenda remains the existing company/week row. The contextual report is encrypted under the independent `vantageContextDemoV1` namespace in that row's `modelMetadata`. Its summary, canonical citations, human reviews and bounded history are accessed through the authenticated demo service, not through a new public report DTO.

Native `saveGeneration` now preserves only a validated **existing encrypted envelope** for that namespace. Generated model metadata cannot create or replace it, and arbitrary old metadata/plaintext is not carried forward. Native summary, topics, decisions and action links keep their existing rules. This narrowly necessary retention change does not make the sidecar input to native evidence selection.

Explicit contextual regeneration archives the prior sidecar state instead of reusing its AI conclusions as current facts. The local namespace is limited to eight archived states and 750,000 serialized payload bytes. When full, save fails while retaining existing history; it does not silently discard old reviews.

Before release, review or source inspection, the service checks the requesting actor and current authorized exact source versions/content hashes, plus a fingerprint of native generation input excluding only its random run ID. Changed native evidence, reviewed content or pending-question input can make the saved contextual report obsolete. Old encrypted records remain retained, while their prose/citations/reviews are withheld from the current view until a fresh authorized generation.

The final save uses the existing TL `commitContextGeneration` binding/freeze checks and native report CAS guard under the Company Architecture adapter's short guarded transaction. Profile/document/ACL and native Vantage state are checked before the namespace update. The existing isolated host's global repository pool is pinned to the same physical database protected by the guard locks. No model runs while these locks are held.

The frontend hides old contextual text after failed reloads or known source/authorization/version failures. It only says a current version was loaded after successful readback. It does not continuously subscribe to revocations: previously authorized text already displayed in a browser cannot be retroactively unseen. Exact-source opening and reload perform new checks; the source panel never fetches arbitrary URLs or translates a V0 document ref into a fabricated V1 `ev:` record.

Company Architecture inspection displays its supplied unreviewed facts, explicit unknowns, exact content and original provenance. A canonical profile or existing source ID does not establish that a current-world claim is true. A document change does not prove implementation or completion. Human decisions record choices, not completed work. Only explicit native pending-question review changes that queue; sidecar Go/No-go/Needs more evidence records do not do so.

## Generation and diagnostics

The experimental generator retains the existing compound-response approach: one bounded provider invocation per attempt produces a native V1 carrier and a separate contextual report. The carrier must remain valid under the original native validator; contextual facts/conflicts use exact canonical V0 object references. It is not a reused earlier report and a Rules fallback is not a successful contextual model result.

The default V1 generator and frozen contracts are unchanged. Experimental prompt `vantage/sophia-paired-context/v0.3` adds local prompt compaction when the compound envelope would otherwise exceed its limit: expendable previous AI report text can be omitted from the transmitted native JSON, while the full original input/envelope remains intact for validation and freshness guards. Current evidence, protected reviewed native content and pending human-question input remain preserved. Per-attempt omission metadata is reported; omitted history is not evidence that a question was answered.

The successful run used **23,095 prepared bytes**. It omitted the previous AI summary and one previous AI topic from the transmitted prompt; the original human-authored pending question remained included. This does not change the saved full input or historical reports.

Limits remain 23,500 prepared input bytes, the existing 2,400 combined output-token cap, at most two 20-second attempts, and 45 seconds overall. Passing input preflight does not guarantee that the model will satisfy the compound schema, event-state checks or exact-reference requirements.

The collapsed **Saved report details** section reads saved generation-time values, including actual model/prompt/attempt duration, prepared bytes and history omissions, retrieval/manifest status, research mode/status, synthetic role IDs and Star count, selected/missing/omission counts and exact references. Unavailable identities stay count-only. Older reports without these fields say diagnostics were not captured; the UI does not infer `complete` status.

The separate authenticated `POST /api/vantage/demo/preflight` checks prompt construction without provider calls or persistence. Its result is not a live model result.

## Verified checks

| Check                                                        | Observed result / boundary                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context UI component tests                                   | **16/16 passed** with synthetic API doubles; includes explicit generation, pre-generation architecture inspection, exact refs, Keep/Dismiss, all three decisions, stale/readback failures, direct native week resolution and actual/uncaptured diagnostics           |
| Latest selected UI/client/frame regression                   | **40/40 passed**: 16 new context cases, 8 pending-question component cases, 11 weekly-agenda V1 client cases, 2 pending client cases and 3 ToolFrame cases. An earlier different five-file selection passed 61; it is not relabeled as a final 63-case run           |
| Demo PostgreSQL service + route tests                        | **22/22 passed**: 14 actual native PostgreSQL service cases and 8 route cases, logged in `checks/backend-reasoning-none-final.log`; session/model-transport doubles are explicit, not live model calls                                                               |
| Encrypted metadata retention/isolation                       | **9/9 passed**, including rejection of generated namespace injection and retention of only the validated existing encrypted envelope                                                                                                                                 |
| Experimental generator regression                            | **18/18 passed** with transport doubles, including unchanged full input and protected current/native/human context under compaction                                                                                                                                  |
| Pipeline Vantage regression, integration files excluded      | **423/423 passed across 26 files**, 1.88s; actual PostgreSQL cases were exercised separately                                                                                                                                                                         |
| Runtime helper                                               | **5/5 passed** via Node's test runner; runtime syntax check passed                                                                                                                                                                                                   |
| Web typecheck                                                | Passed after UI/diagnostic additions                                                                                                                                                                                                                                 |
| Frontend scoped ESLint and Prettier                          | Passed; existing Next pages-directory configuration notice only                                                                                                                                                                                                      |
| Successful fresh live contextual generation + saved readback | **Passed**: HTTP 201, one actual provider call, `gpt-6-luna-2026-09-22`; full contextual report read back from the encrypted namespace                                                                                                                               |
| Browser review flow so far                                   | Company inspection before generation, exact operations citation/provenance, Keep, Needs more evidence and Dismiss have corresponding captures/readbacks; native-after-context retention, separate pending dismissal and 390×844 mobile report/navigation also passed |
| Final commit and preservation/privacy checks                 | Passed: implementation committed, original 17 dirty-file hashes unchanged, stable integration clean, known-secret scan zero matches                                                                                                                                  |

Useful exact commands:

```powershell
pnpm --filter @launchstack/web test --runInBand --runTestsByPath __tests__/components/vantage-context-demo.test.tsx
pnpm --filter @launchstack/web typecheck
pnpm --filter @launchstack/pipelines exec vitest run src/vantage/generation-metadata-v1.test.ts src/vantage/experiments/sophia-generation-v0.test.ts
node --test scripts/dev/vantage-context-demo-runtime.test.mjs
```

The recorded full pipeline command, run from `pipelines/`, was:

```powershell
node node_modules/vitest/vitest.mjs run src/vantage --exclude src/vantage/repository-v1.integration.test.ts --exclude src/vantage/company-architecture-v0/reader.integration.test.ts --reporter=default
```

The PostgreSQL service tests require the already guarded local test environment. Do not point ordinary tests at production or an arbitrary `DATABASE_URL`. The current private helper `test-output/vantage-context-demo/run-backend-checks.mjs` supplies the owned TL test environment and records exclusive labeled logs; it is a local artifact, not a new production entry point.

Evidence paths relative to this worktree:

- `test-output/vantage-context-demo/checks/`: preserved backend attempts, metadata/generator/service/route checks and command records.
- `test-output/vantage-context-demo/preflight-01.json` and `preflight-02.json`: separate no-provider prompt observations.
- `test-output/vantage-context-demo/preflight-none-03.json`: successful 23,095-byte no-provider preflight; it is not itself the live result.
- `test-output/vantage-context-demo/runtime/generation-attempts/20261026T180247034Z-b164c407-e414-44d4-8d7c-8589c5167083/`: successful live full input, body-only provider request/response, parsed/normalized validation observations.
- `test-output/vantage-context-demo/context-live-saved-01.json`: actual saved contextual report and independent native/pending/action readbacks, without using encrypted native metadata as a rendered report.
- `test-output/vantage-context-demo/context-reviewed-02.json`: revision 3, first topic Kept with recorded Needs more evidence text, original pending ID retained, zero actions.
- `test-output/vantage-context-demo/context-human-refresh-03.json`: revision 4, same first-topic review retained and second topic Dismissed, original pending ID retained, zero actions.
- `test-output/integrated-frontend-mvp/seed-runtime-summary-1793035621240.json`: non-secret seed/runtime summary.
- `test-output/vantage-context-demo/runtime/seed-proof-*.json`: unique native preparation proofs.
- `test-output/vantage-context-demo/screenshots/`: browser captures, including `02-company-architecture.png`, `05-live-context-summary.png`, `06-exact-operations-citation.png`, `06b-citation-provenance.png` and `07-human-needs-more-evidence.png`; final accepted screenshot inventory appears below.
- Final native-regeneration-after-context, pending disposition, mobile acceptance and commit evidence are recorded below.

Keep failed attempts separately. Do not infer provider cost from accepted-response diagnostics alone when an earlier rejected request also consumed tokens.

## Three-to-five minute walkthrough

1. Open `/dev/vantage-context`, sign in normally with the local synthetic account, and choose a reporting week. The options include their dates even when fixture labels are identical. Merely loading/selecting/reloading does not call the model.
2. Click **Inspect Company Architecture** before generation. Inspect the unreviewed facts, unknowns and exact source/version/content provenance. Close the source panel. The existing native pending-question section remains visible even when no contextual report exists.
3. Click **Generate with context** only when an approved live call is intended. Wait for a validated saved report. The observed successful browser request took 12.514 seconds. If the provider/schema/grounding check fails, read the error and retain the earlier records; do not label a fallback or preflight as AI success.
4. Read the Weekly Summary, source-reported facts, interpretation and decision question. Open an exact citation, then expand **Saved report details** to inspect the actual selected context and execution. Keep or Dismiss a topic; record Go, No-go or Needs more evidence with an optional note. Reload and verify the recorded state. These choices create no action.
5. Review **Pending Questions from Previous Reviews** using the existing native Confirm addressed/Dismiss controls only when that human disposition is intended. Open **Weekly Actions** or **Open native Weekly Review** to use the original workflow. A pending review is independent of a Commitment's state; a historical deadline or absent feedback does not prove failure or completion.

The direct `/dev/vantage-context/review` page resolves the descriptor's default week instead of the wall clock. `/dev/vantage-context/agenda?week=YYYY-MM-DD` opens an explicit native week. The existing native review's generation controls are independent from contextual generation; selecting native Rules mode does not exercise a live model.

## Exact changed files

Implementation commit `59fd03280d2f923f3778ec59a9fdd393606f5c44` contains the following 25 files relative to the baseline. This runbook is an additional documentation file.

| Group                             | Files                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reused tool and new contextual UI | `apps/web/src/app/employer/tools/vantage/VantageTool.tsx`; `apps/web/src/app/employer/tools/vantage/_screens/ContextDemoScreen.tsx`; `apps/web/src/app/employer/tools/vantage/_components/ContextSourceDialog.tsx`; `apps/web/src/app/employer/tools/vantage/demo-api.ts`; `apps/web/src/app/employer/tools/vantage/demo-contract.ts`                                           |
| Gated local page                  | `apps/web/src/app/dev/vantage-context/[[...slug]]/page.tsx`; `apps/web/src/app/dev/vantage-context/VantageContextPreview.tsx`                                                                                                                                                                                                                                                   |
| Authenticated extension           | `apps/web/src/server/vantage/demo-service.ts`; `apps/web/src/server/vantage/demo-capture.ts`; `apps/web/src/app/api/vantage/demo/_http.ts`; `apps/web/src/app/api/vantage/demo/route.ts`; `apps/web/src/app/api/vantage/demo/topics/route.ts`; `apps/web/src/app/api/vantage/demo/source/route.ts`; `apps/web/src/app/api/vantage/demo/preflight/route.ts`                      |
| Existing generation integration   | `pipelines/src/vantage/repository-v1.ts`; `pipelines/src/vantage/generation-metadata-v1.ts`; `pipelines/src/vantage/experiments/sophia-generation-v0.ts`                                                                                                                                                                                                                        |
| Safe local runtime and seed       | `scripts/dev/vantage-context-demo-runtime.mjs`; `apps/web/scripts/vantage-context-demo-seed.ts`                                                                                                                                                                                                                                                                                 |
| Focused tests                     | `apps/web/__tests__/components/vantage-context-demo.test.tsx`; `apps/web/__tests__/server/vantage-context-demo.integration.test.ts`; `apps/web/__tests__/api/vantage/context-demo.route.test.ts`; `pipelines/src/vantage/generation-metadata-v1.test.ts`; `pipelines/src/vantage/experiments/sophia-generation-v0.test.ts`; `scripts/dev/vantage-context-demo-runtime.test.mjs` |

## Completed browser acceptance

- Normal synthetic sign-in succeeded and returned to the intended local route.
- Company Architecture opened before generation; exact Operations version and SHA-256 opened after it.
- Fresh generation, Keep, Dismiss and Needs more evidence persisted through browser refresh and normal authenticated API readback.
- Native Rules regeneration advanced native version **2 → 3** while the entire contextual report JSON, source references and reviews remained identical at revision **4**. Original historical ID remained, actions stayed empty. Artifact: `after-native-regeneration-04.json` compared with `context-human-refresh-03.json`.
- A separate prior Rules topic was explicitly kept by the human for testing. Native generation carried two separate exact IDs: `4d91430c-89ae-4381-9288-fd1bd2cd76ae` and the original `9dca19f4-90bb-49e8-bd65-6ab09171d1f1`. The browser dismissed only the former. `pending-dismissed-06.json` shows the original remains; no action was created. No historical report was deleted and no original question was revived or marked complete.
- Authoritative historical-review changes invalidated the earlier contextual snapshot. The UI withheld its prose and now explicitly says earlier reports/reviews remain stored. A subsequent fresh generation succeeded; no stale report was silently reused.
- Desktop, 390×844 mobile report layout, mobile screen navigation and the real Weekly Actions empty state passed. The mobile topic header was adjusted to stack review controls below its title. Browser captures are real captures, including native Chrome device screenshots, not mockups.
- The final report is left open on desktop. No automatic Commitment, privacy approval or completion record was created.

The original checkout remains at `a9d3e64240551a648c36ba04bce6078e0408168e`: all 17 dirty-file SHA-256 values match the saved preservation manifest. The stable Sophia integration checkout remains clean at `9971ad0625c38cdb32dc28f37f15e93b29ce4371`. The dedicated running container/volume ownership and actual PostgreSQL database/user were verified read-only. At 17:58:38Z, the matched demo Node process tree had loopback 55437 connections and zero 5433 connections. No migration, reset, production seed or volume deletion was performed.

This document does not substitute the earlier October 25 backend experiment for this actual browser proof.

## Actual live execution and browser state

The successful contextual POST returned **HTTP 201 in 12.514 seconds**. Its saved execution reports `mode=ai`, `fallbackReason=null`, one attempt and **11,703 ms** generation duration. The actual provider response is HTTP 200, `finish_reason=stop`, model **`gpt-6-luna-2026-09-22`**, using the same approved Azure deployment/configuration with the disclosed local reasoning override.

| Captured quantity                                                | Actual successful run                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Experimental prompt                                              | `vantage/sophia-paired-context/v0.3`                                                                                                                         |
| Deployment / provider snapshot                                   | `gpt-6-luna` / `gpt-6-luna-2026-09-22`                                                                                                                       |
| Reasoning effort                                                 | Explicit demo-only `none`; actual reasoning tokens **0**                                                                                                     |
| Provider attempts                                                | **1**                                                                                                                                                        |
| Input tokens                                                     | **5,066**                                                                                                                                                    |
| Completion tokens, native carrier and contextual report combined | **1,563**                                                                                                                                                    |
| Total tokens                                                     | **6,629**; USD cost not calculated                                                                                                                           |
| Prepared prompt                                                  | **23,095 bytes**, limit 23,500                                                                                                                               |
| Previous AI history omitted from transmitted prompt              | Summary and **1 topic**; full original input and human pending question retained                                                                             |
| Retrieval / manifest / research                                  | `complete` / `partial` / `STOP` + `stopped`                                                                                                                  |
| Actual context                                                   | **6** selected records, **1** personal Star, role IDs `engineering, founder`, **0** missing refs, **1** omission event, **0** unavailable optional selectors |
| Saved report                                                     | `cb9a1ace-d399-4258-a776-aca09528d0de`, week `2026-10-12`, generated `2026-10-26T18:02:58.739Z`                                                              |

The partial manifest is the inherited assembler's representation of stopped optional research; it does not establish that required Company Architecture or the Star was missing. The body-only captures and `validation-*.json` distinguish the raw response, parsed compound output and normalized native carrier. `demo-capture.ts` and the optional experimental observation callback are local diagnostic additions; no endpoint, authorization headers or credential configuration is captured.

Earlier failures were real and remain separate:

1. A prepared prompt measured **24,767 bytes**, above 23,500. That setup failure occurred before provider invocation. The experimental-only v0.3 compaction brought the actual full prepared request to 23,095 without dropping current evidence or the human pending question.
2. A request using the default medium reasoning setting returned HTTP 200 with `finish_reason=length`, empty visible content and all **2,400 completion tokens consumed as reasoning**. Its retry timed out. It produced no accepted contextual report. The later demo-only `none` setting is an explicit behavior change; the default production reasoning configuration was not changed.

Successful browser/API observations so far:

- The authenticated local page and Company Architecture inspection were opened before contextual generation. Both landing and generated-report mobile layouts were verified at 390×844; the phone screen switcher reached native Weekly Actions.
- An independent native Rules generation returned HTTP 201/version 2. Original pending question `9dca19f4-90bb-49e8-bd65-6ab09171d1f1` remained visible and no actions were created. Native regeneration after contextual reviews also passed: native version 2 → 3, contextual revision 4 unchanged byte-for-byte at the normalized JSON level. Automated PostgreSQL coverage remains separate.
- The exact operations citation `doc:workspace-document/1122@1126` and its content hash were opened in the source panel.
- First topic `27b7681f-615e-48df-8087-fd1ae58bbf67` was Kept, then received a human Needs more evidence record. `context-reviewed-02.json` read back sidecar revision **3**.
- `context-human-refresh-03.json` read back revision **4**: the first review remained intact, second topic `3dd618bb-0956-44b4-9984-3ba5b222dc58` was Dismissed, the original pending question remained, and the action list was still empty. Browser refresh preserved that state; later mobile and separate pending-disposition checks also passed.

The recorded human note is:

> Synthetic demo review: Needs more evidence. Compare QA and Operations account IDs and trace the remaining record before a named privacy reviewer records Go or No-Go. This records a review outcome, not completion or approval.

## Actual selected inputs and grounding

The bounded descriptor now selects six native document IDs and one personal Star; all eleven original synthetic document rows remain in the database. The canonical company projection adds a record and the proven QA copy is deduplicated, leaving the six records below. The five other original document selectors were removed from this deliberately small demo catalog, not deleted from the database.

| Exact selected source                                                                                                          | Supplied content                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company:company-metadata/2037`, version `company-profile-v0:a707dcf7b7464dc556d477b73bc9e9faebfea6b4cf24a911e8369ec9868a72e4` | Unreviewed projection: Synthetic Orbit; onboarding software for pilot operators; deletion acceptance review beyond an engineering pass; explicit unknown industry/roles/hierarchy/decision authority, with original document/version provenance |
| `doc:workspace-document/1118@1122`                                                                                             | “Synthetic Orbit builds onboarding software for pilot operators. Privacy is a constraint: access needs a deletion acceptance review, not only an engineering test pass.”                                                                        |
| `doc:workspace-document/1119@1123` — personal Star                                                                             | Human review record says to retain the deletion go/no-go question until a named reviewer compares QA/operations samples and records approval; **that document** contains no approval record                                                     |
| `doc:workspace-document/1120@1124`                                                                                             | QA run-17: **3 of 3** sample accounts deleted; reports its sample passed; explicitly **not** a recorded privacy sign-off                                                                                                                        |
| `doc:workspace-document/1122@1126`                                                                                             | Independent operations run-17: **2 of 3** sample accounts fully deleted; **one record remained**; lists may differ from QA; no reconciled shared sample supplied                                                                                |
| `doc:workspace-document/1123@1127`                                                                                             | Historical engineering blocker asks to identify which run-17 accounts remain after deletion                                                                                                                                                     |

The omitted QA connector copy is `doc:workspace-document/1121@1125`. The operations source remains independent. Its exact content SHA-256 is `1dc40d3d83c215f033857abdcd92dc1963961d8852abe3911b90a1ed495a9ded`, matching the opened source panel. The full exact source bodies and other hashes are in the successful `input.json` and saved diagnostics.

Native current evidence contains the same two QA/operations accounts under `ev:ead6bfde-69cf-41d5-83f6-4ca5a3153bd2` and `ev:57d4366c-efd8-4a8d-acf1-a91415b9a988`. Their duplicate document copies are not additional independent corroboration. The original founder-authored question from week `2026-10-05` is carried separately as human history, not a current-world evidence item or automatic open task.

Manual review of every contextual fact/conflict found matching supplied source text. Topic 1 preserves the unknown sample overlap, distinguishes a reported pass from privacy sign-off and correctly limits the absence of approval to the cited record. Topic 2 treats the historical blocker as a question and explicitly says its current status may already have been addressed. Neither inferred completion, failure or an automatic action status from silence.

The two proposed topics are nevertheless **substantially redundant**: both ask to match account sets and trace the operations-reported remaining record. Topic 2 adds a narrower blocker-to-audit identity question, but much of its investigative step could be a sub-question of Topic 1. A future quality experiment should assess fewer, better-separated topics rather than counting two valid objects as improvement. No generator change is made here to address that limitation.

Company Architecture was delivered and successfully inspected, but no generated fact cites the canonical company record or its backing document `1118@1122`. The named-reviewer requirement is supported by the Star, so a separate incremental reasoning benefit from Company Architecture is **not demonstrated** by this run. Exact citation validity and successful storage establish provenance/execution boundaries, not full semantic quality.

## Actual contextual weekly report

This is the accepted report from `context-live-saved-01.json`, before subsequent human Keep/Dismiss/decision edits. Source IDs are unchanged; typographic apostrophes are normalized for readability. The raw JSON remains authoritative. This is the contextual report, not the native V1 carrier or encrypted native metadata.

### Weekly Summary

> For run-17, QA reports 3 of 3 sample accounts deleted, but an independent operations audit reports 2 of 3 fully deleted and one record remaining; the samples may differ, and no shared sample was reconciled. A workspace excerpt says the deletion go/no-go question should remain until a named privacy reviewer compares the samples and records approval; it also says no approval record is present in that document. The key uncertainty is which accounts and records each team checked. Focus this week on reconciling the samples and clarifying the evidence a privacy reviewer would need before making a go/no-go decision.

### Topic 1 — Clarify run-17 deletion evidence for a privacy go/no-go

ID: `27b7681f-615e-48df-8087-fd1ae58bbf67`. Generated status: `suggested`.

Facts:

- QA reports 3 of 3 sample accounts deleted; its excerpt says this sample result is not a recorded privacy sign-off. Source: `doc:workspace-document/1120@1124`.
- Operations reports 2 of 3 sample accounts fully deleted and one record remaining. It says the account list may differ from QA's and no reconciled shared sample was supplied. Source: `doc:workspace-document/1122@1126`.
- A human privacy review record says to retain the deletion go/no-go question until a named privacy reviewer compares QA and operations samples and records approval; the document contains no approval record. Source: `doc:workspace-document/1119@1123`.

Conflict:

> QA reports all 3 of its sample accounts deleted; operations reports one record remaining among its 3. The account lists may differ, so the excerpts do not establish conflicting results for a shared account.

Sources: `doc:workspace-document/1120@1124`, `doc:workspace-document/1122@1126`.

Interpretation:

> The QA and operations results are independent reports with potentially different samples, so they do not establish a same-account discrepancy or acceptance. The review record explicitly describes a comparison and approval step, but does not show that either occurred. Resolving the sample mismatch could give the reviewer clearer evidence; it would not itself constitute approval.

Decision Question:

> What specific account-level evidence should a named privacy reviewer compare, and has a reviewer been identified to make the go/no-go decision?

Proposed Next Step:

> Suggested check: match the QA and operations account lists, trace the operations-reported remaining record, and prepare a concise comparison for a named privacy reviewer. Observe whether the teams tested the same accounts and whether each matched account has a deletion result; ask the reviewer what additional evidence is needed before considering any further test.

Unknowns:

- Whether QA and operations tested the same accounts.
- Which account or record remained and whether it was subsequently deleted.
- Whether a named privacy reviewer has compared the samples or recorded a decision outside the cited review record.

Rationale:

> This combines the current run-17 observations with the review record's explicit comparison and go/no-go question. It preserves the distinction between reported sample results and privacy approval, which the cited materials do not record.

Proposed owner, due date and help requested: all `null`. No enhancement or Commitment was generated.

### Topic 2 — Clarify the remaining-account reliability question

ID: `3dd618bb-0956-44b4-9984-3ba5b222dc58`. Generated status: `suggested`.

Facts:

- An engineering blocker excerpt asks to identify which run-17 accounts remain after deletion; it does not report that the accounts have been identified or the blocker resolved. Source: `doc:workspace-document/1123@1127`.
- Operations reports one record remained in its run-17 sample, while noting that its account list may differ from QA's and no shared sample was supplied. Source: `doc:workspace-document/1122@1126`.

No conflict entry was generated.

Interpretation:

> The operations result is relevant to the blocker’s account-identification question, but the excerpt does not establish that the blocker concerns the same sample or that the remaining record has been traced. Matching the evidence could clarify whether they describe the same issue.

Decision Question:

> Does the engineering blocker refer to the operations-reported remaining record, or to a different run-17 account set?

Proposed Next Step:

> Suggested check: compare the blocker’s run-17 account set with the operations audit and identify the remaining record, if they match. Observe whether account identity and deletion status can be established; use the result to decide whether a specific retest or further investigation is appropriate.

Unknowns:

- Whether the engineering blocker and operations audit refer to the same account set or remaining record.
- Whether the blocker is still active or its question has been addressed.

Rationale:

> This is a narrower clarification grounded in the engineering blocker and operations audit. It avoids treating the historical blocker as proof of current unfinished work while recognizing that the current audit may help answer its stated question.

Proposed owner, due date and help requested: all `null`. No enhancement or Commitment was generated.

## Final fresh generation after historical review changes

Actual saved report revision **5**, generated `2026-10-26T18:15:26.321Z`. Its prior report and two human topic-review records are archived in the encrypted sidecar; the UI reports two historical human-review records. A contextual regeneration produces new topic IDs and does not transfer an old human decision onto a new AI topic. The current UI has no archive browser; prior review content remains stored and is covered by PostgreSQL retention tests.

The final fresh request returned **HTTP 201 in 12.033 seconds**, with one model attempt (**11,278 ms**), actual snapshot `gpt-6-luna-2026-09-22`, explicit reasoning `none`, **5,065 input + 1,591 completion = 6,656 total tokens**, zero reasoning tokens and no fallback. Exact request/response/validation artifacts: `runtime/generation-attempts/20261026T181515042Z-88820911-f3af-4945-8d5f-34285f3df20e/`.

Weekly Summary:

> For synthetic run-17, QA reported 3 of 3 sample accounts deleted, but an independent operations audit found 2 of 3 fully deleted and one record remaining; the audit says the account lists may differ. The QA result is not privacy sign-off, and the supplied human review record says the deletion go/no-go question is to remain until a named privacy reviewer compares the samples and records approval. A focused next step is to reconcile account-level results across the same sample, then clarify what evidence the reviewer needs; the excerpts do not show that approval occurred.

- **Reconcile the run-17 samples before deletion go/no-go** — What account-level evidence should the named privacy reviewer compare, and has a reviewer been named to make the go/no-go decision?
  Proposed check: Suggested check: reconcile the QA and operations account lists, compare deletion outcomes for each shared run-17 account, and record the status of the account with a remaining record. Then ask the named privacy reviewer whether this evidence is sufficient to decide; use any gaps to define a targeted follow-up test.

- **Identify the run-17 account with a remaining record** — Does the engineering blocker refer to the remaining record in the operations audit, and can the affected account be identified from the run-17 evidence?
  Proposed check: Suggested check: compare the blocker’s account-level findings with the operations audit sample and record whether they identify the same account. If they do, use that account to verify the reported remaining-record outcome; if not, clarify which run-17 account set the blocker concerns before choosing another test.

Remaining observed reasoning error: the final model lists “The Company Architecture reviewState and other unknowns are not supplied in the provided excerpts.” This is **incorrect**: the exact supplied company excerpt contains `reviewState=unreviewed` and nine explicit unknown codes. The UI's source panel correctly shows these fields. The report passed schema, registered-reference and narrow event-state checks; those checks do not provide full semantic entailment. Neither accepted response demonstrated use of the company facts through a company citation. The two topics also overlap in their account-reconciliation investigation. These are quality limitations, preserved in the raw outputs, not reasons to label the frontend integration or source projection mocked. No further retry was used to hide this error.

## Final screenshot inventory

All paths are relative to `test-output/vantage-context-demo/screenshots/`.

| Capture                                       | Evidence                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `01-weekly-review-landing.png`                | Authenticated initial landing and original pending question                     |
| `02-company-architecture.png`                 | Actual unreviewed Company Architecture with facts and provenance                |
| `05-live-context-summary.png`                 | First accepted live Weekly Summary and decision topic                           |
| `06b-citation-provenance.png`                 | Exact Operations document version, content and SHA-256                          |
| `07-human-needs-more-evidence.png`            | Actual Go / No-go / Needs more evidence interaction                             |
| `08-context-diagnostics-and-pending.png`      | Persisted review and captured generation/retrieval status                       |
| `10-original-pending-question.png`            | Original historical question, origin week, unverified status                    |
| `11-pending-dismissal-preserves-original.png` | Separate dismissal leaves the original question intact, stale context withheld  |
| `13-mobile-topic-final.png`                   | Actual Chrome 390×844 viewport with stacked review controls and exact citations |
| `14-native-weekly-actions.png`                | Real native actions screen; no automatically created actions                    |
| `15b-final-desktop-report.png`                | Final fresh report left running for the team demo                               |

The zero-byte `15-final-desktop-report.png` is a retained failed capture write; use `15b`. Earlier failure screenshots and preflight files remain separate. Credentials and headers are absent from captures. A known-local-secret scan checked 25 staged files and 74 ignored artifacts with zero matches; protected production prompts, Contract v1, V0 interfaces and the default generation port were unchanged. Runtime credentials intentionally remain only in their ignored local credential file.

## Remaining integration dependencies

1. Production V1 remains the default and uses its original API and review workflow. Only encrypted demo metadata retention was added internally.
2. The real locally integrated V0 backend now has an authenticated, working development UI and real PostgreSQL/live-model proof. It is not production activated.
3. Joseph's production actor roles and personal Stars resolver must replace the explicit versioned synthetic resolver. Sophia's provider is real, while its authorized candidate catalog is deliberately bounded by the local descriptor; production source discovery/indexing and host lifecycle remain dependencies.
4. TL production rollout still needs a canonical versioned contextual report/citation DTO and persistence/review design, archive access, operational key/configuration management and rollout authorization. Do not cast V0 company/doc refs into V1 refs.
5. Research remains STOP, and no public research tool is enabled. Improve semantic use of Company Architecture and reduce repeated topics before evaluating any production rollout.

Next integration step: inject Joseph's actual actor-scoped role/Star provider into this same composition and rerun the ACL/version/stale-snapshot/browser scenarios. Keep the source registry and guarded commit server-owned.

Final read-only preservation/runtime audit at **2026-10-26 18:26:43–47 UTC** again confirmed all 17 original dirty-file hashes unchanged, the stable integration checkout clean, the owned database running, and source-owned Next PID 15104 listening on loopback 3104. Its matched process tree had 18 established 55437 connections and zero 5433 connections at that observation. The final known-secret scan covered the 25 implementation files, this staged runbook and 76 ignored artifacts with zero matches; production/frozen interface files remained unchanged.
