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

| Case | Stage | Calls | Provider seconds¹ | Input tokens | Output tokens | Est. USD | Largest message bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary | Digest | 2 | 17.89 | 774 | 1,800 | $0.00098 | 1,919 |
| Ordinary | Exploration | 3 | 5.67 | 9,507 | 356 | $0.00071 | 19,547 |
| Ordinary | Generation | 1 | 30.43 | 4,731 | 2,536 | $0.00174 | 16,063 |
| Ordinary | Judge | 1 | 16.32 | 8,833 | 2,247 | $0.00670 | 36,506 |
| Near limit | Digest | 1 | 7.54 | 403 | 719 | $0.00040 | 1,850 |
| Near limit | Exploration | 3 | 6.32 | 10,583 | 320 | $0.00070 | 16,920 |
| Near limit | Generation | 1 | 28.93 | 33,548 | 2,424 | $0.00457 | 193,071 |
| Near limit | Judge | 0 | — | — | — | — | — |

¹ Sum of request durations. The ordinary run's measured digest and exploration wall times were 9.42 s and 6.60 s.

Across all attempts, 104 of 107 Azure requests reported usage, totaling 326,212 input and 77,534 output tokens for an estimated $0.06815. Two requests were rejected without usage, and one transport failure left billing unresolved. The operational estimate for that request is up to $0.0063 at higher reference rates. Billing estimates use observed token counts, Azure's Luna Global Standard short-context rates, and the public GPT-5-mini rates as a reference. [Azure Luna pricing](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/) · [GPT-5-mini pricing](https://developers.openai.com/api/docs/models/gpt-5-mini)

## Verification

- Workspace typecheck and final web typecheck passed. Workspace lint passed with 26 warnings and zero errors. The final localization-test update passed targeted lint.
- Package suites passed with 2,100 tests and one skip. The timing-sensitive Scenarios concurrency test passed on the isolated rerun.
- The full clean-environment web run passed with 9,960 tests in 794 suites, including auth and collab. It skipped nine tests in five suites, including the paid embedding evaluation. After the settings-preview fix, all 509 tests in the 45 selected Vantage and shared history suites passed.
- Chromium passed both creation settings with Beta on and off. The test waits for the decision POST and an independent persisted read before reload.
- `pnpm build` exited 0 in 247.7 s and generated 211 of 211 static pages. Build output included the existing DOCX import warning, the stale Browserslist warning, and an expected refused synthetic database probe.

## Unverified and separate work

- The stress run's exact post-Generation rejection reason was unavailable in the service log. The live stress case did not reach Judge. Injected transport tests covered both configured message ceilings.
- Azure invoice charges and the current management-plane deployment inventory were unavailable. The live profile was temporary and the tracked Azure configuration was restored.
- Pre-fix accepted traces were left untouched. The authority triggers and migrations are unchanged. Trigger contention remains a separate pre-merge gate.
