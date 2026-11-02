# Vantage Joseph + Sophia offline integration - 2026-11-02

**Offline integration is verified; a complete provider/model E2E pass is not claimed.** All Generation responses in this new composition are explicitly hand-authored synthetic fixtures. No live Generation or Validation model was called. No database, authentication rule, migration, stable demo, original experiment output or remote branch was changed.

## Revisions and isolation

- Worktree: `C:/Users/junku/.codex/worktrees/9499/LaunchStack`.
- Local branch: `integration/vantage-joseph-sophia-eval-20261102`.
- TL/local baseline: `284a5dc9ed6c5f65e2f9e0620107f7e0d33d1656`.
- [Joseph PR #561](https://github.com/Deodat-Lawson/LaunchStack/pull/561): `josephlongbui-stack/LaunchStack`, `feat/joseph-vantage-context-v0`, pinned `3afeb35dbefc817dfc9a7ea887c94424a047d061`.
- [Sophia PR #582](https://github.com/Deodat-Lawson/LaunchStack/pull/582): `TongyeZ/LaunchStack`, `sophia-vantage-retrieval`, pinned `2b0ce19fcf34f33d87d97276ad6c247c58abb4dd`.
- Both PRs declare base `364a3c8bd3b1c5bb2ee45cf66c1ea608b3c44618`; bounded first-parent chains from both heads to that commit were verified and saved.
- Earlier Sophia commit `c6eb63c6a6d6705b60a6ccec8bcba7704fee3532` was already in the TL implementation. It was not applied twice and PR #557 was not independently integrated.

The original root, dirty UI worktree `514f`, dirty experimental `1c46`, and old demo checkouts remain separate. Ports 3104 and 3111 had no listener at inspection; no server was started, stopped or replaced for this task. The local repository has a pre-existing missing older object `4fa4231cd1bfd5add45a5338bfb80eb1dd9ea3f1`; full `git merge-base` fails. This was not repaired or concealed. PR ancestry within the declared base-to-head ranges and exact file snapshots were verified without rewriting history.

## Integration scope and conflicts

The existing Joseph role mapper/provider/context adapter and base fixture are byte-identical to the relevant PR implementation. Imported Joseph's new 15-case boundary fixture, five semantic cases, README and tests. Preserved the TL's additional strict unreviewed-company gate test rather than replacing its provider test with Joseph's older version. Joseph's newer PostgreSQL/authenticated API/UI/migration host delta is **not ported or activated in this bounded offline composition**; the simulated host is explicit.

Integrated Sophia's follow-up retrieval changes and entire final-output evaluator. Exact import hashes and three-way intermediate files are in `integration-provenance.json` and `merges/` under the artifact root.

- `pipelines/package.json`: actual three-way file merge produced three conflict hunks. Resolved by JSON-key union of the TL baseline, Joseph role exports, Sophia validator exports/publish entries/scripts, then added the two offline integration scripts. No dependencies/lockfile changed.
- `pipelines/src/vantage/README.md`: raw whole-file conflict came from line endings; LF-normalized three-way merge succeeded, retaining the TL documentation and Sophia follow-up. No semantic content was discarded.
- Remaining retrieval files merged cleanly. TL's Company Architecture re-export and all frozen V1 contracts/generation code remain unchanged.

## Component compatibility

| Component                        | What executes here                                                       | Status / limitation                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Joseph roles                     | Real controlled role directory and mapper                                | All roles retained; unconfirmed synthetic declaration, never an ACL grant                                     |
| Personal/required context        | Existing V0 validation and required-source selection contracts           | Actor, company/mandatory/star records and state ports are synthetic; new Joseph PostgreSQL APIs not exercised |
| Sophia retrieval                 | Actual `runDynamicContextV0` and Dynamic Retrieval provider              | Deterministic authorized synthetic catalog/metadata; no vector service or public research tool                |
| TL registry/manifest/snapshot    | Actual trusted registry, assembler, content hashes and freeze validation | Every supplied exact source/version/excerpt retained in evaluator context                                     |
| Context-aware generation adapter | Actual envelope and exact-citation guards                                | Canned contextual report; empty Rules carrier only for frozen V1 compatibility, explicitly not AI output      |
| Final persistence guard          | Actual actor/version freshness checks                                    | Mock transaction, no database; not validator-gated production persistence                                     |
| Sophia evaluator                 | Actual input parsing, integrity checks, no-judge handling and reports    | Semantic judgments unavailable; source IDs do not establish entailment                                        |
| V2.1 evaluation                  | New isolated bridge retains all added fields and role provenance         | Supplementary transport, not a production generation path or calibrated score                                 |

Research explicitly STOPs, so all five manifests are `partial`. This is preserved, not relabeled complete. Source permissions are assigned explicitly by the synthetic catalog: required fixture documents use the company-audience mandatory lane; other scenario documents are actor-private. Joseph supplied no ACL records, so these are declared test assignments, not widening of real private sources. Existing validators are unchanged.

## Joseph boundary scenarios

15/15 scenarios passed plus the unique-ID check: 16/16 tests. Real policy/registry/assembly/generation-adapter boundaries execute; retrieval responses and generator results in this upstream suite are simulated.

| Scenario                    | Actual result | Boundary / HTTP            |
| --------------------------- | ------------- | -------------------------- |
| baseline                    | PASS          | canned generation accepted |
| aliases-and-multiple-roles  | PASS          | canned generation accepted |
| unknown-title               | PASS          | canned generation accepted |
| empty-title                 | PASS          | canned generation accepted |
| role-prompt-injection       | PASS          | canned generation accepted |
| missing-required-source     | PASS          | required / 409             |
| revoked-personal-star       | PASS          | required / 403             |
| cross-company-retrieval     | PASS          | retrieval / 409            |
| wrong-private-audience      | PASS          | retrieval / 409            |
| stale-document-version      | PASS          | retrieval / 409            |
| future-evidence             | PASS          | retrieval / 409            |
| retrieval-excerpt-tampering | PASS          | canned generation accepted |
| retrieval-timeout           | PASS          | canned generation accepted |
| invented-citation           | PASS          | generation / 403           |
| wrong-citation-version      | PASS          | generation / 403           |

Seven scenarios accept a canned generation, six block before generation, two reject a canned generation's invented/stale citation. Tampered retrieval text is replaced by the trusted catalog excerpt. Timeout remains timeout and STOP research remains partial. These results are not a model-reasoning score.

## Joseph-to-Sophia semantic pass

`prepareJosephScenario` produces a bounded gold-free context. IDs, source document text/date/required flags/order are pinned to Joseph's exact fixture. Original source IDs remain visible alongside exact versioned V0 refs. Missing versions/timestamps/actor metadata are explicitly adapter-assigned synthetic values (`synthetic-v1`, cutoff `2026-10-19T12:00:00.000Z`). Controlled role variants are labeled and never human-confirmed.

Only after the generation test boundary does `buildJosephEvaluation` attach the unchanged original checklists, stable split IDs, exact source quotations and adapter-assigned importance labels. Mixed positive/negative statements are separated; original checklist text/index/ID remains in the provenance sidecar. Roles are retained both in the sidecar and clearly labeled evaluation-only title metadata, because Sophia's strict v1 schema has no role field. No gold enters the generation envelope.

The evaluator receives all authorized evidence-snapshot excerpts, including the three explicit synthetic control sources. `contextCompleteness` is `excerpted`, not a claim to know a complete workspace. Source/role fingerprints bind the evaluation projection separately from its original adapter input.

| Semantic case                     | Scenario documents | Split expectations | Citation errors | Semantic outcome       |
| --------------------------------- | ------------------ | ------------------ | --------------- | ---------------------- |
| instruction-inside-document       | 1                  | 4                  | 0               | needs-review; no judge |
| conflicting-metrics               | 2                  | 3                  | 0               | needs-review; no judge |
| missing-denominator               | 1                  | 3                  | 0               | needs-review; no judge |
| mixed-currencies-and-periods      | 2                  | 3                  | 0               | needs-review; no judge |
| negation-and-old-mandatory-policy | 2                  | 3                  | 0               | needs-review; no judge |

**Denominators:** five valid conversions; zero deterministic citation-integrity errors; 16 expectations supplied, **0/16 semantically assessed**; six metric dimensions per report all null; five `needs-review` verdicts, zero quality passes/failures. Coverage, precision/recall, entailment and reasoning quality cannot be inferred from these results. The outputs are authored to exercise the adapters, not independent evidence that the Generation model behaves correctly.

Examples from the preserved synthetic output fixtures:

- Injection: retain the rollback-plan requirement; embedded text does not establish approval or authorize disclosure. No broad private-data non-disclosure claim is inferred from this one fixture.
- Revenue: keep provisional USD 12,000 and USD 18,000 including unsigned opportunities distinct and ask for reconciliation.
- Signup counts: retain B=12/A=8, request visitor counts/allocation/window; 50% more signups would not establish 50% higher conversion or statistical significance.
- Currencies/periods: retain October booked USD and September collected EUR separately; no invented 20,000 total or growth rate.
- Old policy/negation: retain January's required rollback-owner policy and the current explicit NOT-approved/unassigned-owner statement; do not invent a recorded formal blocking decision.

Four additional integrated negative checks block missing/revoked required context before generation, reject a changed output citation version, and reject actor ACL changes before mock persistence. Blocked cases have no manufactured final evaluation report.

## Sophia validation and V2.1

Sophia's 48 tests pass. Its recorded demo reproduces five expected outcomes: **two passes and three failures**. These are pinned hand-authored `fixture-replay` judgments, not fresh model or independent human evaluation. They are stored separately from the five Joseph no-judge results.

The existing normalizer silently discarded `headline`, `brief`, `keyFigures`, `whyNow`, and recommendation `call`, `because`, `wouldChangeIf` (also confidence/refs). The bounded `adaptV21Evaluation` bridge:

- Preserves these exact fields, role metadata, references and fingerprints in a versioned sidecar.
- Makes their text visible to Sophia through separately labeled evaluator-only enhancement units; the worked example contains nine units.
- Keeps factual, recommendation, temporal-relevance and presentation categories separate in sidecar metadata.
- Requires exact source-version bindings; never invents citations for headline/brief fields with no explicit refs.
- Rejects substituting a different legacy report body under the same candidate identity.
- Keeps original V1/native/report objects unchanged. No production schema or Generation prompt is modified.

The V2.1 worked example is explicitly hand-authored presentation/adapter data. Supplementary scores remain null without a judge and require separate calibration even after a judge is approved. Sophia's 0-100 rubric is **not compared to the historical 18.6/20 benchmark**.

Candidate D's archived experiment/policy and the uncommitted V2.1 generator/schema in `1c46` were audited read-only and hashed in `local-generation-audit.json`. They were not rerun, regraded, silently imported or represented as fresh model outputs. Detailed field mapping: `docs/design/vantage-v21-evaluation-compatibility.md`.

Independent review found and closed two medium defects: modified documents retaining pinned source provenance, and a V2 body accepting a reused candidate ID. Red/green reproductions are retained. Follow-up probes verified rejection and confirmed every evaluator source ID/version/text equals the authorized snapshot.

## Verification and reproduction

Environment: Node `v24.19.0`, pnpm `10.15.1`. Exact lockfile installation ran with lifecycle scripts disabled and no network:

```powershell
Set-Location 'C:\Users\junku\.codex\worktrees\9499\LaunchStack'
pnpm.cmd install --frozen-lockfile --ignore-scripts --offline
pnpm.cmd --filter @launchstack/pipelines test src/vantage/context-v0/pipeline-edge-cases.test.ts --exclude 'test-output/**'
pnpm.cmd --filter @launchstack/pipelines test:validation --exclude 'test-output/**'
pnpm.cmd --filter @launchstack/pipelines demo:validation
pnpm.cmd --filter @launchstack/pipelines test:retrieval --exclude 'test-output/**'
pnpm.cmd --filter @launchstack/pipelines demo:retrieval --json
pnpm.cmd --filter @launchstack/pipelines test:integration --exclude 'test-output/**'
pnpm.cmd --filter @launchstack/pipelines test src/vantage --exclude 'test-output/**'
pnpm.cmd --filter @launchstack/pipelines typecheck
pnpm.cmd exec eslint pipelines/src/vantage/evaluation-integration pipelines/src/vantage/validation pipelines/src/vantage/dynamic-retrieval pipelines/src/vantage/context-v0/pipeline-edge-cases.test.ts
pnpm.cmd --filter @launchstack/pipelines demo:integration
```

The default integration CLI chooses a new timestamped artifact directory; an explicit `--output-dir ABSOLUTE_NEW_DIRECTORY` is also supported. Existing directories/files are refused, never overwritten. No live flag exists. The command's success means offline boundary execution completed, **not a semantic-quality pass**.

Validation results:

- Joseph boundary: 16/16 tests (15 scenarios).
- Sophia validation: 48/48 tests.
- Retrieval-focused suite: 187/187; includes the Joseph checks, so do not double-count it.
- Retrieval demo: six/six assertions.
- New adapters/composition: 49/49 tests across three files (26 Joseph, 14 V2.1, nine combined).
- Full relevant Vantage Pipeline regression: 597 passed, zero failed, **54 opt-in PostgreSQL tests skipped** in `repository-v1.integration.test.ts` because no test database was enabled. No real PostgreSQL acceptance is claimed.
- Pipeline TypeScript, focused TypeScript ESLint and diff checks passed. CLI JavaScript is ignored by the repository ESLint configuration, so both CLI files were checked with `node --check` separately.
- Root pnpm/React/pages-detection notices remain; no source lint errors. Lockfile and dependency versions unchanged.

Artifact root: `C:/Users/junku/.codex/worktrees/9499/LaunchStack/test-output/vantage-joseph-sophia-eval-20261102/run-001/`.

- `integration-provenance.json`, `merges/`: pinned imports, ancestry and actual conflict records.
- `upstream/upstream-summary.json`, `upstream/joseph-15-scenario-results.json`: counts, commands, durations, stage results.
- `upstream/validation-demo/`: recorded evaluator demo, clearly separate.
- `integrated-verified/`: final per-case gold-free input, manifest, snapshot, synthetic output, role/source provenance, evaluator input/report, source/code hashes; negative-boundary and V2 supplementary reports.
- Test/typecheck/lint logs, Vitest JSON and independent-review red/green files remain in the root.
- Earlier `integrated/` and `integrated-final/` attempts are retained separately; they are not the final artifact/code snapshot.

## Remaining gaps and next experiment

| Severity                   | Gap                                                                                                          | Required next step                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| High for deployment        | New Joseph PostgreSQL/auth APIs and real canonical source host are not connected in this offline composition | Reconcile migration history in a separately authorized isolated DB; use authenticated actor/document ACL/version adapters, not these fixture ports |
| High for live E2E claim    | Generation responses and persistence are simulated; Candidate D/V2.1 model reasoning is untested here        | Freeze the chosen real generator/configuration and connect the actual provider boundary in a separate opt-in harness                               |
| High before paid execution | No shared live provider-call budget implementation is enabled in this intentionally offline CLI              | Approve and enforce a single attempt-counting cap across Generation and Validation; no silent retries/repairs                                      |
| Medium                     | Sophia semantic rubric/importance weights and V2 transport are uncalibrated                                  | Independent review of scenario gold and evaluator judgments; keep factual validity, recommendation value and presentation scores distinct          |
| Medium                     | No validator-gated production persistence or real PostgreSQL regression                                      | Preserve existing guarded commit; separately design/review final evaluation gate and exercise real scoped state changes                            |
| Low for this test          | Missing older Git object and root tooling notices                                                            | Reconcile complete Git history and workspace tooling before a shared merge; do not reset or force-push                                             |

The fixtures and offline bridges are ready to support a **separately approved** small live experiment, but this branch is not itself a live E2E or production activation. A reasonable future proposal is five Generation plus five Validation calls under one hard cap of ten total attempts, with failures counted and automatic retries disabled. That proposal is not authorization and no such calls were initiated.
