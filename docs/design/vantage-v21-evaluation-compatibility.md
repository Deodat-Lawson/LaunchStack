# V2.1 output compatibility with Sophia evaluation

This is an offline, evaluation-only bridge in the isolated Joseph/Sophia integration worktree. It does not change frozen V1, the Generation Agent, the public report DTO, Sophia's `vantage-evaluation/v1` schema, or any persistence/authorization path.

## Observed mismatch

Sophia's pinned PR #582 (`2b0ce19fcf34f33d87d97276ad6c247c58abb4dd`) accepts additional report properties in its normalizer but reconstructs V1-era fields only. Its `outputUnits` enumerates that reconstruction. The experimental V2 code was inspected read-only in `C:/Users/junku/.codex/worktrees/1c46/LaunchStack` at detached baseline `284a5dc9ed6c5f65e2f9e0620107f7e0d33d1656`; its V2 files and fixtures were uncommitted. No experimental generator code or dirty web changes were copied into this bridge.

The following additions were therefore lost by the original normalizer: `headline`, `brief`, `keyFigures`, `topics[].whyNow`, and `topics[].recommendation` including `call`, `because`, `wouldChangeIf`, `confidence` and exact `refs`.

## Bounded bridge

`pipelines/src/vantage/evaluation-integration/v21-adapter.ts` exports:

```ts
adaptV21Evaluation(raw, {
  input, // an existing validated vantage-evaluation/v1 scenario/candidate
  roleContext, // caller-supplied fixture or server role declaration
  sourceBindings, // optional explicit raw-alias -> exact typed V0 reference bindings
  roleMetadataAlreadyIncluded, // true only when caller already transports this same declaration in title
});
```

The return version is `vantage-v21-evaluation-bridge/v1`. It retains the exact original V2 additions, the role declaration, original/projection/context fingerprints, typed field units and explicit limitations. It also provides a separate `supplementaryInput` for the unchanged Sophia evaluator. Neither the supplied input, raw compound/native result nor original source documents/expectations are mutated.

The supplementary input reconstructs the V1-compatible part of the **V2 candidate**, then adds evaluator-only enhancement addresses for the added text. These are transport nodes, not new product suggestions, tasks or commitments. Never persist this projection as a Vantage report. Use the same original source documents and Gold only after generation; the bridge is not an input to the Generation Agent.

| Original field                                                  | Evaluation-only transport                                                                                   | Limits                                                                                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `headline`, `brief`                                             | Separate exact-text `idea` output units                                                                     | No explicit field citations exist in V2; support remains unassessed and no source IDs are invented                                        |
| `whyNow`                                                        | Exact-text `idea` output unit for its topic                                                                 | Temporal/relevance claim is exposed, not verified by transport                                                                            |
| Recommendation `call`, `because`, `wouldChangeIf`, `confidence` | Separate exact-text `idea` units, original recommendation refs                                              | These remain AI recommendations/uncertainty, never human decisions or completion                                                          |
| `keyFigures`                                                    | One `evidence` unit per full JSON presentation, including label/value/tone/derivation; original figure refs | Citation/version integrity is checked; arithmetic or semantic entailment is not established by this adapter                               |
| Business roles/primary/mapping provenance                       | Separate typed sidecar and labeled evaluation metadata in `scenario.title`                                  | Roles do not grant access or prove human confirmation; caller must distinguish synthetic declarations from authenticated production roles |

`idea` is solely a compatibility transport classification, not a statement that factual headline content is exempt from grounding. Sophia's rubric checks factual claims across all output units. The sidecar independently categorizes units as factual, recommendation, presentation or temporal/relevance. Key-figure inputs must use exact declared references belonging to that figure.

Raw model alias strings are never parsed heuristically into V0 or fake V1 citations. They require explicit host bindings to `{kind,id,version}`; normalized object refs work directly. Every bound key must equal `contextSourceKeyV0(ref)` in scenario documents, with matching `document.version`. This proves only identity, not source authorization or claim support; the upstream authorized context pipeline remains responsible for ACL/current-state checks. No document bodies are fetched.

Role metadata is supplied to the evaluator only, not to the generator. A clearly labeled metadata block is appended to the supplementary scenario title unless the caller declares it already present. The original title and the full role declaration remain in the sidecar, with a dedicated role fingerprint. If using `roleMetadataAlreadyIncluded`, the caller must pass the same role declaration already represented in the title; this flag does not independently authenticate it.

## Assessment boundaries

All bridge units start with `semanticStatus: unassessed`. Calling `evaluateVantage(supplementaryInput)` without a judge checks deterministic integrity but returns semantic ratings/coverage/overall score as null, expectation status unassessed and `needs-review` when citations are structurally valid. Preservation and evaluator visibility are not independent quality measurements.

The focused unit test includes an explicitly labeled fixture-replay judge to prove that Sophia accepts citations to new-field output addresses. Its hand-authored scores are test data, not live model or independent evaluator results. No paid/model call is made by the adapter or these tests.

Supplementary report metrics must be labeled separately from the legacy normalization condition. Virtual enhancement transport can affect relevance/readability, so these aggregate scores are not calibrated as a production V2 quality gate. Factual validity, recommendation quality and presentation quality still require separate semantic review; retention alone does not assess any of them. No comparison with the historical Candidate D `18.6/20` benchmark or direct conversion to Sophia's 0-100 scores is justified without rubric calibration.

The inherited 14,000-byte/collection bounds remain enforced. Over-budget or incompatible output fails explicitly; nothing is silently truncated. The bridge preserves null recommendations and does not invent a replacement.

## Checks and remaining work

Focused tests cover field/ref retention; no V1/raw mutation; exact field visibility in Sophia output units; unavailable semantic judgments; a labeled test-only judgment; explicit alias mapping; version and derivation-ref tampering; null recommendations; deterministic role/content fingerprints; and rejection of V1-only input as V2 coverage.

```powershell
pnpm.cmd --filter @launchstack/pipelines exec vitest run src/vantage/evaluation-integration/v21-adapter.test.ts --exclude 'test-output/**'
```

Remaining production work: agree a first-class evaluator extension for typed V2 units and structured role context, calibrate per-category rubrics on independent labeled cases, and separately approve a fixed generation/judge provider-call budget before a live E2E experiment. No production activation, migrations, auth changes or additional retrieval path are introduced here.
