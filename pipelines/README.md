# @launchstack/pipelines

The compositions — level two. Eleven verticals, each chaining the LaunchStack bricks toward a business outcome: marketing, email outreach, founder weekly review, legal templates, company metadata, client prospector, trend search, knowledge connectors, the repo explainer, repo workspaces, and the distribution pipeline. It deliberately does not contain bricks — a composition may import any brick, and no brick may import a composition (lint-enforced).

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

| Subpath | What it is |
| --- | --- |
| `./marketing` | (company, platform) → verified post variants |
| `./email` | (campaign, recipients) → reviewed, rendered, sent emails |
| `./founder-weekly-review` | (company, week) → published review, every claim cited |
| `./legal-templates` | (template, data) → validated DOCX |
| `./company-metadata` | document chunks → merged canonical company facts |
| `./client-prospector` | ICP description → scored prospect list |
| `./trend-search` | question → synthesized answer + sources |
| `./connectors` | external knowledge source → KnowledgeItems → sink |
| `./repo-explainer` | GitHub URL → summary + Mermaid diagram (legacy request-scoped path), plus the workspace-backed gated agent explanation |
| `./repo-workspace` | connected repository → synced git mirror + deterministic per-commit context bundle (tree, ranked repo map, memory files, stats, hygiene manifest) |
| `./distribution` | program (offering, territories, partner kinds) → evidence-backed partner dossiers, fit scores, relationship pipeline with stage rules, coverage dashboard; outreach hands off to `./email` |
| `./schema` | the product schema the verticals own (applied by apps/web's migration set) |

## Configuration

Nothing here reads `process.env`. Configuration is injected by the
composition root — `createEngine(config)` in `@launchstack/engine`, or the
package's own `configure*` hooks when used standalone.

Verticals may read process.env — they are product code, not engine code.

## Stability

0.x across the board. A vertical graduates to its own package when a consumer outside this repository depends on it; legal-templates (no engine, no Drizzle) is the first candidate.

## License

Apache-2.0 — see [LICENSE](LICENSE).
