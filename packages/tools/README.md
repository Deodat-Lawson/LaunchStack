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

| Tool                   | Import                                  | What it does                                                                                                                                                                                                              | Consumers                                                             |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **company-context**    | `@launchstack/tools/company-context`    | Company identity (one DB read), knowledge-base context assembly, and CompanyDNA extraction (metadata-first with RAG fallback). Owns the `company_metadata` data contract (`./schema`) and the `readFact` confidence gate. | marketing-pipeline, email-pipeline, company-metadata (schema)         |
| **grounded-retrieval** | `@launchstack/tools/grounded-retrieval` | Company-scoped RAG retrieval with named snippet policies (topK / weights / caps) and a declared empty-vs-throw failure policy.                                                                                            | company-context, brand-voice, persona; claim-evidence (planned, PR-4) |
| **brand-voice**        | `@launchstack/tools/brand-voice`        | Synthesize a BrandVoice profile (tone, vocabulary, sentence style, formality) from the company's own documents.                                                                                                           | marketing-pipeline; email tone rules (planned)                        |
| **persona**            | `@launchstack/tools/persona`            | Synthesize a TargetPersona (role, pain points, priorities, language style) for a described audience, grounded in company knowledge.                                                                                       | marketing-pipeline                                                    |

Planned (design doc, Phase 1): `web-research`, `claim-evidence`,
`content-scoring`, `social-publish`, `platform-profiles`.

## Tests

`pnpm --filter @launchstack/tools test` — vitest, deterministic (RAG port is
faked via `configureRag`; DB-touching paths are covered by the web app's
integration suites).
