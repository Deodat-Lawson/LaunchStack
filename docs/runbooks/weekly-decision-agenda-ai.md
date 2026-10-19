# Weekly Decision Agenda AI adapter

The AI implementation exports `generateWeeklyAgendaV1(input, runtime)` as a
`GenerationPort`. It was developed from `feat/weekly-agenda-contract-v1` at
`a9d3e64240551a648c36ba04bce6078e0408168e`. The frozen
[Contract v1](../design/weekly-decision-agenda-contract-v1.md) takes precedence over
the broader uploaded technical design (document body version 0.2, 12 October 2026).

## Host integration

```ts
import { generateWeeklyAgendaV1 } from "@launchstack/pipelines/vantage/generation-v1";
import { installVantageGenerationPort } from "./generation-port";

installVantageGenerationPort(generateWeeklyAgendaV1);
```

TL installs the adapter at server setup. This change does not install it, change
HTTP routes, persist data, query a database, authenticate, approve, share, or create
commitments. The existing host continues to validate the result and input fingerprint,
recheck authorization and versions, and persist atomically. The direct package
subpath avoids importing the Vantage database barrel.

Runtime uses the existing resolved model, an AbortSignal, and the unchanged v1
budgets. The function echoes `runId` and `inputVersion`. Abort rejects with a safe
AbortError; the host must not save a cancelled run. Setup/deadline failure rejects
without an invented successful execution record.

## Evidence and signals

- Work only with supplied records. Source URLs are never fetched. Defensive time
  checks run before signals and selection; they do not replace host authorization.
- Signals use the eligible current collections. Prior observations remain comparison
  context; only the same calendar window shifted back seven days is compared.
  Partial/full-week mismatches and ambiguous prior values yield no delta. Current
  conflicts remain visible and suppress an asserted trend. Zero baselines have no
  percentage; non-finite arithmetic is not emitted.
- Carry-forward commitments retain their dates and are labeled as context. Overdue
  status is evaluated at the reporting cutoff, including for historical reports.
- Selection prioritizes conflicting observations, notable comparisons, commitments,
  then recent evidence. It deterministically selects at most 40 items across all
  source kinds and at most 14,000 serialized UTF-8 bytes. Excerpts are capped at
  1,200 characters. Selection/truncation counts are recorded in `modelMetadata`.
- The model payload also bounds reviewed content and signals (18,000 serialized
  bytes); the shared invocation rejects a complete prompt above 24,000 serialized
  bytes. These conservative byte budgets are not measured tokenizer usage. The
  provider output cap is 2,400 tokens when supported, preserving a smaller existing
  model cap. No wire cap is invented for models declaring it unsupported.
- Returned signals describe the eligible input before pack limits. Generation sees
  only the selected pack and bounded context; it must not cite omitted sources.
  Missing current metrics remain visible even when no evidence can yield a topic.

## Generation and fallback

`generation-v1.ts` uses a strict schema and the new shared
`invokeStructuredAttempt` helper. Each invocation makes one SDK call, without an
implicit repair or retry. The existing shared structured-output API is unchanged.
The current OpenAI-compatible transport is cloned with zero SDK retries and a
bounded timeout; the original model is not mutated. Custom BaseChatModel transports
must declare zero retries in their constructor configuration and honor cancellation.

The adapter permits at most two attempts, including schema/citation repair. Each
attempt is at most 20 seconds; transient HTTP 408/429/5xx, temporary network failures,
and timeouts retry with a one-second wait. Credential/permission and ordinary 4xx
errors do not retry. Invalid output gets at most one fresh repair request without
replaying the invalid response. All attempts share the 45-second deadline, with
fallback precomputed and one second reserved for final normalization. AbortSignals
reach the SDK, and an outer race discards late output even if a transport ignores
cancellation. Unknown provider error bodies are never returned or logged here.

Explicit rules mode skips model resolution. Empty packs skip it too. Missing model
configuration records `no-model`; provider, timeout, and validation failures record
their actual fallback reason and attempt count. Rules are deterministic and use
selected sources without claiming statistical significance or an invented cause.
They return no more than five new topics and one proposed next step per topic.
Execution mode, prompt version, duration, usage when available, and selection
metadata distinguish AI from rules. Unsupported provider token caps and semantic
quality still require deployment/provider acceptance.

## Reviewed topics and grounding

The input is not mutated. The output has no operation capable of updating a topic,
decision, or action. Enhancements target only supplied reviewed IDs and exact content
versions, and every enhancement kind requires selected source refs. Citation labels
and dates are reconstructed from the supplied records. Unknown, mixed-valid/invalid,
uncited, or omitted-source refs invalidate the model output.

The prompt directs additions to enhancements. A conservative post-check also routes
a draft to a separate addition when it shares a source with a reviewed topic, has the
same title, or has at least two title words of four or more characters in common.
It retains a different proposed next step as an idea, newly referenced facts as
evidence, or a different question. Exact repeated steps/questions with no new
source references produce no addition; paraphrase equivalence is not guaranteed.
Rules use this same protection. This heuristic can over-group related topics or miss
semantic paraphrases; it is not semantic deduplication. The host remains the final
guarantee that human text, dismissed choices, decisions and actions are preserved.

Citation validation establishes source identity, not entailment. Numerical and
narrative claims, interpretations, and proposed questions still need source inspection
by the founder. The harness does not claim an automated semantic-support proof.

## Reproduction

From the repository root after installing the locked dependencies:

```sh
pnpm --filter @launchstack/pipelines test:ai
pnpm --filter @launchstack/pipelines harness:ai
pnpm --filter @launchstack/pipelines harness:ai --force-fallback
pnpm --filter @launchstack/pipelines harness:ai --live
pnpm --filter @launchstack/pipelines typecheck
pnpm --filter @launchstack/llm typecheck
```

The harness lives in `pipelines/scripts/vantage-ai-harness.mjs`, matching the other
JavaScript scripts in that directory. `harness:ai` runs it with `node --import tsx`
because it imports the workspace TypeScript sources directly; a package build is
not required. The loader is still needed even though the harness is JavaScript.

The harness loads the frozen internal normal, empty, and enrichment inputs. Default
mode runs deterministic rules. `--force-fallback` injects a synthetic provider outage;
this is explicitly labeled a double. `--live` uses the real shared SDK, requires
`CHAT_BASE_URL` and `CHAT_API_KEY`, and reads `CHAT_MODELS_CONFIG` or the repository's
`apps/web/config/chat-models.yaml`. It never automatically loads application `.env`
files. Its exit code is 2 when required live configuration is missing, 1 when observed
mode differs from expectation, and 0 when checks pass. Optional `--output path.json`
saves the synthetic output for review. Standard logs contain metadata/counts only.

The unit suite additionally covers thin inputs, conflicting/current/prior observations,
DST, out-of-period rows, Unicode budgets, edited/kept/dismissed/decided topics, wrong
versions, invalid citations, repairs, non-transient and transient failures, per-attempt
and total deadlines, cancellation and late completion. Shared SDK tests use in-memory
HTTP responses; they are not live provider evidence.

## Observed validation on 18 October 2026

Validation was run in an isolated checkout with Node 24.19.0 and pnpm 11.25.0 against
the unchanged frozen lockfile (the repository declares pnpm 10.15.1). Dependencies
were installed with lifecycle scripts disabled. This does not establish production
build or deployment compatibility.

- Deterministic rules and forced-provider-failure harnesses: normal, empty, and
  enrichment examples passed. The forced outage used two attempts; empty input made
  zero attempts. Actual durations are retained in the harness artifacts.
- Live harness: **skipped**, exit code 2. Neither `CHAT_BASE_URL` nor `CHAT_API_KEY`
  was present, and the original checkout had only `.env.example`. No remote model
  request was made and no real-provider success is claimed.
- Vantage and shared LLM regression tests: 126 passed (10 files). The 47 new
  generation/transport tests also passed again after lint corrections.
- Existing host validator tests: 29 passed. These use explicit doubles for loading,
  saving and model resolution; they are not DB or live HTTP acceptance.
- Pipelines and LLM package typechecks, changed-file formatting, changed-file lint,
  and whitespace checks passed. Lint emitted existing workspace React/pages
  discovery notices, with no file diagnostics.
- No database, live HTTP/login, browser, integrated installation, deployment timeout,
  or pilot acceptance was run. Those remain TL/application acceptance work.

Manual inspection of the synthetic rules output confirmed that 120 versus 100 uses
both comparable observation refs, the single interview stays an individual source,
and the reviewed onboarding topic receives a separate question with version 2.
The empty fixture has no topics or additions. This review concerns synthetic rules
output, not the quality of a live model response.
