# @launchstack/web — frontend conventions

The application (employer/employee workspaces, auth, API/BFF). The marketing
site lives in `apps/landing`. Both apps share one visual language through
`@launchstack/design-tokens`; this page is the contract that keeps new
frontend work consistent. ESLint enforces the hard rules (see the
"Design-system guardrails" blocks in the root `eslint.config.js`).

## Component sourcing order

When you need UI, take the first thing that exists:

1. **`~/components/ui/<name>`** — the base kit (shadcn primitives themed by
   the design tokens). Per-file imports, no barrel.
2. **`~/components/*`** — shared composed components (`icons/brand`, and the
   growing layout/callout/code-block layer).
3. **Your route area's own `_components/`** — feature-specific pieces.

Never import from another route area (`app/employer/**` ↔ `app/employee/**`)
— lint blocks it. If two areas need the same thing, promote it to
`~/components` or `~/lib`.

## Adding primitives

A primitive missing from `~/components/ui`? Don't hand-roll it:

```bash
cd apps/web && npx shadcn@latest add <name>
```

`components.json` is configured; generated files land in `~/components/ui`
already wired to `cn` from `~/lib/utils`. Modals/popovers come from the kit
(`dialog`, `sheet`) — never hand-rolled overlays.

## Styling

- **Colors are tokens.** `var(--…)` from `@launchstack/design-tokens`, or the
  semantic Tailwind namespace: `surface/panel/ink/line/brand-*/success/
danger/warn/info`. Opacity modifiers compose (`bg-panel-2/30`). New hex
  literals trigger a lint warning; don't add any.
- The shadcn color names (`bg-background`, `text-muted-foreground`, …) and
  the raw purple/slate palette are **gone** — the compat quarantine was
  deleted once the kit was re-themed. Don't reintroduce either.
- Dark mode keys off `data-theme="dark"` on `<html>` (next-themes sets it).
  `dark:` variants and `[data-theme="dark"]` CSS both work; never branch on
  `resolvedTheme` in JS just to pick colors — use a token that flips.
- Fonts: `var(--font-sans|serif|mono)` (Inter Tight/Inter, Instrument Serif,
  JetBrains Mono, loaded once in `src/app/fonts.ts`). Never name a font
  family in CSS directly.

## Icons

`lucide-react` for everything, except brand marks (Slack, Notion, Gmail,
Drive, Dropbox, YouTube, GitHub) from `~/components/icons/brand`. The old
hand-drawn set at `documents/_workspace/icons.tsx` is deprecated.

## Assets

- `public/brand/` — logo exports (`logo.svg`); the canonical in-app mark is
  the `LaunchstackMark` component — keep the two in sync.
- `public/templates/*.docx` — **live production data**, resolved at runtime
  by `packages/features/src/legal-templates/template-service.ts` via
  `process.cwd()`. Do not move or rename without fixing that coupling.
- Anything a component imports goes through the bundler, not `public/`.

## The migration boundary rule

New files must use the kit + tokens — no inline color styles, no raw
`<button>` where `Button` fits, no hand-rolled modals. Existing files migrate
only when you are already changing their UI: touch a component's markup for
feature work → convert the region you touch. Pure logic fixes never trigger
migration. Nobody rewrites the ~100 inline-style files as a project.

## Deprecated (do not extend)

| Module                                        | Replacement                               |
| --------------------------------------------- | ----------------------------------------- |
| `app/employer/documents/_workspace/icons.tsx` | lucide-react + `~/components/icons/brand` |

Lint warnings on these are a ratchet: the count only goes down.
