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

### Two hierarchies

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

## Tests

```bash
pnpm --filter @launchstack/web exec jest src/app/employer/mindmap
```

Model tests are pure. UI tests mount the real components against the real store;
jsdom does no hit-testing, so pointer gestures must be dispatched on the element
being grabbed (see `canvas.render.test.tsx`) — dispatching on the `<svg>` always
reports the `<svg>` as the target regardless of coordinates.
