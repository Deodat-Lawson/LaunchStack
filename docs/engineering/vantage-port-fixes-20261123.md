# Vantage port audit fixes

Base revision `6c157e65`. Reviewed against the November 23 port audit.

## Verified fixes

1. Generation and Judge enforce inclusive 200,000-byte and 240,000-byte limits on the final serialized UTF-8 messages, including roles, schema instructions, and endpoint instructions. Dispatch is recorded only after the limit check. The default structured-attempt path preserves its existing 24,000-byte content check. Injected fetch tests exercise both stage boundaries, overflow, cancellation, and single-attempt transport behavior. The settings preview now uses the topic-first budget. Scoped tests admit 80,000 evidence bytes across 16 authorized units and reject 80,001 bytes.
2. The reusable topic-step authority check reloads Beta, actor, capabilities, epoch, and pinned source identity, audience, and hash. Digest preparation, retained exploration tools, and every exploration model request use it. An injected mid-run revocation stops tool data and subsequent provider calls and records `topic_authority_revoked`.
3. Removed the review-to-commitment button, dialog, state, prefill, and strings. UI tests cover its absence and recording a review decision. The existing Commitments feature stays available.
4. Shared legacy agenda history applies the direct reader's creator and source policy. The rail withholds the unsupported open and delete actions. Generic deletion returns the direct route's `review_history_retained` result. Tests cover authorized history, withheld summaries, and the retention conflict.
5. Evidence reads require read capability and allow creator-owned or explicitly shared manual captures. Edits and deletes require edit capability and creator ownership. Legacy document captures lack exact source bindings and are withheld. Metrics and observations retain company sharing with capability checks. Metrics listing is read-only and definitions can be created or imported explicitly. Retired endpoints return 410 after Beta and capability checks.
   - `POST /api/vantage/agendas/:id/topics`
   - `POST /api/vantage/agendas/:id/reorder`
   - `PATCH` and `DELETE /api/vantage/topics/:id`
   - `POST` and `DELETE /api/vantage/topics/:id/decide`
6. Exploration traces keep allowlisted metadata, version IDs, normalized ranges, and hashes. Failed runs have zero trace retention at terminal failure or uncertain expiry. History access clears older failed traces for that owner. Tests cover serialized trace contents and expiry.
7. Removed the unwired `SECRET_BOX_CURRENT_VERSION` and `SECRET_BOX_PREVIOUS_KEYS` settings from the example and runtime environment schema. Reports still use authenticated encryption with company, owner, and run AAD.

## Verified live Harborlight check

Ran the production build against disposable PostgreSQL and the existing Azure deployments. The temporary Azure profile used `gpt-6-luna` for digest, exploration, and Generation, and `callnotes-summary` (`gpt-5-mini-2025-08-07`) for Judge at `reasoning_effort: low`. Luna tool calls used effort `none`. Generation used effort `none` and Azure native JSON Schema derived from the report contract. Judge used JSON-object mode. App validation and admission ran normally.

The original required and watched documents formed the four-document scope. Run `229cd7c7-4070-45e9-956e-4076787eb8ba` was accepted in 63.5 s. The active pointer and exact source hash matched on readback, and the decision was present after reload at version 2. The 12-document case reached Judge with 63,081 message bytes and received an Azure token-rate 429 before admission.

The 14-unit stress case froze 74,255 bytes of evidence from Harborlight Long with escaped synthetic archive metadata and an original optional document. Run `aeffc793-63e4-479b-a684-a21f63d572f4` sent 193,071 Generation message bytes, 96.5% of the cap. Azure returned HTTP 200. The app returned `candidate_not_admitted` in 44.5 s before Judge dispatch. The failed run had no ciphertext and its trace was cleared.

| Case | Stage | Calls | Provider seconds¹ | Input tokens | Output tokens | Estimated USD | Largest message bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary | Digest | 2 | 17.89 | 774 | 1,800 | 0.00097740 | 1,919 |
| Ordinary | Exploration | 3 | 5.67 | 9,507 | 356 | 0.00070813 | 19,547 |
| Ordinary | Generation | 1 | 30.43 | 4,731 | 2,536 | 0.00174110 | 16,063 |
| Ordinary | Judge | 1 | 16.32 | 8,833 | 2,247 | 0.00670225 | 36,506 |
| Near limit | Digest | 1 | 7.54 | 403 | 719 | 0.00039980 | 1,850 |
| Near limit | Exploration | 3 | 6.32 | 10,583 | 320 | 0.00070341 | 16,920 |
| Near limit | Generation | 1 | 28.93 | 33,548 | 2,424 | 0.00456680 | 193,071 |
| Near limit | Judge | 0 | — | — | — | — | — |

¹ Sum of request durations. The ordinary run's measured digest and exploration wall times were 9.42 s and 6.60 s.

| Case | Azure requests | Requests with reported usage | Input tokens | Output tokens | Estimated USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary four-document review | 7 | 7 | 23,845 | 6,939 | 0.01012888 |
| Near-limit fixed-scope review | 5 | 5 | 44,534 | 3,463 | 0.00567001 |
| Earlier 12-document attempts | 75 | 72 | 170,232 | 60,742 | 0.04249838 |
| Earlier optional-backfill attempt | 20 | 20 | 87,601 | 6,390 | 0.00984982 |
| **Grand total** | **107** | **104** | **326,212** | **77,534** | **0.06814709** |

The stage table covers 12 Azure requests. The earlier attempts account for the other 95. Two of those were rejected without reported usage, and one transport failure left billing unresolved. The separate estimate for that request is at most USD 0.0063 at the higher reference rates used for post-tracking.

Rates used per million tokens were USD 0.10 uncached input, USD 0.01 cached input and USD 0.50 output for Azure GPT-6 Luna Global Standard short context. For `callnotes-summary`, the GPT-5-mini reference rates were USD 0.25 uncached input, USD 0.025 cached input and USD 2.00 output. The estimates use reported token counts. [Azure Luna pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/) · [GPT-5-mini pricing](https://developers.openai.com/api/docs/models/gpt-5-mini)

## Verification

- Workspace typecheck and final web typecheck passed. Workspace lint passed with 26 warnings and zero errors. The final localization-test update passed targeted lint.
- Package suites passed with 2,100 tests and one skip. The timing-sensitive Scenarios concurrency test passed on the isolated rerun.
- The full clean-environment web run passed with 9,960 tests in 794 suites, including auth and collab. It skipped nine tests in five suites, including the paid embedding evaluation. After the settings-preview fix, all 509 tests in the 45 selected Vantage and shared history suites passed.
- Chromium passed both creation settings with Beta on and off. The test waits for the decision POST and an independent persisted read before reload.
- `pnpm build` exited 0 in 247.7 s and generated 211 of 211 static pages. Build output included the existing DOCX import warning, the stale Browserslist warning, and an expected refused synthetic database probe.

## Unverified and separate work

- The original stress run left a generic post-Generation rejection in the service log. It ended before Judge. Injected transport tests covered both configured message ceilings.
- Azure invoice charges and the current management-plane deployment inventory were unavailable. The live profile was temporary and the tracked Azure configuration was restored.
- Pre-fix accepted traces were left untouched. The authority triggers are unchanged. Trigger contention remains a separate pre-merge gate.

## Failure records and retry follow-up

A forward product migration, `20261123220000_vantage_failure_attempt_accounting.sql`, adds the failure record and the provider-attempt ledger. Failed and expired runs keep a stage, allowlisted validator or Judge rule codes, numeric counts and provider status. Unknown counts are null. Failure finalization clears trace, ciphertext and key version. The current owner can view the record in the run list or at `GET /api/vantage/reviews/:id/status`. Provider-attempt metadata carries no prompt, excerpt or report content.

Digest, exploration, Generation and Judge opt into a maximum of two transport retries. Retry eligibility is limited to HTTP 429, HTTP 503 and verified connection establishment failures. A response with generated output, a partially read response or an invalid HTTP 200 is terminal for that call. Each physical attempt is checked against the applicable input limits and authority, journaled before sending and settled with the available usage. Retry-After and cancellation apply within the existing stage deadlines and the 540-second sum of those deadlines.

### Live reruns

Both fixtures were attempted once on disposable PostgreSQL with the same Azure profile. Each case ended before Generation, so neither was admitted.

- **12-document Harborlight** — run `85df138a-977f-48ec-9502-afc822e1a96e` returned HTTP 409 with `review_concurrent_update` during digest preparation. The immediate owner status was `reserved` and had no failure record. Three digest calls had already gone out. Their app journal outcomes were aborted, and Azure later returned three HTTP 200 usage records. This exposed a race in the new journal's concurrent run-row transactions.
- **14-unit near-limit fixture** — run `017515e1-11dd-4aae-bf73-99ad43c46dce` returned `topic_exploration_failed:provider`. The upstream connection reset with `ECONNRESET` after 105 ms. The relay returned HTTP 502 to the app. Azure's acceptance of the request was unresolved, so the attempt was ineligible for retry. The owner list and status API agreed on the retained failure record. It showed stage `exploration`, 13 fixed units, 73,072 evidence bytes, 4,533 prepared message bytes, two physical attempts and one provider failure. Citation counts were null because validation had yet to run. The trace and ciphertext were both cleared.

| Case | Physical Azure requests | Requests with usage | Input tokens | Output tokens | Estimated USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| 12-document Harborlight | 3 | 3 | 1,172 | 2,810 | 0.00152220 |
| Near-limit fixture | 2 | 1 | 403 | 957 | 0.00051880 |
| **Follow-up total** | **5** | **4** | **1,575** | **3,767** | **0.00204100** |

The first case's calls were all digests. The near-limit case sent one digest and one exploration request. Results are attributed by attempt ID, including the three digest responses that arrived after the first run ended. One response had unresolved usage. Its separate higher-rate estimate is up to USD 0.00706710. The same per-model rates listed above apply to the follow-up. Cap monitoring used higher reference rates per million tokens, with no cache discount. Those were USD 0.30 input and USD 0.90 output for Luna, and USD 0.35 input and USD 2.80 output for GPT-5-mini. [Azure Luna pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/) · [GPT-5-mini reference rates](https://developers.openai.com/api/docs/models/gpt-5-mini)

### Journal concurrency correction

The disposable PostgreSQL regression reproduced the 12-document failure. Five of eight concurrent starts exhausted the existing SERIALIZABLE retries, and the test suite observed 22 SQLSTATE `40001` errors. The fix queues start, settlement and terminal-failure transactions per run within its authoritative repository instance. Across instances, the existing database fences still apply. In the green run every start and settlement completed, failure retained its counts and cleared trace, and a queued request respected its deadline. PostgreSQL reported zero serialization failures in the test. The test held no database transaction across a provider call.

The two authorized live reruns preceded this correction. Live admission with the corrected journal, live HTTP 429/503 retry behavior, and the original near-limit post-Generation rejection cause remain unverified. Prompts, validator rules and limits were kept as they were.

### Follow-up verification

- `pnpm typecheck`, `pnpm lint` and `pnpm build` passed. Lint reported 26 warnings and zero errors. The production build generated 211 of 211 static pages.
- The affected package suites passed 1,338 tests across 99 files, with one skip. Pipelines passed 1,146, LLM passed 180 and Store passed 12.
- The affected web suites passed 590 tests across 53 suites, including three concurrency tests against disposable PostgreSQL. Injected fetch tests covered HTTP 429 with and without Retry-After, HTTP 503, retry exhaustion, cancellation during backoff, per-attempt byte checks and terminal HTTP 200 parse or validation failures.
- The product and engine migrations applied on fresh disposable databases. The second run was a no-op, and the new product schema passed catalog parity and constraint checks.
