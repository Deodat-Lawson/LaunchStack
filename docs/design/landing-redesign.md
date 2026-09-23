# Startup operating system landing page

## Design direction

The home page presents Launchstack as a workspace for founders' knowledge, decisions, and next moves. The interactive demonstration uses clearly labeled sample data. The landing page inherits the product's shared purple color system, light and dark surfaces, text colors, borders, radii, and shadows from `packages/design-tokens/tokens.css`. Inter Tight uses the same `--font-sans` token as the application. The theme follows the existing next-themes provider and can be changed from the header.

The preview follows the product's `SourceRail` and `AskPanel` presentation: Sources/History tabs, searchable source rows, a conversation header, user and assistant messages, rounded source citations, and a composer-style question area. The spacious marketing composition remains specific to the landing page. The demo uses a 280px source rail, 24px chat gutters, and a 760px maximum conversation width, matching the product workspace. All brand marks retain their original geometry; monochrome source marks invert in dark mode for legibility.

There are no fabricated testimonials, customer claims, or unverified usage metrics. Numbers within the demo describe a fictional Acme workspace.

## Research used

- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): deliberate visual direction, subject-specific content, critique before implementation, one strong focal point.
- [Vercel web-design-guidelines skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md) and [Web Interface Guidelines](https://vercel.com/design/guidelines): semantic controls, focus states, keyboard navigation, reduced motion, responsive layout, image dimensions.
- [Impeccable animation playbook](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/reference/animate.md): researched for interaction principles; no binary or additional runtime installed. Motion explains user-triggered state changes instead of running decorative loops.
- [Motion accessibility guidance](https://motion.dev/docs/react-use-reduced-motion): respect user motion preferences. The existing MotionConfig respects reduced motion; the workspace interactions use immediate, predictable state changes.

## Interaction design

- A Studio disclosure switches between Chat, Knowledge, and Notebook using keyboard-accessible buttons.
- Searchable Sources/History rail, sample conversation history, and a New chat empty state.
- Light/dark theme switch using the same provider and storage preference as the other landing routes.
- Four sample questions fill an editable composer. Submission checks required source selection before showing a fixture answer; custom text explains the preview limit and links to a real account. Source excerpts use native dialogs.
- Founder review appears as a cited conversation. Notebook creates an editable sample announcement with reset; edits persist across view changes until the page closes.
- Four knowledge-map nodes with selection feedback and source-specific explanations.
- Four source import cards with accurate import methods and live descriptions.
- Native FAQ disclosures, a mobile menu with Escape handling, skip link, and visible focus states.
- Account calls to action use the configured application origin. Documentation, pricing, contact, repository, and license links retain their real destinations.

## Brand asset provenance

The Launchstack mark, favicon, and raster logo are reused unchanged from the repository. Brand SVGs are locally hosted in `apps/landing/public/brands` and retain the geometry from [Simple Icons](https://github.com/simple-icons/simple-icons):

- [GitHub](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/github.svg)
- [Notion](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/notion.svg)
- [Google Drive](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/googledrive.svg)
- [Markdown](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/markdown.svg)

Fetched September 18, 2026. Simple Icons assets are CC0; individual marks remain the property of their brand owners. These marks identify compatible sources and import formats, not customers or endorsements. Google Drive is described as an optional configured workspace connection. Notion remains an export import; it is not represented as continuous synchronization. No remote logo CDN is needed at runtime.

## Running the page

From this worktree, install with `pnpm install --filter @launchstack/landing... --frozen-lockfile`, then run `pnpm --filter @launchstack/landing dev`. The default development port is 3001. For production: `pnpm --filter @launchstack/landing build`, then `pnpm --filter @launchstack/landing start`.

## Deployment guide

The deployment screen was rebuilt against the current product checkout, revision `862963ca`, rather than the older base of the landing worktree. Its 13 sections cover setup, production Compose, local development, chat/embeddings, storage, accounts, workers, document/audio services, connections, optional capabilities, operations, and split hosting.

The guide now documents the web/worker split, both database migration sets, independent embedding credentials and indices, read-only model routes in Settings → Models, embedding controls in Settings → Processing, S3/PostgreSQL file backends, Docling and cloud OCR, conversion/editing/PDF services, and current OAuth connection gates. Obsolete required Blob/UploadThing/Inngest assumptions were removed. Old section URLs resolve to the appropriate replacement content.

Navigation uses real URLs and server-rendered section selection, so refreshes, direct links, and browser back/forward work. Search indexes setting names and explanatory content. Copy controls report success only after clipboard writes resolve and provide an error fallback. Mobile navigation uses a native modal dialog with Escape, focus restoration, and scroll locking.

Every section links to the relevant source files at the reviewed revision. External technical references include [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables), [Docker Compose merge semantics](https://docs.docker.com/reference/compose-file/merge/), and [Inngest serving](https://www.inngest.com/docs/learn/serving-inngest-functions). The guide calls out that public Next.js origins require a build and that the current production overlay's runtime environment alone does not rewrite the landing bundle.

## Scope

This work changes the landing homepage, deployment guide, their social previews, and their shared typography/theme setup. Pricing and contact retain their existing page composition. The demo uses fictional fixtures and performs no backend requests. Infrastructure, migrations, and live production services were not changed or executed.

## Verification

- Production build and TypeScript validation pass. Homepage route: approximately 20.5 kB, 126 kB first-load JavaScript. Deployment route: approximately 18 kB, 124 kB first load. The home page is statically prerendered; deployment sections are server-rendered from query parameters.
- Landing ESLint passes with no findings.
- Six behavior/configuration tests pass, including required-context handling, unsupported prompts, legacy URLs, environment-variable search, actual shared CSS-token names, and source-backed checks against the product checkout. Run `DEPLOYMENT_SOURCE_ROOT=/path/to/current/product pnpm --filter @launchstack/landing test:unit`. Without that variable, the product-source audit is explicitly skipped.
- Ten production smoke tests pass, covering real SVG assets, CTA origins, metadata, FAQ consistency, navigation, all 13 guide sections, old guide URLs, fragment targets, and both 1200 × 630 PNG social previews. Run `pnpm --filter @launchstack/landing test:smoke`; `LANDING_TEST_URL` overrides the default preview port 3011.
- Browser checks cover source search/selection, history, starter population, missing-source restoration, custom prompt feedback, citations, editable Notebook/reset, Studio navigation, theme switching, guide search/copy, direct links, back/forward, and mobile menu/Escape/focus behavior.
- Desktop (1440px), tablet (768px), and phone (375px and 320px) layouts reviewed. Light and dark themes use the app's semantic tokens; brand geometry is unchanged. The 320px guide header gets a compact layout to keep all controls visible.
- The button font reset now uses low specificity, so component sizes and weights apply without font `!important` overrides. No new font family or selector was introduced in this pass.
- Accessibility: labeled semantic controls, keyboard focus, native dialogs/disclosures, main headings and skip links, sample-data labels, and reduced-motion styles. This is a targeted review, not a complete WCAG certification.
- Work remains isolated on `codex/startup-os-landing` under `.claude/worktrees/codex-startup-os-landing`; the main checkout is unchanged.
