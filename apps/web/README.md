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

## The workspace centre: panes and tabs

The centre is a tree of splits, cmux-style: panes side by side or stacked,
nested as deep as people split them, each pane its own strip of tabs. Chat
beside a document, a tool under both. **Every open pane stays mounted** —
switching tabs, moving a tab to another pane, splitting, resizing and
zooming all keep drafts, scroll, undo and a document's place.

Files: `paneLayout.ts` is the state and every verb; `paneFrames.ts` turns the
tree into rectangles; `StudioTabs.tsx` is one pane's strip;
`StudioSplitView.tsx` places the panes, draws the dividers and drop zones, and
hosts the panes' content. `useLayoutPersistence.ts` brings the layout back on
the next visit.

- **Splitting is a gesture, not a button.** Drag a tab, or a source from the
  sidebar, onto a pane: its outer quarter on each side splits that way, its
  middle opens it there, and a narrow band along the workspace's own edges
  makes a pane the whole height or width. ⌘/Ctrl-click a source or a Studio
  app to open it beside what is showing; double-click a tab to maximize its
  pane. Each strip keeps one "⋯" pane menu as the fallback, with the keys
  written in it — not a row of split buttons in every pane.
- **A drag says what it carries.** `dragData.ts` holds one MIME type per
  kind — a tab, a sidebar source — so panes can show their zones while the
  drag is in the air (only the types are readable then) and read the id on
  drop. The sidebar knows nothing of panes; its drags are noticed on the
  document. Showing the zones waits a tick: changing the page inside
  `dragstart` can make Chrome cancel the drag. Clearing them waits a tick
  too: for a real drag the browser applies React's updates between
  listeners, so zones cleared from a capture-phase `drop` listener were gone
  before their own `onDrop` ran. A script-dispatched test event hides this —
  the regression test forces the flush with `flushSync`.
- **A split that would leave a pane unusable is refused, up front.** A pane
  too narrow (or short) to halve above `MIN_PANE_PX` offers no side zones and
  greys that item in its menu, with the reason; dividers stop at the same
  sizes.
- **The tree lives in the reducer; the DOM is flat.** Each pane is an
  absolutely placed sibling keyed by its id, positioned from `layoutFrames`.
  Nesting the DOM like the tree looks simpler and is not: splitting a pane
  wraps it in a new container, React rebuilds what it wraps, and the pane's
  node is detached for a moment — reloading any iframe in it and resetting
  every scroller. There is a test that splits a pane and checks its content
  is the same element.
- **`groups` is the tree's leaves in reading order.** Anything that walks "the
  panes" — focus next/previous, merge, persistence — walks that list; only the
  renderer and the split verbs read `root`. A split holds any number of
  children and never one of its own axis (they are flattened), so three
  columns are one split of three.
- **A pane goes with its last tab, except on purpose.** Closing or moving the
  last tab out of a pane removes it and its space goes to the neighbour it
  shared a divider with. A pane made by Split right/down starts empty and
  stays until something opens in it or it is closed. The final pane is never
  removed.
- **Automatic splits stop at three; people can make six.** "Open to the side"
  and "Ask about" reuse a pane past `AUTO_SPLIT_LIMIT`; the split buttons,
  shortcuts and dropping a tab on a pane's edge go to `MAX_GROUPS`.
- **Zoom follows focus.** A maximized pane is always the focused one; focusing
  any other pane, or changing the layout, lets the rest back. The panes behind
  a zoom are `invisible`, not unmounted.
- **A move names a neighbour, not a position.** A strip renders a list filtered
  by permission while the reducer holds the unfiltered one, so
  `move(id, toGroupId, beforeId)` is the only form that cannot address the
  wrong slot.
- **Panes are not rendered inside their pane's slot.** Each gets a host element
  the split view creates once and then moves with `appendChild`. Portalling
  into the slot looks equivalent and is not: React compares a portal's
  container when it reconciles, so changing it destroys the pane and builds a
  new one — the exact thing tabs exist to prevent. There is a mount-counter
  test for this; the regression is invisible on a pane with no state.
- **Register a slot from a layout effect, never an inline `ref` callback.** An
  inline callback is a new function each render, so React calls it with `null`
  and then the element every pass, which never settles when the host keeps
  slots in state.
- **Dragging a divider does not re-render the apps.** Shares in flight are the
  split view's own state and commit to the reducer on release; the portalled
  content is a memoised component. Anything that takes the pointer during a
  drag (an iframe) is covered by a transparent overlay until it ends.
- **Visible is not focused.** With several panes, one tab per pane is visible
  but only one is focused. Anything that owns the keyboard — the mindmap
  editor, above all — gates on focus, or it eats keys meant for the pane next
  to it.
- **An app is a tab unless it is a route tree.** Growth has its own layout and
  nested pages, so it keeps `external: true` and Studio navigates to it.
- **Every id the shell can open must resolve** through `resolveStudioFeature`,
  because a tab needs a label and an icon. Panes reachable only by link —
  Workflows, Analytics, Company profile — are named there rather than in
  `STUDIO_GROUPS`, which keeps them out of the picker but able to open. A
  source opened to the side is a tab too, under the `source:` prefix.
- **Chrome lives in the first pane's strip, not in a pane.** The first pane in
  reading order is always the top-left one. The workspace's controls go there
  once, rather than in whichever pane happens to be leftmost.
- **Do not key anything off `[role="tablist"]`** — the source rail has one.
  The strip marks itself `data-studio-tab-strip`.
- **`moveBefore` only works on a connected node.** It is how a pane changes
  pane without losing focus or scroll, but it throws on a detached one, so it
  is guarded by `isConnected` with a snapshot-and-restore fallback.
- **The strip survives an empty pane.** It carries the sidebar control, the
  pane menu and a way to open anything, so the empty state (`PaneLauncher`)
  goes inside it rather than in place of it.
- **An app fits the pane it is in, not the window.** Every pane host is a size
  container, and `tailwind.config.ts` adds `@max-xs:` / `@max-sm:` /
  `@max-md:` (under 380 / 520 / 640px of _pane_). Viewport breakpoints
  (`sm:`, `md:`) are the wrong tool inside a pane: a chat in a third of a wide
  monitor is narrow. The variants are max-width only, so outside a container
  nothing matches and a page of its own keeps its full layout. Prefer
  intrinsic layouts first — `flex-wrap`, `grid-cols-[repeat(auto-fill,…)]` —
  and a variant where something must change: the composer's toggles drop to
  icons, Meetings stacks its channel list above the channel.
- **An app does not draw its own title bar.** The tab names it and carries
  its description; a header bar per pane repeated the name a third time in
  half the width.
- **A window too narrow for panes folds them, and the fold is never saved.**
  Below the phone breakpoint every pane merges into one; persistence pauses
  while it does, and widening brings the saved arrangement back — without
  tabs closed in between, with tabs opened in between.
- **The layout is saved per member and workspace, on this device.** A saved
  layout is untrusted input: `sanitizeLayout` checks the tree names exactly the
  saved panes, drops tabs that cannot come back (a retired app, the mindmap
  editor without its map) and the panes they leave empty, and keeps anything
  opened before it arrived — a `?feature=` link, say.

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
