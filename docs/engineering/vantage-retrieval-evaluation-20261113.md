# Vantage offline retrieval evaluation

## Implemented boundary

The local Phase 3 engineering harness and controlled A/B/C/D replay are implemented. Enterprise semantic evaluation requires Joseph-owned judgments and Sophia's independent review. No authoritative semantic labels were added.

`pipelines/src/vantage/retrieval-evaluation.ts` exports `evaluateRetrievalOffline`. Candidate slots are `A-production`, `B-budget-v1`, `C-exact-sophia-lexical`, and `D-scoped-candidate`. Each callback carries a pinned implementation identity. The evaluator retains an immutable manifest with corpus, cutoff, query, budgets, exact sources and optional private judgments.

Candidate callbacks receive an explicit cloned, deeply frozen `RetrievalCandidateInput` projection. The type excludes `gold`. Runtime projection also excludes evaluator judgments and unrecognized top-level or per-source metadata. Changing a gold revision or critical labels leaves candidate-visible input identical. The manifest retains evaluator-only labels for reproducibility in the private evaluation artifact.

Every corpus body is bound to a lowercase SHA-256 of its actual UTF-8 text. Stale bodies, forged hashes, duplicate IDs, unauthorized companies and unavailable versions fail before callbacks. Eligibility defaults to `availableAt <= cutoff`, matching current V1 collector behavior. An explicit exclusive cutoff remains available. The corpus's authorization and version-availability assertions must originate in a trusted snapshot adapter for a future database-backed evaluation.

Callbacks return acquired IDs separately from ordered selected exact references. Invalid outputs retain all violations, including unauthorized IDs, duplicates, unacquired selections, version/hash/citation mismatches and resource overruns. Their quality metrics are null. Successful empty retrieval and callback failure remain distinct.

Each callback receives an AbortSignal. An asynchronous deadline race aborts and stops waiting for a hung callback, then continues comparison. Underlying work must cooperate with cancellation. Synchronous JavaScript needs process-level preemption. The harness audits declared acquisitions and selected UTF-16 text characters. It cannot establish SQL or heap bounds for an arbitrary injected callback. The real collector retains its own SQL, bytes, count and deadline limits.

## Measurements and gold isolation

CriticalEvidenceRecall@K counts explicitly labeled critical IDs in the first K selections. Mandatory coverage counts explicitly labeled mandatory IDs anywhere selected. Optional relevance@K uses explicitly labeled optional selections as its denominator. Decision evidence coverage requires every labeled evidence ID for each decision. Missing labels, absent categories, provenance `none`, or empty denominators remain `unverified` with null values.

Synthetic test judgments are explicitly provisional. The runner supplies no semantic gold for Orbit. Configured Required Context coverage is separately recorded as 6/6. This configuration count establishes requirement inclusion. Semantic sufficiency, fact entailment and final decision quality remain unmeasured.

## Actual controlled replay

`node node_modules/tsx/dist/cli.mjs scripts/eval/vantage-retrieval-offline.ts test-output/vantage-retrieval-evaluation-20261113/actual-abcd.json` runs from the repository root. It performs zero provider, embedding, network or database calls.

The original `apps/web/__tests__/server/fixtures/vantage-budget-orbit-v1.json` remains unchanged. All original version hashes are checked. The company has 28 documents, 29 versions, and 27 readable versions eligible at the historical cutoff `2026-10-26T00:00:00.000Z`. The manifest SHA-256 is `a5e00899fddf79d76a62509f951045fefd49dd4b0d370b9616c86eb6bfb4d695`.

A and B execute the actual application authority collectors through a deterministic relational query fake extracted from the existing acceptance fixture. Every unrecognized query fails. Acquisition counts describe distinct body reads requested by each callback, while the evaluator manifest is already materialized in memory for all 27 eligible sources. This establishes actual collector control flow against a controlled adapter. PostgreSQL execution is separately tested by the scoped service acceptance suite.

C invokes the exact exported Sophia PR #602 selector at `d53cefc7c048dbaecc5d1eee387686211570f082`. All eight files are verified against the existing source manifest before import. `retrieve.ts` SHA-256 is `a931ccdcd275406595202cd01c78f43db462b4552068f9fa8a5172fc23e76ead`. Set `VANTAGE_SOPHIA_SOURCE_ROOT` to an equivalent verified export for another machine. A missing export fails explicitly.

C preserves the same six configured company sources and four Stars, ranks only optional evidence, and applies the same V1 runtime budget to each ranked admission. It uses the actual lexical selector with its supplied authorized catalog. It does not invoke a registered RAG search port. Its confirmed Operations-lead role is an explicitly hypothetical offline condition, separate from the fixture's workspace-membership role. Metadata uses document titles, categories and exact version dates. The adapter creates no historical open/resolved state from current timestamps or free text.

D enables the actual scoped collector with the original Orbit configuration. Orbit contains no approved finite scope. D therefore retains whole-document selection and matches B. The runner never changes Orbit's policy or silently slices its required documents.

| Candidate                                     | Acquired distinct bodies | Selected sources | Configured required | Serialized Generation data bytes | Selected text characters |
| --------------------------------------------- | ------------------------ | ---------------- | ------------------- | -------------------------------- | ------------------------ |
| A actual default collector                    | 16                       | 16               | 6/6                 | 8084                             | 3736                     |
| B actual budget V1 collector                  | 27                       | 16               | 6/6                 | 8084                             | 3736                     |
| C pinned Sophia lexical plus budget admission | 27                       | 15               | 6/6                 | 7542                             | 3435                     |
| D actual scoped-enabled, no Orbit scopes      | 27                       | 16               | 6/6                 | 8084                             | 3736                     |

A and B select the same exact reference set with different order. D matches B. Every candidate preserves architecture, rollback policy, release criteria, release update, security, privacy, Finance, Sales, experiment and embedded-instruction sources.

A/B/D optional selections contain roadmap, engineering, QA defects, operations readiness, announcement and demo plan. C selects roadmap, operations readiness, engineering, demo plan and prior decision. C omits QA defects and announcement under this ranking/budget condition. The report retains every ranked omission with its budget reason. These observed differences support review of trade-offs. Relevance and decision-quality gains require independent labels.

The 12000-byte Generation data limit, 14000-byte evaluation/Judge data limit, 16-source limit and 6000-character per-source limit remain the application constraints. A uses the production legacy reserve. B/C/D use the 2800-byte useful-report reserve. Per-candidate artifacts retain the complete deterministic budget, selected IDs/versions and serialized payload measurement. These byte measurements exclude HTTP framing, system prompts, tool/schema transport and model-token billing.

Each callback records one local elapsed sample. Cold/warm state is uncontrolled. The recorded values support debugging only. No P50, P95, provider latency or monetary cost is inferred.

## Separate long-source capacity case

A distinct provisional controlled fixture contains one 33023-byte parent with 129 chunks. Its SHA-256 is `fb46c7697fd6f2f255a40a29797fb81e7577dee2e7fe66f0164feff910575dd4`. A host-owned explicit administrator grant approves the first 2000 UTF-16 characters as its finite required scope.

Whole-parent preflight fails the application input/evaluation/report-reserve limits. Scoped V2 preflight succeeds under the same outer Generation/Judge/source limits and 2800-byte reserve. The scoped Generation data is 4904 bytes. Coverage remains `relevant_spans_reviewed`, with one required unit included and original completeness `unknown`.

This is mechanical capacity evidence for an explicitly changed required scope. It does not establish semantic equivalence to whole-parent review. Its corpus, authorization and result are stored separately from the unchanged Orbit comparison.

## Executed verification

On 2026-11-13, the focused evaluator suite passed 18 tests with zero failures. It covers provisional metric arithmetic, missing labels/categories, empty retrieval, callback failure/deadline continuation, ACL/cutoff rejection, exact citation/version/hash checks, stale corpus hash rejection, acquisition/character limits, duplicates, frozen input/output isolation and gold-blind callback input at both type and runtime boundaries.

Focused strict TypeScript checking of the evaluator and test passed. The runner typecheck uses existing web compiler settings plus an in-memory current-worktree pipeline source mapping, with zero diagnostics. The runner executed successfully with four valid candidates and the separate whole-fail/scoped-pass capacity assertions. Formatting checks cover the owned files. Owned evaluator-file ESLint passed. The repository ignores scripts by default, so runner lint used an ignored temporary project that explicitly includes this file. Initial explicit runner lint exposed unsafe JSON/module inference. Named inspected fixture/module interfaces corrected those findings. The final explicit lint passed with zero file errors or warnings. Root tool settings still emit their existing React/pages environment notices.

Artifacts remain private and ignored under `test-output/vantage-retrieval-evaluation-20261113/`. They include `harness-tests.json`, `actual-abcd.json`, and the bounded runner typecheck script. Source hashes in the replay artifact pin the inspected collectors, budget/core modules, and runner. Refresh the replay after changes to those files.

## Next adoption gate

Keep all production defaults unchanged. Obtain Joseph's frozen representative corpus and authoritative evidence/decision labels. Have Sophia independently review labels before tuning. Run the same authorized corpus, role condition, cutoff and payload budgets through database-backed A/B/C/D adapters, retain failures, then assess semantic coverage and final decision quality separately. Live provider evaluation requires separate authorization. Gold revision must remain invisible to every selector.
