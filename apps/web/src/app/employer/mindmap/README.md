# Mindmap

A diagramming app — mindmaps, flowcharts, org charts, ERDs, whiteboards — that
lives inside Launchstack rather than beside it. A finished diagram can be
**published back into the Sources library**, where it is chunked, embedded and
citable like any uploaded document. That round trip is the reason this is part
of the workspace instead of a link to a third-party tool.

## Where it is

| Surface     | Route                                           | What it is                                                                                     |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Gallery     | `/employer/mindmap`                             | Template picker + the workspace's documents, folders, trash                                    |
| Editor      | `/employer/mindmap/[id]`                        | The canvas                                                                                     |
| Entry point | Documents → **Add a source → Create → Mindmap** | Picks a template, creates the row, opens the editor                                            |
| Entry point | Documents → Studio → **Mindmap**                | Same app, from the feature menu (`external: true`, so it navigates rather than opening a pane) |

## Layout

```
_mindmap/
  model/     pure TypeScript — no React, no DOM, fully unit-tested
  ui/        React components and hooks
  lib/       browser-only helpers (export, image decoding, API client)
  __tests__/ unit tests for model/, render + interaction tests for ui/
```

The split is the point. `model/` holds the document type, the shape registry,
connector routing, layout, snapping, resize maths, history and serialisation —
all of it callable from a test with no canvas, which is why the geometry has
tests that assert _properties_ (an elbow's segments are axis-aligned; a rotated
resize keeps the opposite corner pinned) rather than screenshots.

### model/

| Module         | Responsibility                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `types.ts`     | The document shape. `DOC_SCHEMA_VERSION` lives here.                                                                 |
| `factory.ts`   | The only place a node/edge/page/doc literal is constructed.                                                          |
| `shapes.ts`    | ~60 shapes as pure `(w, h) → SVG path` functions. One registry drives the canvas, the palette thumbnails and export. |
| `geometry.ts`  | Rects, rotation, ports, polylines, viewport transforms.                                                              |
| `routing.ts`   | Straight / elbow / curved connectors, arrowhead orientation, bend insertion.                                         |
| `layout.ts`    | Tidy-tree layouts: mindmap (both sides), tree, org, radial, grid.                                                    |
| `snapping.ts`  | Grid quantisation, edge/centre alignment, equal-spacing detection.                                                   |
| `resize.ts`    | Resize in the shape's own rotated frame; multi-select box scaling.                                                   |
| `text.ts`      | Measurement and wrapping — SVG has no line breaking.                                                                 |
| `doc.ts`       | Queries and immutable edits. Two hierarchies: containment (`parentId`) and graph (edges).                            |
| `commands.ts`  | Every user-facing operation. Toolbar, menu, shortcut and palette all route through here, so they cannot drift.       |
| `store.ts`     | External store + snapshot-based undo/redo with gesture coalescing.                                                   |
| `serialize.ts` | The trust boundary. `parseDoc` never throws. Markdown/Mermaid/CSV import and export.                                 |
| `templates.ts` | Starter documents, built from the same factories.                                                                    |

### Nodes vs. annotations

The palette's first two groups carry the distinction that matters to someone
looking at a blank canvas — not which diagram type a shape came from, but
whether it is **a thing you type in and connect** (`Nodes`) or **a mark you
leave on the canvas** (`Annotate`). A sticky note is a node; a caption is not.
Everything after them is a shape library, browsed by name.

Three details keep that promise honest:

- Tiles are captioned and previewed with the colours `createNode` will actually
  give them, so `Topic` cannot be mistaken for the `Rounded rectangle` it shares
  an outline with.
- Placing any shape whose registry entry does not say `holdsText: false` drops
  straight into its label. A box you have to discover is double-clickable does
  not read as a container you put words in.
- `Topic` is on the tool rail beside `Connector`, because those two are the
  whole of "draw me a diagram".

## Two hierarchies

A page has both, and confusing them causes bugs:

- **containment** (`node.parentId`) — groups, frames, swimlanes. Moving a
  container moves its contents; deleting it deletes them.
- **graph** (edges) — the mindmap outline, collapse state, auto-layout.

Deleting a shape removes it and its _containment_ children only. A connector is
a relationship, not ownership: removing one box in a flowchart must not remove
the boxes downstream. "Delete and reconnect" and "Delete whole branch" are
separate commands on the context menu.

## Colours are data, not tokens

Shape fills and strokes are literal OKLCH values stored in the document, not
`var(--…)` references. A design token would repaint when the _viewer_ switches
theme, silently changing someone else's diagram. Editor chrome — panels,
toolbars, handles — uses the tokens as normal.

### Light and dark boards

A board's paper is part of the document, so "dark mode" here is a **document
theme**, not a viewer preference: ten of them in `model/palette.ts`, five light
and five dark, paired so each is the same identity under different lighting
(Launchstack ↔ Midnight, Ocean ↔ Abyss, …). Picking Midnight makes the board
dark for everyone who opens the file. A new document is seeded in whichever
theme matches the app theme of the person creating it — a choice made once and
stored, rather than a per-viewer repaint, which is how a dark-mode user stops
being handed a white page without breaking sharing.

Every swatch therefore has two tones (`SWATCHES` / `DARK_SWATCHES`, read
through `swatchFor(id, mode)`), and every node-creating path passes the
document's mode so a box dropped on a dark board is not born white. `docMode()`
in `commands.ts` is the single place that answers "which paper is this?".

### Chrome on the paper follows the paper

The corollary is easy to miss and was wrong for a long time: because the paper
does not follow the viewer's theme, **nothing drawn on the paper may follow it
either**. In dark theme `--ink-2` rises to 0.80 lightness and vanishes against
a white board; `--panel` goes near-black and turns selection handles and
arrowhead cutouts into blobs.

So the canvas `<svg>` carries `.paper` (`ui/Canvas.module.css`) plus a
`data-paper` attribute derived from `isDarkSurface(page.background.color)` —
the colour itself, not the theme id, so a custom background works too. That
rebinds the semantic names to one of two `--paper-*` sets defined in
`packages/design-tokens/tokens.css`, both in `:root` and neither overridden by
the app's dark block. Canvas chrome goes on writing `var(--accent)` like the
rest of the app and comes out right on any board.

Export resolves `var(--…)` through `getComputedStyle` on the live `<svg>`, so
it picks the same set up for free.

Two things sit _outside_ that scope on purpose — the rulers and the
text-editing field are siblings of the `<svg>`, not children — so anything of
theirs that lands on the paper says so itself. The editing field does: it
paints with the node's own fill and ink, which is also what stops it being
dark-on-black.

### Contrast is a tested property, not a matter of taste

`__tests__/theme.test.ts` asserts it over the whole palette rather than
spot-checking: every swatch's ink clears 4.5:1 on its own fill, every theme's
cycled stroke clears 3:1 on its own paper, and every label in a repainted
document is readable in all ten themes. Two colours were moved to satisfy it
(green's and amber's light strokes), and `readableInkOn()` picks a root topic's
label colour by measurement instead of by mode — near-white loses on a bright
violet root and wins on a mid violet one, and no fixed choice gets both.

The same contract governs the app's own ink ladder in `tokens.css`: `--ink-3`
is the smallest tier used for prose and must clear 4.5:1 on every surface in
its block; `--ink-4` is de-emphasised UI and must clear 3:1.

## Saving

The whole document is written as one `jsonb` value. Saves carry `baseRevision`;
a mismatch returns **409** with the winning document rather than overwriting.
Autosave debounces ~1.6s, ⌘S also writes a version-history snapshot, and
`pagehide` flushes via `sendBeacon` (which is why `/api/mindmaps/[id]` has a
POST alias — beacons cannot PATCH).

## Collaboration

Presence, not co-editing. A 4-second heartbeat records who has the document
open, their cursor and their selection, and returns the server's current
revision — so a stale tab learns about a colleague's save _before_ it tries to
write over it. Simultaneous editing of the same shape is not supported; the
optimistic-concurrency check is what keeps that safe rather than silent.

## Export

PNG, SVG and PDF are produced by **cloning the live canvas element**, not by a
second string-building renderer, so an export can never disagree with the screen
and every new shape works in export for free. The PDF is one page sized to the
diagram rather than a letter sheet with the drawing shrunk onto it — a diagram
has no natural paper size. Editor chrome is stripped by marking
it `data-export="omit"`, and `var(--…)` colours are resolved to literals so the
file opens anywhere. Images are stored as data URIs for the same reason: an SVG
loaded through `<img>` cannot fetch external resources, so a linked image would
vanish from every exported PNG.

## Working on the UI

`/dev/mindmap` mounts the editor inside the real chrome chain — employer layout
→ `DriftShell` → `ToolsStudioShell` → editor — with a template document and
`/api/mindmaps/*` answered locally, so the canvas can be driven without a Clerk
session or a row in the database. `?template=flowchart` picks a starter (ids in
`model/template-meta.ts`); `?view=gallery` shows the index page, which shares
the same shell and therefore the same layout bugs. The route 404s in
production.

Because it reproduces the chain rather than approximating it, layout that works
there works in the app: the shell is what has to hand the editor a *definite*
height, and getting that wrong is not visible from the editor alone.

## Tests

```bash
pnpm --filter @launchstack/web exec jest src/app/employer/mindmap
```

Model tests are pure. UI tests mount the real components against the real store;
jsdom does no hit-testing, so pointer gestures must be dispatched on the element
being grabbed (see `canvas.render.test.tsx`) — dispatching on the `<svg>` always
reports the `<svg>` as the target regardless of coordinates.
