# @launchstack/tools

Shared, contract-typed capabilities that the feature verticals compose. A
**tool** is something you _import_ — it runs in the caller's process and shares
its types, config, and auth context. Deployed compute with its own API lives in
`services/`; product verticals that orchestrate tools into user-facing flows
live in `packages/features`.

Layering (lint-enforced): `core ← tools ← features ← apps`. Tools may import
`@launchstack/core`, never a feature vertical — capabilities move **down** into
this package, pipelines stay **up** in features. `process.env` is permitted
only in a tool's `config.ts` module.

Every tool is one subpath export with zod-typed inputs/outputs. The shared
contract types (`ToolRunContext`, `ToolResult`, `ToolError`) live in
[`src/contract.ts`](src/contract.ts).

## Catalog

| Tool                   | Import                                  | What it does                                                                                                                                                                                                              | Consumers                                                                          |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **company-context**    | `@launchstack/tools/company-context`    | Company identity (one DB read), knowledge-base context assembly, and CompanyDNA extraction (metadata-first with RAG fallback). Owns the `company_metadata` data contract (`./schema`) and the `readFact` confidence gate. | marketing-pipeline, email-pipeline, company-metadata (schema)                      |
| **grounded-retrieval** | `@launchstack/tools/grounded-retrieval` | Company-scoped RAG retrieval with named snippet policies (topK / weights / caps) and a declared empty-vs-throw failure policy.                                                                                            | company-context, brand-voice, persona, claim-evidence                              |
| **brand-voice**        | `@launchstack/tools/brand-voice`        | Synthesize a BrandVoice profile (tone, vocabulary, sentence style, formality) from the company's own documents.                                                                                                           | marketing-pipeline; email tone rules (planned)                                     |
| **persona**            | `@launchstack/tools/persona`            | Synthesize a TargetPersona (role, pain points, priorities, language style) for a described audience, grounded in company knowledge.                                                                                       | marketing-pipeline                                                                 |
| **web-research**       | `@launchstack/tools/web-research`       | Provider-pluggable web search (Exa/Serper registry, strategy selection, retry, URL dedup) plus the shared in-memory TTL cache (`createTtlCache`). Env reads live in its `config.ts`.                                      | trend-search (planning/synthesis/jobs stay there), marketing competitor + research |
| **place-search**       | `@launchstack/tools/place-search`       | Plan, geocode and execute searches for physical places (Foursquare provider); the targeting *perspective* is caller data. Extracted from client-prospector.                                                              | client-prospector, distribution |
| **org-resolver**       | `@launchstack/tools/org-resolver`       | Deterministic organisation identity: domain/name+country resolve keys, aggregator-domain guard, legal-suffix stripping, mention merging. No LLM, no network.                                                             | distribution |
| **trade-data**         | `@launchstack/tools/trade-data`         | Port for customs/shipment records ("who ships what to whom") with a `none` default, a static provider for fixtures, and a registry for real adapters (`TRADE_DATA_PROVIDER`).                                          | distribution |
| **compliance-screen**  | `@launchstack/tools/compliance-screen`  | Port for sanctions/PEP screening with an OpenSanctions `yente` adapter (`OPENSANCTIONS_API_URL`); results are advisory flags.                                                                                            | distribution |
| **claim-evidence**     | `@launchstack/tools/claim-evidence`     | Extract factual claims from content and look up their knowledge-base sources. Scores are `relevance` (retrieval), never "confidence"; "no source" is a null match, not a zero.                                            | marketing-pipeline                                                                 |
| **platform-profiles**  | `@launchstack/tools/platform-profiles`  | One registry per social platform: posting guidelines, structure templates, few-shot examples, hashtag caps, hard char limits, judge reference posts.                                                                      | marketing generation + publish, evaluate route, benchmark                          |
| **content-scoring**    | `@launchstack/tools/content-scoring`    | One versioned rubric, two consumers: the offline LLM judge (`scorePost`, never rewrites) and the live quality gate (`validatePostQuality`). Variant ranking arrives with the P2 runner.                                   | marketing generation gate, benchmark, evaluate route                               |
| **social-publish**     | `@launchstack/tools/social-publish`     | One `PublishAdapter` per platform (X, LinkedIn, Reddit, Bluesky) behind one registry: typed config in `config.ts`, session/token caching, profile char limits, and the platform-native `postId` on every success.         | marketing publish route (with history write-back)                                  |
| **stage-runner**       | `@launchstack/tools/stage-runner`       | A table and a loop — deliberately not a workflow engine. One declaration per stage (policy, run, report/narration as data); the runner owns timing, progress events, required-vs-degradable failure, and cancellation.    | marketing-pipeline; any future pipeline                                            |

## Tests

`pnpm --filter @launchstack/tools test` — vitest, deterministic (RAG port is
faked via `configureRag`; DB-touching paths are covered by the web app's
integration suites).
