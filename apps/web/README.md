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

## Type

One typeface system across apps/web and apps/landing:

| Token               | Face                          | Use                                         |
| ------------------- | ----------------------------- | ------------------------------------------- |
| `var(--font-sans)`  | Inter (variable, `opsz` axis) | every word of UI — body, labels, headings   |
| `var(--font-mono)`  | JetBrains Mono                | code, IDs, keys, tabular data               |
| `var(--font-serif)` | system serif (no web font)    | user content that asks for serif — never UI |

- Both faces load once, in `src/app/fonts.ts`; the landing app keeps a
  byte-identical copy. Nothing else imports `next/font` (lint error), and no
  code names a family or reads `--font-inter` / `--font-jetbrains-mono`
  directly (`__tests__/brand/typography.test.ts`). Tailwind: `font-sans`,
  `font-mono`.
- Headings: the `display` class (sans at `--fw-display`, 600). Inter's
  optical-size axis switches to the Display cut from the font size, so there
  is no second heading face. An accent word inside a heading is set in the
  brand colour, not in italic or another family.
- Renderers that cannot take `var()` (canvas, mermaid) call
  `resolveFontStack("sans" | "mono" | "serif")` from `~/lib/fonts` —
  next/font serves hashed family names, so a literal `"Inter"` never matches.

## Icons

`lucide-react` for every glyph, in both apps; its defaults (24-unit grid,
2px stroke) are the house style. Brand marks come from
`~/components/icons/brand` (apps/web) — lucide's brand glyphs (`Github`,
`Youtube`, …) are deprecated, gone in lucide v1, and a lint error. Other icon
libraries are a lint error. A registry that holds either kind types its
entries with `IconComponent` from `~/components/icons/types`.

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

## The workspace centre: columns and tabs

The centre is one or more columns side by side, each its own strip of tabs.
Chat beside a document, or chat beside a tool beside a document. **Every open
pane stays mounted** — switching tabs, and moving a tab between columns, keeps
drafts, scroll and undo.

Three files: `paneLayout.ts` is the state and every verb; `StudioTabs.tsx` is
one column's strip; `StudioSplitView.tsx` puts the columns in a
`ResizablePanelGroup` and hosts the panes.

- **A move names a neighbour, not a position.** A strip renders a list filtered
  by permission while the reducer holds the unfiltered one, so
  `move(id, toGroupId, beforeId)` is the only form that cannot address the
  wrong slot.
- **Panes are not rendered inside their column.** Each gets a host element the
  split view creates once and then moves with `appendChild`. Portalling into
  the column's own slot looks equivalent and is not: React compares a portal's
  container when it reconciles, so changing it destroys the pane and builds a
  new one — the exact thing tabs exist to prevent. There is a mount-counter
  test for this; the regression is invisible on a pane with no state.
- **Register a slot from a layout effect, never an inline `ref` callback.** An
  inline callback is a new function each render, so React calls it with `null`
  and then the element every pass, which never settles when the host keeps
  slots in state.
- **Visible is not focused.** With columns, one pane per column is visible but
  only one is focused. Anything that owns the keyboard — the mindmap editor,
  above all — gates on focus, or it eats keys meant for the pane next to it.
- **An app is a tab unless it is a route tree.** Growth has its own layout and
  nested pages, so it keeps `external: true` and Studio navigates to it.
- **Every id the shell can open must resolve** through `resolveStudioFeature`,
  because a tab needs a label and an icon. Panes reachable only by link —
  Workflows, Analytics, Company profile — are named there rather than in
  `STUDIO_GROUPS`, which keeps them out of the picker but able to open. A
  source opened to the side is a tab too, under the `source:` prefix.
- **Chrome lives in the leftmost strip, not in a pane.** The palette, Studio
  and avatar controls are the workspace's. Asking each pane to draw them when
  it happens to be leftmost gave three avatar menus in three columns, and none
  at all when the leftmost column held a document.
- **Do not key anything off `[role="tablist"]`** — the source rail has one.
  The strip marks itself `data-studio-tab-strip`.
- **`moveBefore` only works on a connected node.** It is how a pane changes
  column without losing focus or scroll, but it throws on a detached one, so
  it is guarded by `isConnected` with a snapshot-and-restore fallback.
- **The strip survives an empty column.** It carries the sidebar control, the
  chrome and the only way to open anything, so the empty state goes inside it
  rather than in place of it.

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

Nothing is currently deprecated. `app/employer/documents/_workspace/icons.tsx`
was deleted once its last consumer moved to lucide-react; importing it is a
lint error. Lint warnings on anything listed here are a ratchet: the count
only goes down.
