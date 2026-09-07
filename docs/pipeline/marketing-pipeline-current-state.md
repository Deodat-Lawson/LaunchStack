# Marketing Pipeline — Current-State Process Document

> **Deliverable 1.** Evidence-backed map of how the Launchstack marketing (campaign
> planner) pipeline works **today**, on branch `marketing-pipeline-v2` (= `origin/main`,
> monorepo layout). Every claim is anchored to a file/line. This describes current
> behavior, not the target design.
>
> Primary code: `packages/features/src/marketing-pipeline/*`,
> `apps/web/src/app/api/marketing-pipeline/**`,
> `apps/web/src/app/employer/documents/components/marketing-pipeline/**`.
>
> **Corrected 2026-08-22** (unification P0): model claims updated — all marketing LLM
> calls resolve `resolveChatModel({ route: "fast" })` via `models.ts`; there is no
> gpt-5-nano/gpt-4o split and no Tavily (web search is Exa/Serper). Dead modules named
> below were deleted in P0 of the unification plan.

---

## 1. Purpose and scope

### 1.1 User problem

The user wants a **publish-ready social post grounded in their own company documents**,
without writing it themselves. The pipeline acts as a small marketing department:
it finds multiple angles, matches brand voice, targets an audience, and traces the
post's factual claims back to source documents.

### 1.2 Platforms

`x`, `linkedin`, `reddit`, `bluesky` (`MarketingPlatformEnum`, `types.ts`).

### 1.3 Content types

`post`, `thread`, `ad_copy`, `email`, `multi_platform` (`ContentTypeEnum`), each with a
format directive in the generation prompt.

### 1.4 Inputs (`MarketingPipelineInputSchema`, `types.ts`)

| Field                    | Required | Constraint                                      | Use                        |
| ------------------------ | -------- | ----------------------------------------------- | -------------------------- |
| `platform`               | Yes      | `x` \| `linkedin` \| `reddit` \| `bluesky`      | Platform formatting        |
| `prompt`                 | No       | 1–2000 chars (defaults to a generic prompt)     | Campaign request           |
| `maxResearchResults`     | No       | 1–12                                            | Trend research depth       |
| `platformMeta.subreddit` | No       | string                                          | Reddit context             |
| `platformMeta.hashtags`  | No       | string[]                                        | Hashtag guidance           |
| `toneOverride`           | No       | `formal`\|`conversational`\|`technical`\|`bold` | Brand-voice override       |
| `targetAudience`         | No       | ≤200 chars                                      | Enables persona extraction |
| `contentType`            | No       | enum above                                      | Output format              |
| `?debug=true`            | No       | query param                                     | Debug behavior             |

### 1.5 Outputs (`MarketingPipelineResult`, `types.ts`)

| Field                     | Type               | Contains                                                                                                  |
| ------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| `variants`                | `ContentVariant[]` | One post per strategy angle (usually 3)                                                                   |
| `pipelineStages`          | `PipelineStages`   | Full intermediate state: DNA, competitors, trends, strategies, brand voice, persona, performance insights |
| `claimSources`            | `ClaimSource[]`    | Extracted claims matched to source docs w/ confidence                                                     |
| `message` / `image/video` | top-level          | Copied from `variants[0]` — **not** a separate generation step                                            |

---

## 2. End-to-end process map

```mermaid
flowchart TD
    subgraph EXT[External dependencies]
      PG[(Neon Postgres<br/>company · metadata · chunks · history)]
      RAG[[RAG layer<br/>getRag · ensemble search]]
      OAI[Chat models via resolveChatModel<br/>route "fast" · chat-models.yaml]
      WEB[Exa / Serper<br/>web search]
    end

    U[User request<br/>platform · prompt · tone · audience · contentType] --> ADM
    ADM{Stage 0 — Admission<br/>auth · validate · resolve company}
    ADM -->|401 unauth / 400 bad body / 404 no user| ERR[Error response]
    ADM -->|cookie → resolveActiveCompanyForUser<br/>fallback users.companyId| IDN
    IDN[Stage 1 — Company identity<br/>name · description · industry · categories]

    IDN --> BAR{{Run 7 research branches in parallel}}
    BAR --> S2[2 KB context<br/>RAG]
    BAR --> S3[3 Company DNA<br/>metadata-first → RAG · route "fast"]
    BAR --> S4[4 Competitors<br/>web search · route "fast"]
    BAR --> S5[5 Platform trends<br/>web search]
    BAR --> S6[6 Brand voice<br/>RAG · route "fast"]
    BAR --> S7{targetAudience set?}
    S7 -->|yes| S7a[7 Persona<br/>RAG · route "fast"]
    S7 -->|no| S7b[skip persona]
    BAR --> S8[8 Performance history<br/>DB read]

    S5 -.->|fail → empty, continue| MERGE
    S6 -.->|fail → undefined| MERGE
    S7a -.->|fail → undefined| MERGE
    S8 -.->|fail → empty, continue| MERGE

    S2 --> MERGE{{Merge barrier}}
    S3 --> MERGE
    S4 --> MERGE
    S7b --> MERGE

    MERGE --> STRAT[Stage 9 — Strategy synthesis<br/>route "fast" · 3 fixed angles:<br/>thought-leadership · pain-point · proof-driven]
    STRAT --> GEN[Stage 10 — Content generation<br/>route "fast" ×3 in parallel · quality gate OFF]
    GEN --> SEL[Selection: bestVariant = variants 0<br/>no ranking]
    SEL --> CLAIM[Stage 11 — Claim verification<br/>route "fast" extract → RAG match ≤5 claims]
    CLAIM --> SAVE[(Stage 12 — Save to history<br/>fire-and-forget · selected variant only)]
    SAVE --> STREAM[SSE stream to UI<br/>selected · all variants · stage data · claims]

    STREAM --> REFINE[Stage 13 — Refine path<br/>/api/marketing-pipeline/refine EXISTS<br/>but UI uses generic RewriteWorkflow]
    STREAM --> PUB[Stage 14 — Publish path<br/>/api/marketing-pipeline/publish EXISTS<br/>but NO UI caller]

    S2 -.-> RAG
    S3 -.-> RAG
    S6 -.-> RAG
    S7a -.-> RAG
    CLAIM -.-> RAG
    RAG -.-> PG
    IDN -.-> PG
    S8 -.-> PG
    SAVE -.-> PG
    S4 -.-> WEB
    S5 -.-> WEB
    S3 -.-> OAI
    STRAT -.-> OAI
    GEN -.-> OAI
    CLAIM -.-> OAI

    classDef dead fill:#f8d7da,stroke:#c00;
    class REFINE,PUB dead;
```

**Reading the map.** Solid arrows = control flow. Dotted arrows = data/external
dependency. Dashed "fail →" arrows = per-branch fallbacks that let the run continue.
Red nodes (Refine, Publish) are implemented but unreachable from the product UI.

---

## 3. Stage inventory

Latency and cost are **"not measured"** for every stage — there is no timing or
token/cost instrumentation in the pipeline (only `console.log` durations, not persisted).

| #   | Stage               | Module                                             | Trigger                      | Inputs                                                    | Output                                                                               | Model                      | Data source                                                 | Persistence                       | Failure                                                          | Fallback                                                          | Downstream                   |
| --- | ------------------- | -------------------------------------------------- | ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| 0   | Request admission   | `apps/web/.../api/marketing-pipeline/route.ts`     | User submits request         | authed user, JSON body, active-company cookie             | opens SSE stream                                                                     | —                          | `users` table                                               | none                              | 401 unauth / 400 bad JSON+schema / 404 no user / 400 bad company | cookie missing → `users.companyId`                                | `runMarketingPipeline`       |
| 1   | Company identity    | `run.ts` (pre-fanout)                              | after admission              | `companyId`                                               | name, description, industry, ≤8 categories                                           | —                          | `company`, `category`                                       | none                              | uncaught → stops run                                             | none                                                              | all 7 branches               |
| 2   | KB context          | `context.ts` `buildCompanyKnowledgeContext`        | parallel branch              | companyId, prompt                                         | company facts + KB snippets string                                                   | — (retrieval only)         | `company`/`category` + RAG chunks (topK 6, weights 0.4/0.6) | read-only                         | can stop run                                                     | "No matching KB snippets found" text                              | strategy, generation, claims |
| 3   | Company DNA         | `context.ts` `extractCompanyDNA`                   | parallel branch              | companyId, prompt                                         | `CompanyDNA` (mission, differentiators, proven results, human story, technical edge) | route "fast"               | `company_metadata` JSONB first; RAG fallback                | none                              | uncaught → stops run                                             | RAG when metadata missing/low-confidence (`MIN_CONFIDENCE = 0.5`) | strategy, generation         |
| 4   | Competitor analysis | `competitor.ts`                                    | parallel branch              | companyIdentity, categories                               | `CompetitorAnalysis`                                                                 | route "fast"               | web search + company identity                               | 24h in-memory cache (not durable) | LLM failure uncaught → can stop run                              | search fallback exists; final synth can still fail                | strategy                     |
| 5   | Platform trends     | `research.ts`                                      | parallel branch              | platform, company context, prompt                         | `MarketingResearchResult[]`                                                          | —                          | web search (Exa/Serper via trend-search)                    | cache (trend-search)              | caught                                                           | returns `[]`                                                      | strategy                     |
| 6   | Brand voice         | `voice.ts`                                         | parallel branch (always)     | companyId, toneOverride                                   | `BrandVoice`                                                                         | route "fast"               | RAG (topK 6)                                                | none                              | caught in `run.ts`                                               | `brandVoice = undefined`                                          | strategy, generation, refine |
| 7   | Target persona      | `persona.ts`                                       | only if `targetAudience` set | companyId, targetAudience                                 | `TargetPersona`                                                                      | route "fast"               | RAG (topK 6)                                                | none                              | caught                                                           | `targetPersona = undefined`; skipped if no audience               | strategy, generation         |
| 8   | Performance history | `performance.ts`                                   | parallel branch (always)     | companyId, platform                                       | ≤10 rows → 1–4 insight strings                                                       | —                          | `marketing_content_history`                                 | read-only                         | caught                                                           | `[]` / "No history yet"                                           | strategy                     |
| 9   | Strategy synthesis  | `positioning.ts` `buildMultiStrategy`              | after merge                  | DNA, competitors, trends, voice, persona, insights        | 3 × `StrategyVariant` (thought-leadership, pain-point, proof-driven)                 | route "fast"               | in-memory                                                   | none                              | uncaught → stops run                                             | none                                                              | generation                   |
| 10  | Content generation  | `generator.ts` `generateVariants`                  | after strategies             | 1 strategy each, shared research/voice/persona/type       | 3 × `ContentVariant`                                                                 | route "fast" (×3 parallel) | in-memory                                                   | none                              | if one fails, whole `Promise.all` rejects → siblings discarded   | none; quality gate OFF                                            | selection                    |
| 11  | Claim verification  | `claim-verifier.ts`                                | after selection              | companyId, `bestVariant.message`                          | `ClaimSource[]` (≤5)                                                                 | route "fast" (extract)     | RAG (topK 2)                                                | none                              | caught                                                           | `[]`                                                              | SSE result, UI               |
| 12  | Save to history     | `performance.ts` `saveGeneratedContent`            | after selection              | companyId, platform, selected message, angle, contentType | 1 row                                                                                | —                          | `marketing_content_history`                                 | **write** (selected variant only) | `console.warn` only                                              | fire-and-forget                                                   | next run's Stage 8           |
| 13  | Refine (dedicated)  | `generator.ts` `refineContent` → `/api/.../refine` | POST to refine route         | message, platform, feedback, company context, brand voice | refined message + `feedbackApplied`                                                  | route "fast"               | caller-supplied                                             | none                              | 500 on error                                                     | —                                                                 | **no UI caller**             |
| 14  | Publish             | `publish.ts` `publishContent` → `/api/.../publish` | POST to publish route        | platform, message, title                                  | `PublishResult` (postUrl)                                                            | —                          | platform APIs (X/LinkedIn/Reddit/Bluesky)                   | none (no post-ID write-back)      | 502 platform error                                               | none                                                              | **no UI caller**             |

### Dead / unreachable code (verified)

- `buildMessagingStrategy` (`positioning.ts`) — zero call sites. **Deleted in P0 (2026-08-22).**
- `generateCampaignOutput` (`generator.ts`) — zero call sites; superseded by `generateVariants`. **Deleted in P0.**
- `knowledge.ts` (389 lines, 7 exports, zero importers — a second, never-wired groundedness pipeline). **Deleted in P0.**
- `clients/{twitter,linkedin,reddit,bluesky}.ts` (584 lines of platform _search_ clients; only consumer was `scripts/dev/test-platform-apis.ts`, whose import path no longer resolved). **Deleted in P0 along with that broken script.**
- `validatePostQuality` — still present; only runs when `enableQualityGate` is true; the live path passes `false`.
- `/api/marketing-pipeline/refine` and `/publish` — still present; no component in the app fetches them.

---

## 4. RACI

`R` = Responsible · `A` = Accountable · `C` = Consulted

| Concern                            | Product/User                     | UI        | API host              | Feature service              | RAG/Knowledge | LLM/Provider        | Publishing client   | Reviewer                       |
| ---------------------------------- | -------------------------------- | --------- | --------------------- | ---------------------------- | ------------- | ------------------- | ------------------- | ------------------------------ |
| Resolve active workspace           | C                                | —         | R/A (cookie+fallback) | —                            | —             | —                   | —                   | —                              |
| Brand voice detection              | —                                | —         | —                     | A                            | R             | R                   | —                   | —                              |
| Persona targeting                  | R (opts in via `targetAudience`) | C         | —                     | A                            | R             | R                   | —                   | —                              |
| Performance history                | —                                | —         | —                     | R/A                          | —             | —                   | —                   | —                              |
| Strategy variant selection         | —                                | —         | —                     | R (positional `variants[0]`) | —             | —                   | —                   | Unowned                        |
| Quality control on shipped content | —                                | —         | —                     | —                            | —             | —                   | —                   | Unowned; gate disabled         |
| Claim-to-source mapping            | —                                | —         | —                     | A                            | R             | R (extraction only) | —                   | Retrieval score ≠ verification |
| Save to performance history        | —                                | —         | —                     | R/A (fire-and-forget)        | —             | —                   | —                   | —                              |
| Refine with real context           | R (intended)                     | Not wired | R (endpoint built)    | R (logic built)              | —             | R                   | —                   | —                              |
| Publish + engagement write-back    | R (intended)                     | Not wired | R (endpoint built)    | R                            | —             | —                   | R (built, uncalled) | —                              |

---

## 5. Exceptions and edge cases

| #   | Case                                      | Status                   | What happens                                                                                                                                       |
| --- | ----------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Brand voice extraction fails              | Handled                  | Caught in `run.ts`; generation continues without a voice directive. UI marks step "failed". No real default-voice object is constructed.           |
| 2   | No `targetAudience` provided              | By design                | Persona skipped; SSE status "skipped".                                                                                                             |
| 3   | Persona extraction throws                 | Handled                  | Caught; run continues without persona.                                                                                                             |
| 4   | No performance history                    | Handled                  | Returns `[]`; step "skipped" / "No history yet".                                                                                                   |
| 5   | >5 claims found                           | Gap                      | Only first 5 checked (`claims.slice(0,5)`); rest silently ignored.                                                                                 |
| 6   | Claim has no matching source              | Gap                      | `confidence: 0`, `sourceDoc: "No direct source found"` — only useful if UI surfaces unsupported claims.                                            |
| 7   | One of 3 generation calls fails           | **Unhandled**            | `Promise.all` rejects → all 3 variants discarded, whole generation stage fails.                                                                    |
| 8   | A low-quality post would fail the gate    | **Unhandled**            | Quality gate never invoked (disabled in live path).                                                                                                |
| 9   | Save-to-history fails                     | Gap                      | Logged via `console.warn`; user still gets a success result, unaware the post wasn't saved.                                                        |
| 10  | User clicks "Refine"                      | **Unhandled (mismatch)** | UI opens the generic `RewriteWorkflow`, **not** the context-aware `/api/marketing-pipeline/refine`. No company context, no brand voice.            |
| 11  | SSE disconnect / user cancels             | **Unhandled**            | Server does not read `request.signal`; pipeline keeps running and consuming resources after the client leaves.                                     |
| 12  | Active-workspace cookie stale/invalid     | Gap                      | Falls back to `users.companyId`; full cookie-validation path should be confirmed.                                                                  |
| 13  | RAG port not registered                   | Unhandled (boot-time)    | `getRag()` called directly (not via a safe wrapper) in voice/persona/claims — those stages throw rather than degrade.                              |
| 14  | Sparse / empty company KB                 | Partial                  | Retrieval returns "No matching KB snippets" text; LLM may still synthesize from thin evidence (weak grounding, no guard).                          |
| 15  | Provider timeout (OpenAI)                 | Partial                  | Uncaught LLM stages (DNA, strategy, generation) stop the run; caught stages (voice/persona/claims) degrade. No explicit timeout/retry in-pipeline. |
| 16  | Invalid platform constraint (e.g. length) | Gap                      | No generation-time length enforcement; X posts truncated to 280 chars only at publish time (`publish.ts`), which can cut mid-sentence.             |
| 17  | Publishing failure                        | Handled at route         | Returns 502 with platform error — but route is unreachable from UI, so users never hit it.                                                         |

---

## 6. Metrics — available vs. missing

| Metric                    | Status                      | Notes                                                                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Quality score**         | Missing                     | Gate logic exists (`validatePostQuality`) but disabled; nothing scores the 3 variants.                                                                                                                                                                                                                       |
| **Groundedness**          | Partial                     | `claimSources` maps claims → docs, but confidence is a **retrieval/rerank score**, not proof the claim is true. Results are recomputed each run, not persisted. The confidence is merely a similarity vector search, no meaning-nased claim, e.g. opposite opinion with same data maybe used as groundedness |
| **Platform fit**          | Missing                     | No measurement that output respects platform norms/limits.                                                                                                                                                                                                                                                   |
| **Latency**               | Missing                     | Only `console.log` durations; not persisted or aggregated.                                                                                                                                                                                                                                                   |
| **Cost / tokens**         | Missing                     | No token or cost accounting per stage.                                                                                                                                                                                                                                                                       |
| **Completion rate**       | Missing                     | No success/failure counter across runs.                                                                                                                                                                                                                                                                      |
| **Refinement rate**       | Missing                     | Dedicated refine endpoint has no UI caller, so it's never exercised.                                                                                                                                                                                                                                         |
| **Publish rate**          | Missing                     | Publish endpoint has no UI caller and writes no post ID back.                                                                                                                                                                                                                                                |
| **Downstream engagement** | **Missing (looks present)** | `impressions`/`engagements`/`clicks` are real columns and `buildPerformanceInsights` computes avg engagement + best angle — but **nothing ever writes non-null values**. No read-back from platform APIs. Every row has all three set to `NULL`.                                                             |

### 6.1 The engagement trap

The schema and `buildPerformanceInsights` **look** finished — anyone reading them would
conclude performance tracking works. It does not: no code path (publish, routes, scripts)
writes engagement values, and there is no post-publish read-back. The pipeline has
**performance history, but no performance data.**

### 6.2 Test coverage

No test file with `marketing` or `pipeline` in its name exists on this branch. The
pipeline is **untested**.

---

## 7. Corrections, answers, and verification notes

This section resolves the draft's open questions and records what was independently
re-verified against the code on this branch.

### 7.1 Open questions from the draft — now answered

- **"Is `targetAudience` actually exposed in the UI?"** → **Yes.** It is a real input field
  (`MarketingPipelineWorkspace.tsx:732`), held in controller state
  (`useMarketingPipelineController.ts:54`) and sent to the API (`:358`, `:465`). The
  persona stage is genuinely user-reachable.
- **Strategy model** → superseded (2026-08-22): `MARKETING_MODELS` no longer exists. Every
  marketing LLM call goes through `invokeMarketingStructured` (`models.ts`), which resolves
  `resolveChatModel({ route: "fast" })` from `@launchstack/core/llm`; the concrete model
  comes from `apps/web/config/chat-models.yaml`, not from code.

### 7.2 Verified accurate (code-checked)

- Models (`models.ts`) — **corrected 2026-08-22**: there is no per-stage model split on this
  branch. `models.ts` is a 15-line wrapper; every stage (DNA, competitor, strategy, claims,
  generation, refine, quality gate) uses `resolveChatModel({ route: "fast" })`. The
  route "fast" / route "fast" split described earlier belonged to a pre-`resolveChatModel` branch.
- `variants[0]` selection, quality gate off, `saveGeneratedContent` **is** wired
  (`run.ts:436`), Reddit `sr: 'u_me'` hardcoded (`publish.ts:139`), company resolution via
  `resolveActiveCompanyForUser` — all confirmed.
- The main `route.ts` **is** the SSE stream (`text/event-stream`); there is no separate
  `/stream` route on this branch.

### 7.3 Nuances to tighten

- **Claim confidence default is `0`, not `0.5`.** When a claim's top RAG result lacks a
  `confidence` metadata value, `claim-verifier.ts:51` defaults to **0** (older branches used
  0.5). So "unverified" and "zero-confidence" look identical downstream.
- **`?debug=true` still exists** (`route.ts:66`) — it was the OpenAI-key _diagnostic_ that
  was removed, not the debug flag itself. Production errors surface as a generic
  "Failed to run marketing pipeline" without the underlying cause.
- **Live-DB engagement snapshot** (draft §6.3: Reddit 28 / X 4 / LinkedIn 4, all-NULL
  engagement) was **not independently re-queried** for this document — it is a
  point-in-time figure from the shared database and will drift. The structural claim
  (all engagement columns NULL, no writer) is verified from code and holds regardless.

### 7.4 Highest-leverage gaps (for the v2 plan)

1. **Variant selection** — 3 distinct posts generated, `variants[0]` taken blind. Add scoring/ranking (this is where the disabled quality gate belongs).
2. **Refine mismatch** — wire the UI to `/api/marketing-pipeline/refine` (context-aware) instead of the generic `RewriteWorkflow`.
3. **Generation fault-tolerance** — `Promise.all` over 3 generation calls loses all output if one fails; use `allSettled` + keep survivors.
4. **SSE cancellation** — honor `request.signal` so abandoned runs stop burning tokens.
5. **Engagement loop** — either implement publish→read-back or stop presenting engagement analytics as if they work.
6. **Tests** — none exist.

---

_Generated against branch `marketing-pipeline-v2`. File/line anchors reflect that branch;
re-verify after any rebase._

### 8 Features Worth Discussing

- **No image/video generation.** `image/video` is an advisory string telling the user what asset to make.
- **Can't attach video/img to post** nothing in inputs allow users to attach img/video/doc to the post directly; should add a feature that allows users do this?
- **Design Choices** currently in genertor.ts says "Company context is your SINGLE SOURCE OF TRUTH for product claims, features, metrics, and results." Shouls we modify this and assert validity of prompt by user and possibly allow video and img analysis?
- **No variant ranking.** Three posts are generated; `variants[0]` is taken unconditionally (`run.ts:404`). User manually choose one and pulish.
- **No live quality gate.** `validatePostQuality` exists but is called with `enableQualityGate: false` (`run.ts:379`, `generator.ts:372`). Pipeline doesn't have a scoring guide for post.
- **No real engagement analytics.** History rows in datbase are written; impressions/engagements/clicks are never populated (see §6), currently all NULL.
- **No publishing from the product UI** — the publish endpoint exists but there's no UI triggering API calls (§3, Stage 14). Moreover, the written publishing pipeline writes to user's own profile instead of a certain community which means basically no one can see the post. Needs TWITTER_BEARER_TOKEN, LINKEDIN_ACCESS_TOKEN, Reddit keys, Bluesky handle/password. doesn't record the post ID or set published/publishedAt in history, which is why the engagement-analytics loop stays empty.
