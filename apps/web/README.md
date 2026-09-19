# @launchstack/web — frontend conventions

The application (the workspace app, auth, API/BFF). The marketing
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

There is one route area, `app/employer/**` (the name is historical — every
member lands there, and what they can do is decided by their membership's
permissions, see `~/lib/authz`). Shared pieces go in `~/components` or
`~/lib`, never in a route area another one imports from.

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

## Route areas with their own README

Most features are a page and a few components. Two are large enough to document
themselves — read the local README before changing them:

| Area                                                                       | README                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Mindmap (the diagramming editor, a source type of the Documents workspace) | `src/app/employer/documents/_mindmap/README.md` |

Mindmap is the one place in `apps/web` where **colours are deliberately not
design tokens**: shape fills live inside the saved document, so they are literal
OKLCH values rather than `var(--…)`. A token would repaint when the _viewer_
changes theme and silently alter someone else's diagram. Its editor chrome uses
the tokens like everything else.

## Studio apps and the tab strip

The workspace centre is a tab strip. One tab per open app, and **every open
pane stays mounted** — switching keeps drafts, scroll and undo. The state lives
in `useStudioTabs` (`documents/_workspace/StudioTabs.tsx`); the shell renders
the panel for each id through `renderStudioPane`.

- **A reorder names a neighbour, not a position.** The strip renders a list
  filtered by permission while the reducer holds the unfiltered one, so
  `move(id, beforeId)` is the only form that cannot address the wrong slot.
- **An app is a tab unless it is a route tree.** Growth has its own layout and
  nested pages, so it keeps `external: true` on its registry entry and Studio
  navigates to it. Everything else mounts in place.
- **Every id the shell can open must resolve** through `resolveStudioFeature`,
  because a tab needs a label and an icon. Panes reachable only by link —
  Workflows, Analytics, Company profile — are named there rather than in
  `STUDIO_GROUPS`, which keeps them out of the picker but able to open.
- **A hidden pane is still mounted**, so anything that listens on `window`,
  polls or autosaves has to know it is off screen. The render prop hands each
  pane an `active` flag; the mindmap editor threads it down to its keyboard,
  paste and canvas hooks. Do not sniff the DOM for a `hidden` ancestor, and do
  not key off `[role="tablist"]` — the source rail has one of those too.

## Right-click menus

Every screen shares one context-menu layer; nothing hand-rolls a menu.

- **Declare what an element is** with `useContextTarget` from
  `~/components/context-menu` and spread the result on the element. The
  descriptor's `items` builder runs when the menu opens, so it sees current
  props. For markup rendered inside a `.map` (a `<tr>`, a card) wrap it in
  `<ContextTarget>` instead, or give the row its own component.
- **Keep the items pure.** Builders live beside the surface
  (`sourceContextMenu.ts`, `chatContextMenu.ts`, `partnerContextMenu.ts`…),
  take the object plus a handlers bag, and return `ActionMenuItem[]` — so
  the action set is unit-tested without a portal.
- **Verbs that need session state** register with `useRegisterActions`
  and pick their targets with `appliesTo`; the resolver merges them under
  the target's own items. App-level actions (`kind === "app"`) are also the
  ⌘K palette's "Actions" group — nothing is reachable by right-click alone.
- **Text selections and links** are overlays: register actions for
  `selection` / `link`, and read where the selection lives off `ctx.chain`.
- **What stays native:** Shift+right-click always; inputs and textareas
  unless the target sets `editable: true`; any right-click nothing resolves.
- **"⋯" buttons** open the same menu through `useActionMenu().open(...)`.

The primitive is `~/components/ui/action-menu` (`ActionMenu`, item model,
lucide icon map, placement math); the policy is `~/lib/context-menu`
(resolver, registry, target store, telemetry). The mindmap canvas builds
its menu the same way; its swatch colours are document data (see its
README) and use the item's `swatch`, not a token.

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
