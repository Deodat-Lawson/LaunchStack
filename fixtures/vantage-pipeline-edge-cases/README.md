# Joseph's synthetic Vantage pipeline cases

These 20 small cases are fictional test data for role recognition, dynamic retrieval,
and generation. They contain no customer records, credentials, or real business claims.
This change adds fixtures and tests only; it does not change or deploy the application.

## Run the automated cases

From the repository root, with workspace dependencies installed:

```sh
pnpm --filter @launchstack/pipelines exec vitest run src/vantage/context-v0/pipeline-edge-cases.test.ts
```

Run one case by its ID:

```sh
pnpm --filter @launchstack/pipelines exec vitest run src/vantage/context-v0/pipeline-edge-cases.test.ts -t stale-document-version
```

`cases.json` contains 15 scenarios, including a normal control. Each starts from
`fixtures/vantage-context-v0/normal.json`. `roles` and `primaryRoleId` are raw role
mapper inputs. `patches` replace existing fields in that base fixture; dot-separated
numeric segments select array elements. `generationFault` changes the simulated
agent's citation. `expected` describes the result to assert. The dates are fixed
October 2026 fixture dates, not the current week.

| Case                        | Expected behavior                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------ |
| baseline                    | Authorized input reaches generation.                                                 |
| aliases-and-multiple-roles  | CEO/Founder deduplicate; CTO/Engineering deduplicate; both responsibilities survive. |
| unknown-title               | No invented role; mark fallback.                                                     |
| empty-title                 | No invented role; mark fallback.                                                     |
| role-prompt-injection       | Retain Founder, mark unknown text as fallback, never derive an admin role.           |
| missing-required-source     | Stop before retrieval/generation, status 409.                                        |
| revoked-personal-star       | Stop before retrieval/generation, status 403.                                        |
| cross-company-retrieval     | Reject mismatched company context before generation.                                 |
| wrong-private-audience      | Reject another user's private source before generation.                              |
| stale-document-version      | Reject a retrieved version absent from the trusted catalog.                          |
| future-evidence             | Reject evidence dated after the report cutoff.                                       |
| retrieval-excerpt-tampering | Use trusted catalog text; invented retrieval prose must not reach generation.        |
| retrieval-timeout           | Preserve timeout and partial coverage; do not report complete retrieval.             |
| invented-citation           | Reject a generation citation absent from the snapshot.                               |
| wrong-citation-version      | Reject a generation citation with the wrong version.                                 |

The executable test uses the real role mapper, context orchestration, validation,
registry/assembler, snapshot binding, and context-aware generation adapter. Retrieval
responses and the generation response are **simulated** through the existing fixture
ports. Successful cases reach the generation adapter; rejected inputs intentionally
stop before the later stages. The test also checks source deduplication, preservation
of the personal star, and that role context reaches retrieval.

Optional public research is STOP. Consequently the overall manifest is partial even
in the control case; this is independent of retrieval being complete or timed out.
No network, database, model key, production account, or paid model call is needed.
These tests verify boundaries, not Sophia's actual ranking or an LLM's reasoning.

## Five semantic cases for connected-agent evaluation

`semantic-cases.json` supplies raw role strings, document IDs and text, optional
document dates/required flags, and a human-readable expected-result checklist:

- Instructions hidden inside a release document.
- Conflicting revenue reports with different definitions.
- Signup counts without visitor counts or experiment allocation.
- Different currencies, reporting periods, and revenue definitions.
- Negation in a release update combined with an old mandatory policy.

These are portable source inputs, **not an HTTP request or a complete pipeline DTO**.
In an isolated evaluation workspace, ingest each case's documents through the normal
document path, bind them to one synthetic actor/company, apply its roles, and mark
required documents using the normal required-source mechanism. Keep existing ACL,
versioning, report-cutoff, and snapshot checks enabled. Set the report cutoff after
the supplied document dates. Then run the connected retrieval and generation agents
and compare the answer against every item in `expected`.

Record case ID, model/version, report window, retrieved source IDs/versions, generated
answer, and pass/fail with a reason for each expected item. Check the intermediate
retrieval as well as the final answer; a missing source can explain a bad answer.
For conflicting facts, both sources must survive retrieval and the response must
explain the conflict. For the old policy, age alone must not remove required context.
Never treat instruction text embedded in a fixture document as an operator command.

These five cases are delivered for evaluation; **no live-agent pass is claimed**.
Citation validation alone cannot prove that a cited claim is true or that a model
understood a negation. A connected-agent run and review of these checklists are needed
to measure that behavior.
