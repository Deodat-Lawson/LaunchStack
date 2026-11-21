# Designing UI in LaunchStack

How to design a screen so it looks and behaves like the rest of the app, and
where each kind of UI goes — in the product and in the repo. For people and
for coding agents.

- **See it live:** `/dev/design` on any dev server (`pnpm --filter
@launchstack/web dev`, then open `http://localhost:3000/dev/design`). Every
  specimen there is the real component, in either theme and language, with a
  complete template tool to copy.
- **Copy from:** `src/app/dev/design/template/` — a working Studio tool with
  the five screens most tools need.
- **Mechanics** (how fonts load, how tokens reach Tailwind, how panes host
  tabs) are in [`README.md`](README.md) and
  [`src/components/tool-app/README.md`](src/components/tool-app/README.md).
  This page is the design rules; those are the engineering ones. Where they
  overlap they agree.

Every rule below names the component, class or file it refers to. The numbers
in it were measured from the shipped tools in November 2026 (Growth,
Proposals, Vantage, Scenarios, Extract, Team, Meetings).

## Contents

1. [Principles](#1-principles)
2. [Where it goes](#2-where-it-goes)
3. [Foundations](#3-foundations)
4. [Components](#4-components)
5. [Patterns and the template tool](#5-patterns-and-the-template-tool)
6. [States](#6-states)
7. [Words](#7-words)
8. [Accessibility and quality](#8-accessibility-and-quality)
9. [Review checklist](#9-review-checklist)
10. [Known deviations — don't copy these](#10-known-deviations--dont-copy-these)

---

## 1. Principles

1. **A tab of the workspace, not an app of its own.** Every tool opens as a
   tab in `ToolFrame`: its screens across the top, the workspace sidebar the
   only sidebar, no route tree, no title bar of its own.
2. **One type scale, one left edge.** Titles from `PageHeader` (30 or 26px),
   section headings from `SectionHeading` (13px), text at 14/13/12px.
   Everything on a screen starts on the frame's content edge.
3. **Lead with the work.** The first thing on a screen is what people came
   for. No eyebrow labels, no marketing lines on working screens, no chrome
   that restates the tab.
4. **Quiet surfaces, one primary action.** One bordered panel per group,
   hairlines between rows, emphasis by weight and colour rather than more
   boxes. One filled button per view, next to what it acts on.
5. **Say it once.** A status, a count or a failure appears in one place. Every
   state — loading, empty, failed, not allowed, not found — is designed, not
   left to fall through.
6. **Fit the tab, both themes, both languages.** Lay out for a full-width tab
   and fold with container variants, never viewport ones. Tokens only, so dark
   mode is free. Every word from the catalogue.

---

## 2. Where it goes

Decide the surface before drawing anything. Each surface has one job; putting
something on the wrong one is the most common way a feature ends up feeling
like a different app. The library draws the workspace with each surface
numbered (`/dev/design#placement`).

### 2.1 The surfaces

| #   | Surface                              | For                                                                                                       | Not for                                                                                              | Where in code                                                                          |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | **Sidebar** (Sources, History)       | Making, filing and sharing sources: the tree, Add knowledge, chat history, the shares bell, account menu  | Anything else. Team, admin and tools are Studio tabs (ADR-014 §7). It is the only sidebar on screen. | `app/employer/documents/_workspace/SourceRail.tsx`, `HistoryRail.tsx`                  |
| 2   | **Studio tab**                       | A new area of work: a tool, a workspace app (Team, Models & usage), an admin area (Workspace)             | A view of something that already has a tab — that is a screen of that tab                            | `_workspace/types.ts` (`STUDIO_GROUPS`), `StudioPanes.tsx`, `studioPaneIds.ts`         |
| 3   | **Screen** (ToolFrame bar)           | Each view inside a tab: overview, a list, one record (a path under its list), a form, the tool's settings | A second sidebar, a title bar, or tabs of your own above the screen                                  | `src/components/tool-app/ToolFrame.tsx` (`groups`)                                     |
| 4   | **Screen header**                    | The title, one line of context, the screen's primary action and at most two more                          | A run in progress (that is `ToolFrame`'s `status`, so it shows on every screen)                      | `src/components/tools/PageHeader.tsx`                                                  |
| 5   | **Sheet**                            | Reading or editing beside the screen without leaving it: details, history, a run's progress               | A short task with an end — that is a dialog                                                          | `src/components/ui/sheet.tsx` (inside `ToolFrame` it covers that tab only)             |
| 6   | **Settings** (account menu)          | A person's own preferences: account, appearance, shortcuts, privacy                                       | Workspace policy (Workspace tab), models, keys and spending (Models & usage), one tool's behaviour   | `_workspace/SettingsHub.tsx`, `src/lib/settings/surfaces.ts`                           |
| 7   | **Inbox bell**                       | Something someone else did, to look at later: a share, a reply to your feedback                           | The result of what you just did — that is a toast                                                    | `_workspace/team/InboxBell.tsx`                                                        |
| 8   | **⌘K palette and right-click menus** | Jumping anywhere; running verbs. An app-level verb registered once appears in both                        | Being the only way to a verb: every menu item is also a visible control somewhere                    | `_workspace/CommandPalette.tsx`, `src/components/context-menu`, `src/lib/context-menu` |

Today's Studio tabs, by group (`STUDIO_GROUPS` in `_workspace/types.ts`):

- **workspace** — Chat, Knowledge, Meetings, Agents, Team
- **tools** — Growth, Proposals, Investor relations, Vantage, Scenarios, Extract
- **management** — Workspace, Settings, Models & usage
- **link-only** (open from a link, not the picker) — Mindmap, Workflows, Feedback

Everything in _tools_ and _management_ (except Settings, see §10) and Team and
Feedback sits on `ToolFrame`.

### 2.2 Choosing a surface

Ask in order; take the first yes.

1. **Is it about making, filing or sharing files, folders or chats?** → The
   sidebar. Nothing else goes there.
2. **Is it a new area of work with screens of its own?** → A Studio tab on
   `ToolFrame`. Follow `tool-app/README.md` › "Adding a tool", and pick the
   group: _workspace_ for everyday collaboration, _tools_ for a job someone
   runs, _management_ for administration.
3. **Is it another view of something a tab already holds?** → A screen of that
   tab: an item in its `groups`, or a path under a list for one record
   (`/contracts/:id`).
4. **Is it a setting?** → Yours alone: Settings. The whole workspace's: a
   section of the Workspace tab. Models, keys, spending: Models & usage. Only
   about one tool: that tool's own Settings screen.
5. **Is it a short task with an end and up to three or four inputs** (rename,
   share, record a decision)? → `Dialog`. "Are you sure?" is a
   `ConfirmDialog`, never `window.confirm` (embedded web views silently refuse
   it).
6. **Is it something to read or change beside the screen?** → `Sheet`.
7. **Is it a small choice or detail anchored to one control?** → `Popover` for
   a choice, `HoverCard` for a preview, `Tooltip` to name an icon.
8. **Is it a verb on an object?** → The object's menu: `useContextTarget` and a
   pure item builder, opened by right-click and by the object's "⋯" button.
   An app-wide verb registers with `useRegisterActions` and so also appears in
   ⌘K.
9. **Is it feedback?** → Just did it: a toast. A lasting state: an `Alert` on
   the screen. From someone else, for later: the inbox bell.
10. **Is it a page outside the workspace** (sign-in, join, onboarding)? → A
    full page on `PageShell` (`src/components/layout/page-shell.tsx`). This is
    rare; ask before adding one.

### 2.3 Where the files go

Take the first that exists: the kit, then a shared component, then your own
folder. Shared pieces never live in a route folder another feature imports
from, and nothing imports across route areas.

| You are adding                    | It goes in                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A primitive (button-level)        | `src/components/ui/<name>` via `npx shadcn@latest add <name>` (run in `apps/web`), then re-themed to the tokens                 |
| A piece two or more features use  | `src/components/tools/` (tool screens), `src/components/layout/`, `src/components/field.tsx`                                    |
| Frame, tab history, tool links    | `src/components/tool-app/` — use it, never fork it                                                                              |
| A Studio tool                     | `src/app/employer/tools/<tool>/` with `<Tool>Tool.tsx`, `_screens/`, `_components/`, `_lib/` (screens, links, format), `api.ts` |
| A workspace app or admin area     | `src/app/employer/documents/_workspace/<app>/`                                                                                  |
| A Settings section                | `src/app/employer/documents/_workspace/settings/<Name>Section.tsx`, registered in `src/lib/settings/`                           |
| Right-click items                 | A pure builder, `<thing>ContextMenu.ts`, beside the surface                                                                     |
| Words                             | `src/i18n/messages/en/<namespace>.json` and `zh-CN/<namespace>.json`, registered in both `index.ts`                             |
| Logic shared by server and client | `src/lib/<area>/`                                                                                                               |
| A feature brick (no React)        | `packages/<name>/` (ADR-008; lint enforces the layers)                                                                          |
| Colour, type, radius tokens       | `packages/design-tokens/tokens.css` + `tailwind.config.ts` — rarely; discuss first                                              |
| A preview that needs no login     | `src/app/dev/<name>/`, gated by `devRoutesEnabled()` (`src/app/dev/enabled.ts`)                                                 |

---

## 3. Foundations

Everything comes from `packages/design-tokens/tokens.css` through the semantic
Tailwind names in `tailwind.config.ts`. Use the names. Never a hex value,
never the raw Tailwind palette (`purple-600`, `slate-800`), never a new
inline `style` colour, never the retired shadcn names (`bg-background`,
`text-muted-foreground`). Then dark mode (`data-theme="dark"` on `<html>`)
costs nothing.

### 3.1 Colour

| Role     | Classes                                                                                          | Use                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Surfaces | `bg-surface` (the tab), `bg-surface-2` (sidebar, strips), `bg-panel`, `bg-panel-2`               | Grouped content sits on `bg-panel` with `border-line`; `bg-panel-2` is hover and quiet fills                   |
| Ink      | `text-ink`, `text-ink-2`, `text-ink-3`, `text-ink-4`                                             | Titles and values; body; meta and hints; decoration only                                                       |
| Lines    | `border-line`, `border-line-2`                                                                   | Panel and control borders; hairlines between rows                                                              |
| Brand    | `bg-brand`, `text-brand-fg`, `bg-brand-soft`, `text-brand-ink`                                   | The one primary action, the current place (active tab = `bg-brand-soft text-brand-ink`), links, an accent word |
| Status   | `success`, `warn`, `info`, `danger`, each with `-soft` and `-ink` (`bg-warn-soft text-warn-ink`) | Base for dots, icons, borders; soft for fills; ink for words                                                   |

- **The ink ladder is a contrast contract** (measured in `tokens.css`, and live
  in the library): `ink` and `ink-2` for body, `ink-3` is the lightest tier
  for any word (≥4.5:1), `ink-4` is never text (≥3:1, decoration and disabled
  glyphs).
- **Status words use the `-ink` token.** The base status colours measure
  2.4–3.5:1 as text; they are for dots, icons, fills and borders.
- **Purple means "do this" or "you are here".** Not decoration, not section
  backgrounds, not icons in lists.
- **Never colour alone.** A status always has its word; a chart its labels.
- **The two exceptions:** the code surface (`--code-*`, dark in both themes)
  and the Mindmap's paper colours, which are document data, not tokens (see
  `_mindmap/README.md`).

### 3.2 Type

Inter for every word of UI, JetBrains Mono for code — loaded once in
`src/app/fonts.ts`; never name a family. Eight roles, five text sizes,
nothing under 12px. Weights 400, 500, 600.

| Role                 | Use                                | Size / weight                      | Where                                  |
| -------------------- | ---------------------------------- | ---------------------------------- | -------------------------------------- |
| Screen title         | `PageHeader` (default `size="lg"`) | 30px / 600; 28px under 640px tab   | A tool's home and its lists            |
| Record title         | `PageHeader size="md"`             | 26px / 600; 24px under 640px       | One record, a form, a tool's settings  |
| Section heading      | `SectionHeading`                   | 13px / 600, `text-ink`             | Every group on a screen                |
| Body, controls, rows | `text-sm`                          | 14px / 400; row names 500          | Default text                           |
| Secondary            | `text-[13px]`                      | 13px, `text-ink-2` or `text-ink-3` | Sub lines, descriptions, notices       |
| Meta                 | `text-xs`                          | 12px, `text-ink-3`                 | Captions, table headers, badges, hints |
| Figure               | `text-xl font-medium tabular-nums` | 20px / 500                         | A number in a stat tile                |
| Code, IDs, keys      | `font-mono text-[12px]`            | 12px                               | Identifiers, shortcuts, paths          |

- **One title per screen**, always from `PageHeader` in
  `src/components/tools/PageHeader.tsx` (40 files use it). The `PageHeader`
  in `src/components/layout/page-shell.tsx` (34px) is for the rare full page
  outside the workspace.
- **Accent words only on a home screen.** `PageHeader`'s `accent` sets one
  phrase in brand ink ("Renewals _this quarter_"), as Growth, Proposals and
  Vantage do on their homes. A list, a record or a form has a plain title.
- **No uppercase tracked eyebrows** above titles or sections. They read as a
  template, and at 10–11px they fall below the contrast floor.
- **No fractional sizes** (12.5, 11.5, 13.5, 10.5px) in new code; together
  they made nine sizes on one Settings screen.
- **`tabular-nums` on every number** in a list, a table or a tile, so columns
  of digits line up; amounts right-aligned.
- The `--fs-*` tokens in `tokens.css` are the marketing site's scale; the app
  uses the table above.

### 3.3 Space and layout

| What           | Value                                               | From                                                             |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Screen padding | 32px sides, 24px top, 48px bottom; 16px under 640px | `ToolFrame` — never add your own                                 |
| Content column | max 1080px, centred, sections 28px apart            | `mx-auto flex max-w-[1080px] flex-col gap-7`                     |
| Form column    | max 640px, on the left edge of the content column   | `max-w-[640px]`                                                  |
| Reading width  | about 70 characters                                 | `max-w-[70ch]`                                                   |
| Inside a group | 8 / 12 / 16px; rows `px-4 py-2.5`                   | `gap-2`, `gap-3`, `gap-4`                                        |
| Two columns    | main + 280px side, 28px gap; stack under 880px      | `grid grid-cols-[minmax(0,1fr)_280px] gap-7 @max-lg:grid-cols-1` |

A tab is a size container, so screens fold by **the tab's width**, not the
window's — a tool in a third of a wide monitor is narrow. Use the container
variants (`tailwind.config.ts`), never `sm:`/`md:`/`lg:` inside a tab:

| Variant   | Tab narrower than | Typical change                                                |
| --------- | ----------------- | ------------------------------------------------------------- |
| `@max-xl` | 1120px            | Drop a third column                                           |
| `@max-lg` | 880px             | Side column stacks under the main one                         |
| `@max-md` | 640px             | Titles step down; low-value table columns hide; padding 16px  |
| `@max-sm` | 520px             | ToolFrame folds screens into a menu; label/control rows stack |
| `@max-xs` | 380px             | Toolbar buttons go icon-only                                  |

- Reach for intrinsic layouts first — `flex-wrap`,
  `grid-cols-[repeat(auto-fill,minmax(250px,1fr))]` — and a variant only
  where something must change.
- **One left edge.** Title, filters, tables and forms all start at the
  content column's edge. (Settings once had its title at x=420 and content at
  x=446.)
- A width-based hide goes on an element **with no display class of its own**:
  `@uploadthing/react/styles.css` loads after the app's CSS and redefines
  `.flex`/`.hidden`, so `flex @max-md:hidden` on one element never hides.

### 3.4 Radius and elevation

| Class          | Size | Use                                                |
| -------------- | ---- | -------------------------------------------------- |
| `rounded-sm`   | 6px  | Inline chips, a focus ring on a text link          |
| `rounded-md`   | 8px  | Controls: buttons, inputs, badges, menu items      |
| `rounded-lg`   | 10px | Panels, lists, tables, stat tiles, alerts, dialogs |
| `rounded-full` | —    | Avatars, status dots                               |

- Three radii and full. Not `rounded-xl`, `rounded-2xl` or `rounded-[14px]`
  (111 legacy uses between them).
- **Elevation belongs to overlays.** Panels in the page get `border-line`, no
  shadow; the kit's popovers, menus, dialogs and sheets bring their own
  (`shadow-2` and up). A shadow on something in the flow makes it look
  draggable.
- Stacking uses the z tokens (`z-sticky`, `z-dropdown`, `z-modal`, `z-toast`,
  `z-tooltip`), never a number.

### 3.5 Icons

- `lucide-react` only, at its default stroke; brand marks from
  `src/components/icons/brand`. Other icon sets are a lint error.
- 16px (`size-4`) beside 14px text — kit buttons size it for you, so don't
  pass a size inside a `Button`; 14px (`size-3.5`) in 12–13px rows.
- A tool's mark is `ToolMark` (`ToolFrame.tsx`): one lucide glyph on the brand
  tile, so every bar starts the same way.
- An icon-only button has an `aria-label` and a `Tooltip` with the same words.

### 3.6 Motion

- Short (150–200ms) and functional: something appears, moves or confirms.
  No decorative animation in working screens.
- Loading states wait 150ms, then fade in (`animate-loader-in`), so a fast
  load shows nothing.
- Reduced motion is honoured globally (`globals.css`, the OS setting and the
  member's own) — don't add motion that bypasses it.

---

## 4. Components

Take the first that exists:

1. **The kit**, `src/components/ui/<name>` — shadcn primitives re-themed on
   the tokens. Per-file imports, no barrel.
2. **Shared pieces** — `src/components/tools/` (`PageHeader`,
   `SectionHeading`, `EmptyState`, `InlineError`, `SkeletonRows`,
   `SkeletonBlock`, `Cite`), `src/components/tool-app/` (`ToolFrame`,
   `ToolMark`, `ToolNotFound`, `ToolLink`), `src/components/field.tsx`
   (`Field`), `src/components/context-menu/`.
3. **Your feature's own** `_components/`.

A missing primitive is added with `npx shadcn@latest add <name>` and
re-themed to tokens (`alert` was added this way) — never hand-rolled. Every
component below is live in `/dev/design#components`.

### 4.1 Actions

| `Button` variant | Use                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `default`        | The one primary action of a screen, dialog or form. One per view.                             |
| `outline`        | Secondary actions beside it: Export, History, Manage                                          |
| `ghost`          | Cancel, icon buttons, actions inside rows and toolbars                                        |
| `link`           | An action that reads as a link inside text                                                    |
| `destructive`    | Only as the confirm button of a `ConfirmDialog`; elsewhere a delete is outline or a menu item |
| `secondary`      | Rarely; prefer outline                                                                        |

- **Size by place:** `size="sm"` (32px) in screen headers, filter rows,
  toolbars and rows; default (36px) in forms and dialogs; `lg` only on full
  pages; `size="icon"` for icon buttons (`className="size-8"` in dense rows).
- **Label with verb + object:** "Create renewal", "Save decision" — never OK,
  Submit or Yes. Add "…" when the item opens a dialog.
- **Always `Button`** — a raw `<button>` skips the focus ring, disabled state
  and sizing. Navigation is `<Button asChild><ToolLink …></Button>`.
- **Busy:** keep the label, disable, put a `Spinner` before it ("Saving…").
- `ToggleGroup` / `Toggle` switch a view or mode **in place** (list/grid, a
  filter). Never for moving between screens — those are `ToolFrame` tabs.

### 4.2 Status and notices

- **`Badge`** for a status chip. One mapping per tool from state to tone:
  attention `warn`, good outcome `success`, in progress `info`, inactive
  `secondary`, ended `outline`; `danger` for failed. The word is always
  there. Don't badge every row with the status its section heading already
  states.
- **`Alert`** (`src/components/ui/alert.tsx`, new) for a lasting state on the
  screen in one or two sentences: `default`, `info`, `success`, `warn`,
  `danger`, with an optional lucide icon and `AlertTitle`. Use it instead of
  the hand-built notes (`StatusNote`, `ErrorNote`, local `Notice` copies) in
  new code.
- **`InlineError`** (`components/tools/EmptyState.tsx`) for a load that
  failed, with Retry.
- **Toasts** (`sonner`: `toast.success`, `toast.error`, `toast(…, { action })`)
  for the result of something the person just did. Short, past tense, no
  "successfully". Offer Undo instead of asking first when the action is
  reversible.
- **`Progress`** when you know how far; **`Spinner`** beside a word when you
  don't (kit `Spinner`, not a raw `Loader2` with `animate-spin`);
  **`Skeleton`** at the real size of what is coming.

### 4.3 Inputs and forms

- **`Field`** (`src/components/field.tsx`) around every control: label above,
  hint under, error in place of the hint, `htmlFor` wired to the control's
  `id`. The kit `Input`, `Textarea` and `Select` go inside it.
- **A label on every control.** A placeholder is an example, never the label.
- `Switch` for a setting that takes effect now; `Checkbox` inside a form you
  submit; `RadioGroup` for two to five visible choices; `Select` for more;
  `Slider` only where the exact number matters less than the feel.
- **Validate on submit**, show each error under its field in words that say
  how to fix it ("Name the vendor.", not "Invalid input"), and move focus to
  the first one.
- **Buttons at the end of the form**, next to what they submit — primary
  first, then Cancel as `ghost`. Not in the screen header 700px away.
- Kit fields take their font size from `className` alone (`text-[13px]` in a
  filter row); the 16px-on-phones default lives in `globals.css`.

### 4.4 Lists and tables

| You want to                                | Use                                                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scan things by name, one or two lines each | The row list: `ul.border-line bg-panel overflow-hidden rounded-lg border` with rows `border-line-2 border-t first:border-t-0 px-4 py-2.5`, name `text-sm font-medium`, meta `text-xs text-ink-3`, hover `bg-panel-2` |
| Compare things across columns              | Kit `Table` inside `border-line bg-panel overflow-hidden rounded-lg border`; headers `text-ink-3 text-xs`; numbers `text-right tabular-nums`                                                                         |
| Show a few figures                         | Stat tiles: `dl` grid of `border-line bg-panel rounded-lg border px-4 py-3`, label `text-xs text-ink-3` above the figure                                                                                             |
| Show a record's facts                      | A `dl`: label `text-xs text-ink-3` above value `text-sm`, or label-left rows in a panel                                                                                                                              |

- The row's name is the link (`ToolLink`); the whole row may also open on
  click, ignoring clicks on its own buttons.
- Each row's verbs are one menu, from `useContextTarget` on the row plus a
  "⋯" `Button` that opens the same items with `useActionMenu().open(…)`. A row
  inside `<tbody>` declares itself with the hook — a wrapper element is not
  allowed there.
- Columns that matter least hide as the tab narrows (`@max-md:hidden` on the
  `TableHead` and its `TableCell`s).
- `SkeletonRows` at the same row height while loading, so nothing jumps.
- The kit `Card` (`rounded-xl`, header/content/footer) is for the rare
  composition that needs all three; a group of content is the plain panel
  above. Never a card inside a card.

### 4.5 Overlays and menus

| Need                                      | Use                                      | Not                                             |
| ----------------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| A short task with an end, ≤3–4 inputs     | `Dialog`                                 | A screen, or a `Sheet`                          |
| "Are you sure?"                           | `ConfirmDialog`                          | `window.confirm`                                |
| Read or edit beside the screen            | `Sheet` (pane-scoped inside `ToolFrame`) | A new screen that loses the place               |
| A small choice on one control             | `Popover`                                | A dialog                                        |
| A list of choices from a button (sort by) | `DropdownMenu`                           | `Select` (that is a form value)                 |
| An object's verbs                         | `useContextTarget` + a builder           | A hand-rolled menu, or a `DropdownMenu` per row |
| A preview on hover                        | `HoverCard` (never the only way in)      | —                                               |
| Name an icon button                       | `Tooltip` + `aria-label`                 | The tooltip as the only label                   |

- **Dialog anatomy:** `DialogTitle` says the task ("Record a decision"),
  `DialogDescription` what happens, `DialogFooter` holds Cancel (`outline`)
  then the primary, labelled with its verb.
- **`ConfirmDialog`** title is the question ("Delete this renewal?"); the
  description says what is lost and whether it can be undone.
- **Menus** (`src/components/ui/action-menu`, via
  `src/components/context-menu`): a `label` item with the object's name
  first, verbs next, destructive last after a separator with `danger: true`.
  Build items in a pure function beside the surface so the set can be
  unit-tested (`template/menu.ts`).

### 4.6 Tool pieces

| Piece                           | From                      | Use                                                                       |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `ToolNavProvider`               | `tool-app/nav.tsx`        | The tab's own history; mount once per tool                                |
| `ToolFrame`                     | `tool-app/ToolFrame.tsx`  | The bar and content column every tool sits in                             |
| `ToolMark`                      | `tool-app/ToolFrame.tsx`  | The tool's tile                                                           |
| `ToolLink`                      | `tool-app/ToolLink.tsx`   | Every link inside a tool (never `next/link` there)                        |
| `ToolNotFound`                  | `tool-app/ToolFrame.tsx`  | A path with no screen, or a record that has gone                          |
| `PageHeader`                    | `tools/PageHeader.tsx`    | The screen's title block                                                  |
| `SectionHeading`                | `tools/PageHeader.tsx`    | Each group's heading, with an optional `aside` (a count, a link)          |
| `EmptyState`                    | `tools/EmptyState.tsx`    | Empty and filtered-empty                                                  |
| `InlineError`                   | `tools/EmptyState.tsx`    | A failed load with Retry                                                  |
| `SkeletonRows`, `SkeletonBlock` | `tools/SkeletonRows.tsx`  | Loading lists and text                                                    |
| `Cite`, `SourceLink`            | `tools/Cite.tsx`          | A claim grounded in a document, and a link that opens it in the workspace |
| `useToolFormat`                 | `src/lib/tools/format.ts` | Relative times, short dates and durations in the interface language       |

---

## 5. Patterns and the template tool

`src/app/dev/design/template/` is a complete tool, "Renewals", built only
from §4. It is live at `/dev/design#templates`, where switches show each
screen at each tab width (1120 / 760 / 560 / 390px) and in each state, in
both themes and both languages.

**To start a tool from it:** copy the folder to `src/app/employer/tools/<tool>/`,
rename the `designTemplate` namespace in both catalogues, replace
`useContracts()` in `data.ts` with your API call (keep its
`{ status, data, retry }` shape), and register the tab
(`tool-app/README.md` › "Adding a tool"). `RenewalsTool.tsx` says the same at
its top.

### 5.1 The tool tab — `RenewalsTool.tsx`

- `ToolNavProvider` → `ToolFrame` with `title`, `mark={<ToolMark icon={…} />}`,
  `about` (one sentence, shown in the ⋯ menu) and the screens as `groups`.
- Screens are a plain switch over the path that ends in `ToolNotFound`.
- Up to about eight screens fit one row; a tool's own Settings goes in its own
  group, so a hairline sets it apart.
- No title bar, no sidebar, no padding of the tool's own — the frame owns
  them. A screen that lays itself out to the full height (an editor, a chat)
  passes `fill`.
- Any `window` key listener checks `useToolActive()`: tabs are hidden, not
  unmounted.

### 5.2 Home — `OverviewScreen.tsx`

`PageHeader` with an accent phrase, a one-line summary and the primary
action; stat tiles if the figures drive a decision; then sections, most
urgent first, each opening with `SectionHeading`; a two-column pair that
stacks at `@max-lg`. First run replaces all of it with one `EmptyState`
carrying the primary action — no tiles of zeros, no empty sections.

### 5.3 List — `ContractsScreen.tsx`

`PageHeader` (plain title, a count as the sub line, the primary action), one
filter row on the left edge (search `Input` at `h-8`, a `Select` at
`size="sm"`), then a kit `Table` in a panel with right-click and ⋯ on every
row and the least useful columns hiding as the tab narrows. "Filtered to
nothing" is its own `EmptyState` with Clear filters, distinct from "nothing
yet".

### 5.4 Record — `ContractScreen.tsx`

`PageHeader size="md"` with the status `Badge` and the one fact that matters
most in the sub line; one filled action, the rest outline or behind ⋯. Main
column for what the record says, a 280px column for its facts; they stack at
`@max-lg`. A passage quoted from a document names the document and page and
opens it there (`/employer/documents?source=…&find=…&page=…`). Back is the
frame's ‹ — no back button of the screen's own. A short task is a `Dialog`
(Record decision); something to read beside it is a `Sheet` (History).

### 5.5 Form — `NewScreen.tsx`

A screen when it has more than three or four inputs (fewer: a dialog).
`PageHeader size="md"`, a single `Field` column at most 640px wide on the
left edge, no card around it; pairs of short fields may share a row that
stacks at `@max-sm`. Validate on submit and focus the first error. Buttons at
the end, above a hairline: the primary names what it makes, Cancel goes back.

### 5.6 Tool settings — `SettingsScreen.tsx`

Label-left rows in one panel: what the setting is and what it does on the
left, the control on the right, stacking at `@max-sm`. A setting applies when
it changes — no Save button for switches and pickers. An `Alert` states what
"off" means for people. The destructive action is last, in its own
danger-bordered panel, and asks first.

---

## 6. States

Design all of them, for every screen. The template's State switch shows each.

| State             | Show                                                                                       | With                                        |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Loading           | The screen's own shape at its real size; the title stays, its sub line a skeleton          | `SkeletonRows`, `SkeletonBlock`, `Skeleton` |
| Empty (first run) | What the tool does, and the one control that starts it                                     | `EmptyState` with `action`                  |
| Empty (filtered)  | That nothing matches, and Clear filters                                                    | `EmptyState`                                |
| Failed to load    | What failed, and Retry                                                                     | `InlineError`                               |
| Working (a run)   | Progress where it happens, and the frame's `status` so there is a way back from any screen | `ToolFrame` `status`, `Progress`, `Alert`   |
| Not allowed       | One line saying why and who can change it; controls disabled with the reason, never hidden | `Alert`, disabled controls with a `title`   |
| Not found         | That it has gone, and a way to the tool's home                                             | `ToolNotFound`                              |
| Done              | A toast in the past tense; the screen already shows the new state                          | `toast.success`                             |

A whole tab still loading its code shows `LoadingPage variant="pane"`
(`src/app/_components/loading.tsx`).

---

## 7. Words

**Every word comes from the message catalogue** — text, `placeholder`,
`title`, `aria-label`, toasts, empty states, option labels in constant arrays
— through `useTranslations` / `getTranslations`, in English and Simplified
Chinese. Add the keys to `src/i18n/messages/en/<namespace>.json` and
`zh-CN/<namespace>.json` and register a new namespace in both `index.ts`;
`npx jest src/i18n` checks they match. Use `common` (`common.actions.cancel`)
when the meaning is exactly the same. Mechanics: `src/i18n/README.md`.

**The bar for any line** (the team's rule from the November 2026 text audit):
a line stays if it tells the reader something they need to decide or act and
can't get from the label — a consequence, a limit, a next step, behaviour
they wouldn't expect. A line goes if it restates its label, describes server
internals the reader can't see or change, hedges on a condition they can't
check, reassures without informing, repeats a list already on screen,
explains obvious mechanics ("drag or click"), or is marketing copy inside the
app.

- **Sentence case** everywhere: titles, buttons, tabs, menu items.
- **Plain and specific:** "Notice due in 11 days", not "Upcoming deadline".
- **Buttons are verb + object;** menu items that open a dialog end in "…".
- **Errors say what happened and what to do:** "Couldn't load contracts." with
  Retry; "Name the vendor." under the field.
- **Numbers, dates and money through the formatter** (`useFormatter`,
  `useToolFormat`), never string-built, so they follow the language. Plurals
  through ICU (`{count, plural, one {# contract} other {# contracts}}`).
- **Words for the reader, not the system:** "Reminders are off. Owners won't
  hear about notice dates.", not "Reminder service disabled".
- Text the reader doesn't need to see but a screen reader does (a sheet's
  description that would restate its title) goes in `sr-only`.

---

## 8. Accessibility and quality

- **Contrast:** words at `text-ink-3` or darker; status words in `-ink`
  tokens. The library measures every pair live in both themes.
- **Keyboard:** everything clickable is focusable and shows the ring
  (`focus-visible:ring-brand/50`); kit components do this — a raw element
  must add it. Right-click menus also open with Shift+F10 and from the ⋯
  button.
- **Names:** every icon-only button has `aria-label`; every control a label
  (`htmlFor`); every dialog a title; a status chip has its word.
- **Live regions:** `Alert` announces politely (`danger` interrupts);
  `InlineError` is `role="alert"`; `Spinner` is `role="status"`.
- **Targets:** 32px minimum (`size="sm"`); don't shrink buttons with `h-7`.
- **Theme and language:** check every screen in light and dark, in English
  and Chinese (the library's switches at the top right), and at 390px.

---

## 9. Review checklist

Paste into the pull request of any change that adds or changes UI.

```md
**Place**

- [ ] On the right surface (DESIGN.md §2); nothing new in the sidebar unless it is about sources
- [ ] A new area is a Studio tab on ToolFrame; its views are screens in the bar
- [ ] Files where §2.3 says; nothing imported across route areas

**Look**

- [ ] Kit and shared pieces only; no raw <button>, no hand-rolled overlay or menu
- [ ] Semantic colour classes only; no hex, palette colour or inline style colour
- [ ] Titles from PageHeader (30/26px), sections from SectionHeading; text 14/13/12px, nothing smaller
- [ ] One left edge; ToolFrame's padding only; radii sm/md/lg/full; no shadows in the page flow
- [ ] One filled button per view, next to what it acts on; labels are verbs

**Behave**

- [ ] Loading, empty, filtered-empty, failed, not allowed and not found each designed
- [ ] Folds by tab width (@max-\*); checked at 1120, 760, 560 and 390px
- [ ] Every object verb in its menu and reachable without right-click
- [ ] window key listeners gated on useToolActive()

**Words and access**

- [ ] Every word from the catalogue, en + zh-CN; `npx jest src/i18n` passes
- [ ] Checked in light and dark; text at ink-3 or darker
- [ ] Keyboard focus visible; icon buttons have aria-label + tooltip
```

---

## 10. Known deviations — don't copy these

Shipped code that predates this guide. Leave it until you are changing that
screen for feature work; then convert the region you touch (the repo's
touch-it-migrate-it rule). Never copy these into new code.

| Where                                                                         | What                                                                                            | Instead                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Settings (`_workspace/SettingsHub.tsx`)                                       | Its own 240px rail inside the tab, and no `ToolFrame` bar — the only management tab without one | `ToolFrame` screens across the top                                   |
| Settings sections (`settings/SectionView.tsx`)                                | Save button in the header, far from the fields                                                  | Buttons at the end of the form                                       |
| `StatusNote` (`settings/ui.tsx`), `ErrorNote`, local `Notice` copies          | Inline-styled notices, seven variants                                                           | `Alert`                                                              |
| `team/ui.tsx` `SectionHeading` (Team, Usage, Feedback)                        | 11px uppercase tracked headings                                                                 | `SectionHeading` from `tools/PageHeader`                             |
| Meetings (`_workspace/collab/`)                                               | 9.5–11.5px text, 7px radius, uppercase labels, 15px/700 section titles                          | §3.2 type scale, §3.4 radii                                          |
| Detail screens across tools                                                   | Record titles at 22 or 24px, some not in the display face                                       | `PageHeader size="md"` (26px)                                        |
| `page-shell` `Card`                                                           | 14px radius                                                                                     | `rounded-lg` panel                                                   |
| `Field` (`components/field.tsx`)                                              | Hint and error at 11px, under the 12px floor                                                    | Keep using `Field`; the size is to be raised in the component itself |
| Three `StatusPill` copies (extract, scenarios, people) + Vantage `StatusWord` | Dot-and-word pills, each its own                                                                | `Badge`                                                              |
| 366 raw `<button>` elements, ~1,000 inline `style={{…}}`                      | Bypass the kit and tokens                                                                       | `Button`, classes                                                    |
| Buttons with `className="h-7"` (58)                                           | Below the 32px target                                                                           | `size="sm"`                                                          |
