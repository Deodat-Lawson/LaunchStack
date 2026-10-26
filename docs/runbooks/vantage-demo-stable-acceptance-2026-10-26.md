# Vantage stable demo acceptance — 2026-10-26

The stable demo is development-only and uses the real canonical Company Architecture adapter, Sophia retrieval, TL registry/manifest/evidence snapshot and guarded persistence. Its default portable transport is a **recorded synthetic AI replay**, never a fresh model response. Existing production V1 generation remains separate. Generation quality and prompts were not improved in this round.

## Reproduce

Follow [clean-clone startup](vantage-demo-clean-clone.md). Pin Node 24.19.0 and pnpm 10.15.1; install with the frozen lockfile, then run:

```powershell
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --setup
pnpm.cmd exec node scripts/dev/vantage-context-demo-runtime.mjs --serve
```

Open **http://localhost:3104/dev/vantage-context**. Retrieve the generated account privately from ignored `test-output/vantage-context-demo/runtime/credentials.json`. Select October 12 and choose **Replay recorded report**. No Azure credential is needed. Live generation is separately opt-in through `--serve-live` and the tracked sanitized model configuration.

## What was actually tested

A clean detached checkout of code commit `a945a707c5bb1bbbf3471459627a90412318c026` was created at `test-output/vantage-publication-20261026/clean`. It began with no node_modules, environment file, credentials, fixture descriptor or database state. A frozen pnpm 10.15.1 install succeeded (1,968 packages, using the machine's package cache where available). No lockfile changes occurred.

The documented setup ran against the explicitly separate portable target **55438 / 3105**, leaving the existing **55437 / 3104** demo running. Docker created the separately labeled `launchstack-vantage-week2-tl-20261022-portable-db` and its own volume. All **4 engine and 28 product migrations** applied and their checks passed. The seed created a new synthetic actor/company, native reports, original-ID pending lineage, and 13 canonical company facts with restricted native source documents. No copied local database/auth/model credential was required.

Headless Playwright Chromium then completed **12 checks**, including ordinary Better Auth sign-in, actual route/API loading, replay POST 201, exact authorized source citations, all 13 displayed company facts, pending question, explicit synthetic Keep review persistence, refresh equality, diagnostics and a 390px mobile viewport without horizontal page overflow. It did not use the foreground desktop or call a model.

The original 3104 demo separately passed **11 read-only headless checks**. Its report and reviews were not changed by that smoke.

| Verification | Actual result |
| --- | --- |
| Focused pipelines | **462/462**, 24 files, including 54 real PostgreSQL repository tests |
| Focused web | **305/305**, 17 files, including 71 real PostgreSQL API/auth/company/demo/composition tests |
| Runtime safety | **12/12** |
| Total selected automated regression tests | **779 passed**, zero failures or skipped tests |
| Full web TypeScript from clean checkout | Passed |
| Scoped TypeScript/React ESLint from clean checkout | Passed, zero warnings/errors |
| Changed-code/config formatting | Passed |
| Node runtime/smoke syntax | Passed |
| Clean-checkout browser | 12 checks passed; 8 actual screenshots |
| Original demo browser | 11 read-only checks passed |
| Fresh live AI | **Not run in this publication task**; recorded Azure gpt-6-luna-2026-09-22 response remains clearly labeled |

Exact selected-suite commands/logs are under the original demo checkout's ignored `test-output/vantage-publication/focused-final-20261026201601372/`. Clean-checkout screenshots, exact Architecture and saved report are under the clean checkout's `test-output/vantage-context-demo/headless-clean-1/`. Original-demo smoke artifacts are `test-output/vantage-context-demo/headless-phase1-readonly-2/`.

To rerun the headless clean fixture (review writes are explicitly blocked on 3104):

```powershell
pnpm.cmd --filter @launchstack/web exec playwright install chromium
node apps/web/scripts/vantage-context-demo-smoke.mjs --base-url http://localhost:3105 --credentials test-output/vantage-context-demo/runtime/credentials.json --output test-output/headless-new-run --replay --review --confirm-disposable-fixture
```

## Replay provenance and limitations

The committed fixture retains the actual rich model response, original exact refs, model/date and binding signatures, without credentials or provider request IDs. Only citation identities are rebound to newly seeded native IDs, after exact document-content signatures and complete company fact/review/unknown signatures match. Current source versions/hashes/actor ACLs remain authoritative. The real context adapter validates the envelope; the normal final commit guard revalidates sources/permissions/native state. Changed, missing, revoked or unrelated fixtures cannot reuse this report.

Replay is intentionally limited to the recorded week, matching roles, six selected sources and matching weekly evidence. It is not generation for arbitrary input. Its native branch uses Rules; report prose stays in explicitly labeled demo-only encrypted metadata storage. Suggestions are not commitments. Profile status is **unreviewed**, personnel and hierarchy remain unknown, and the fictional review exercise is not actual approval.

No fresh OS/virgin hardware was tested: this was a clean Git checkout with a fresh separate PostgreSQL volume and fresh installed dependency tree on the existing Windows machine. Headless Chromium was available locally. Registry access and the Docker image are installation prerequisites. The default 55437 resource-creation path shares the tested same parameterized implementation; the new-volume execution used 55438 to preserve tonight's environment.

Non-blocking existing Next development warnings mention multiple LangChain versions/optional Ollama external resolution and stale Browserslist data. The route, APIs and browser checks succeeded despite them; no dependency upgrades were made for this task. A production build/full-repository suite was not run. This branch does not activate production V0 generation.

The outgoing history was scanned for known local credentials and token/private-key patterns before ordinary non-force publication. Generated credentials, databases, logs and screenshots remain ignored. The original checkout's unrelated 17 dirty-file contents were protected. Joseph integration must start only after remote checkpoint verification and use a separate branch.
