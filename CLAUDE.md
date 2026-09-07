# CLAUDE.md

Monorepo: `apps/web` (the application), `apps/landing` (marketing site),
`packages/*` (the bricks — feature packages, see `REPOSITORY.md` and the
lint-enforced boundaries in `eslint.config.js`), `pipelines/` (the
compositions — product verticals; may import bricks, never the reverse),
`services/*` (foreign runtimes). pnpm workspaces.

## Frontend rules (apps/web, apps/landing)

- UI primitives come from `~/components/ui/<name>`. If one is missing, add it
  with `npx shadcn@latest add <name>` (run in apps/web) — never hand-roll a
  button, input, table, or overlay. Modals use `~/components/ui/dialog`.
- `cn` comes from `~/lib/utils`. There is exactly one copy.
- Colors are design tokens: `var(--…)` from `packages/design-tokens/tokens.css`
  or semantic Tailwind classes (`bg-panel`, `text-ink-2`, `border-line`,
  `bg-brand`, `text-danger`). Never hex literals, never new inline `style`
  colors, never the raw Tailwind palette (`purple-600`, `slate-800`) in new code.
- The shadcn color names (`bg-background`, `text-muted-foreground`, …) are a
  deprecated compat layer (`apps/web/src/styles/compat.css`). Don't extend it.
- Dark mode: `data-theme="dark"` on `<html>`. Use `dark:` variants or
  `[data-theme="dark"]` CSS; never branch on `resolvedTheme` in JS for colors.
- Icons: `lucide-react`; brand marks from `~/components/icons/brand`.
- Fonts: `var(--font-sans|serif|mono)` only; loaded once in `src/app/fonts.ts`.
- Never import across route areas (`app/employer/**` ↔ `app/employee/**`).
  Shared pieces go in `~/components` or `~/lib`.
- `app/employer/_components/primitives.tsx` and
  `documents/_workspace/icons.tsx` are deprecated — do not add imports.
- Touch-it-migrate-it: when editing existing UI for feature work, convert the
  region you touch to kit + tokens; never launch a bulk rewrite.
- Full conventions: `apps/web/README.md`.
- The Mindmap editor (`app/employer/documents/_mindmap`) has its own README
  and one deliberate exception: shape colours are literal OKLCH values stored
  in the document, not tokens — a token would repaint when the _viewer_
  switches theme and change someone else's diagram. Its chrome uses tokens
  normally.

## Workflow

- Format with `pnpm format:write` (Prettier owns style incl. Tailwind class
  order); lint warnings from the design-system guardrails are a ratchet — the
  count may only go down.
- `public/templates/*.docx` are live production data resolved at runtime via
  `process.cwd()` — do not move them.
- Deploys are container images (`.github/workflows/docker.yml` → GHCR) and
  Compose. There is no Vercel pipeline; nothing in the repo builds one.
