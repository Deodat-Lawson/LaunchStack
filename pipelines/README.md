# @launchstack/pipelines

The compositions — level two. Twelve verticals, each chaining the LaunchStack bricks toward a business outcome: marketing, email outreach, founder weekly review, company metadata, client prospector, trend search, knowledge connectors, the repo explainer, repo workspaces, the distribution pipeline, proposals, and Vantage (the weekly founder-meeting loop). It deliberately does not contain bricks — a composition may import any brick, and no brick may import a composition (lint-enforced).

## Install

```bash
pnpm add @launchstack/pipelines
```

## Use

```ts
import { runTrendSearch } from "@launchstack/pipelines/trend-search";
import { runClientProspector } from "@launchstack/pipelines/client-prospector";
```

## API

| Subpath                   | What it is                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./marketing`             | (company, platform) → verified post variants                                                                                                                                                                                                 |
| `./email`                 | (campaign, recipients) → reviewed, rendered, sent emails                                                                                                                                                                                     |
| `./founder-weekly-review` | (company, week) → published review, every claim cited                                                                                                                                                                                        |
| `./company-metadata`      | document chunks → merged canonical company facts                                                                                                                                                                                             |
| `./client-prospector`     | ICP description → scored prospect list                                                                                                                                                                                                       |
| `./trend-search`          | question → synthesized answer + sources                                                                                                                                                                                                      |
| `./connectors`            | external knowledge source → KnowledgeItems → sink                                                                                                                                                                                            |
| `./repo-explainer`        | GitHub URL → summary + Mermaid diagram (legacy request-scoped path), plus the workspace-backed gated agent explanation                                                                                                                       |
| `./repo-workspace`        | connected repository → synced git mirror + deterministic per-commit context bundle (tree, ranked repo map, memory files, stats, hygiene manifest)                                                                                            |
| `./distribution`          | program (offering, territories, partner kinds) → evidence-backed partner dossiers, fit scores, relationship pipeline with stage rules, coverage dashboard; outreach hands off to `./email`                                                   |
| `./proposals`             | organisation profile from its sources → funders that fit → a call as a checklist → each answer drafted from evidence → review → reusable answers; runs are the unit of background work                                                       |
| `./accelerators/types`    | validated public Program Catalogue records: sources, descriptions, target applicants, logos, locations, and Cycles                                                                                                                           |
| `./accelerators/schema`   | installation-wide `acceleratorPrograms` table; no company data or fit results                                                                                                                                                                |
| `./vantage`               | evidence inbox + dated metric observations → a weekly agenda whose facts cite their sources (model when configured, rules otherwise), decisions that open commitments checked the week after, a shared-only weekly update and program triage |
| `./schema`                | the product schema the verticals own (applied by apps/web's migration set)                                                                                                                                                                   |

## Accelerator Catalogue contract

This schema-only slice defines public Program records and their product-table storage. It does not expose a Catalogue API or UI, import records, or run company-profile matching.

- `CatalogueProgramSchema` validates the version-2 record before storage. Drizzle's JSONB type alone does not validate input.
- Descriptions, target applicants, optional locations, logos, and dated Cycles refer to evidence in the same record's `sources`. Interpreted narratives are marked, not treated as direct source statements.
- Target applicants remain free-text sourced narratives, not a fixed stage enum or an eligibility decision.
- Logos use local `/accelerators/logos/` asset paths. This contract validates paths and source references; a later importer must verify the actual asset.
- Keep `deadlineAt` and `deadlineTimezone` `null` when unknown; omit `dateOnly` unless a date is known. `dateOnly` preserves a calendar date without inventing a time; exact instants also require a timezone. Dates require source evidence.
- The table stores a stable Program ID, the validated record, its content hash, and timestamps. Content-hash computation and writes belong to the later ingestion implementation.
- Only public Program data belongs here. Company profiles, fit assessments, answers, credentials, and applicant data are outside this contract.

**Form filling is deprecated for the Accelerator feature.** This schema deliberately has no Form fields, questions, answers, Application tables, or AI jobs. Matching storage and execution are also excluded from this schema-only slice. Existing Grants schemas and behavior are unchanged.

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

Verticals may read process.env — they are product code, not engine code.

## Stability

0.x across the board. A vertical graduates to its own package when a consumer outside this repository depends on it.

## License

Apache-2.0 — see [LICENSE](LICENSE).
