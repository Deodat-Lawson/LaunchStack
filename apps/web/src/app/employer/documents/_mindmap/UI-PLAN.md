# Mindmap UI — what's wrong and how to fix it

Written after an audit of the shipped feature. Three complaints — _not smooth_,
_design_, _text_ — turn out to have distinct root causes, so they get separate
phases. Every claim below has a line-number citation; every fix has a way to
tell whether it worked.

**The one-line diagnosis:** the model layer is sound and tested, but the
_presentation_ layer was built without a performance budget, without the
design tokens the rest of the app uses, and with a text measurer that measures
a different font from the one it draws.

---

## Phase 1 — Smoothness (the jank)

This is the most damaging problem and the cheapest to fix. Dragging one shape
currently re-renders the entire editor twice per pointer event.

### 1.1 Two full re-render cascades per pointer move

`useCanvasInteractions.ts` move branch calls `store.setGuides(...)` and then
`store.updatePage(...)`. Each calls `emit()`, and each `emit()` re-renders
**every** subscriber.

> **Fix.** Add `EditorStore.batch(fn)` that sets a `suspended` flag, runs `fn`,
> then emits once. Wrap each gesture frame in it. ~20 lines in `store.ts`.

### 1.2 Twelve components subscribe to the whole document

`grep "useEditor(selectDoc)"` returns 12 hits: Canvas, Inspector, OutlinePanel,
CommentsPanel, Minimap, BottomBar, TopBar, TextEditorOverlay, FindBar,
CanvasContextMenu, ExportDialog, PublishDialog. All of them re-render on every
frame of a drag, though only the canvas can possibly look different.

> **Fix.** Give the store a `commitId` that increments only on non-transient
> updates. Panels subscribe to `commitId` instead of `doc` and read the document
> through `store.getState()` at render time. The canvas keeps subscribing to
> `doc`. Result: during a gesture exactly one component re-renders.

### 1.3 The canvas rebuilds the world every frame

`Canvas.tsx:71-148` — every `useMemo` is keyed on `page`, and `page` is a new
object on every transient update. Per pointer move that is: `visibleNodes`,
`visibleEdges`, a `nodeLookup` Map over all nodes, a `graphIndex` for
`childCounts`, `routeEdge` for **every** edge, and `nodeBounds` for **every**
node — whether or not anything about them changed.

> **Fix, in order of payoff:**
>
> 1. Cache `graphIndex` in a `WeakMap<DiagramPage, GraphIndex>` — free, and it
>    also speeds up layout and the outline.
> 2. Route edges incrementally: keep `Map<edgeId, {routed, fromNode, toNode,
waypoints}>` and recompute an edge only when one of its endpoint node
>    objects changed identity. A 200-edge diagram then re-routes the 1–2 edges
>    actually attached to what moved.
> 3. Same treatment for `nodeBoundsById`.

### 1.4 Every connector re-renders every frame

`EdgeView` is `memo`-ised, but its `routed` prop is a fresh object each frame,
so memoisation never hits. Fixed for free by 1.3.2.

### 1.5 Layout thrashing — three forced reflows per event

`useCanvasInteractions.ts:184,194` — `toWorld()` and `toScreen()` each call
`getBoundingClientRect()`. The move handler calls both, and `Canvas.tsx`'s
`onPointerMove` wrapper calls `toWorld()` a third time for presence. Each read
is interleaved with React renders that dirty layout, which is the textbook
layout-thrash pattern.

> **Fix.** Cache the canvas rect in a ref; refresh it on `pointerdown`, on
> resize (the `ResizeObserver` is already there), and on scroll. Zero reads
> during a gesture.

### 1.6 No pointer-event coalescing

Handlers run synchronously per event. A 120 Hz trackpad delivers 2–3 moves per
frame and each does all of the above.

> **Fix.** Store the latest event and flush in a `requestAnimationFrame`. Use
> `event.getCoalescedEvents()` for the ink tool, which genuinely wants every
> sample.

**Verify Phase 1:** Performance panel, 200-node diagram, drag one shape for 5s.
Target: 60 fps sustained, one `<NodeHit>` commit per frame instead of a full
tree. Add a dev-only render counter to make regressions obvious.

---

## Phase 2 — Text

### 2.1 The measurer measures the wrong font _(highest-impact single bug)_

`model/text.ts` — `fontShorthand()` measures in `system-ui, sans-serif`,
`Georgia`, `ui-monospace`. `FONT_STACK` renders in `var(--font-sans)` (Inter
Tight), `var(--font-serif)` (Instrument Serif), `var(--font-mono)` (JetBrains
Mono). **Every width in the app is measured in a font that is never drawn.**

Consequences visible on screen today: labels wrap in the wrong place, centred
text sits off-centre, "fit shape to text" produces boxes that don't fit, and
auto-layout reserves the wrong amount of room.

> **Fix.** Resolve the real family from the computed style of a probe element
> once at startup and feed that into the canvas `font` shorthand. Guard with
> `document.fonts.ready` and re-measure once web fonts land, otherwise the first
> paint measures the fallback and never corrects.

### 2.2 Baseline is a magic number

`firstBaseline()` uses `ascent = lineHeight * 0.78`. Correct for nothing in
particular; vertical centring is visibly low on large text.

> **Fix.** Use `TextMetrics.fontBoundingBoxAscent/Descent` (available in every
> browser we support), cached per font+size. Fall back to the 0.78 estimate only
> when metrics are unavailable.

### 2.3 Labels go mushy when zoomed out

Font size scales with zoom, so at 25% a 14px label renders at 3.5px. No hinting
hints are set on the SVG either.

> **Fix.** `text-rendering: geometricPrecision` on canvas text; below a
> readability threshold (~6px on screen) replace the label with a simple bar
> glyph, the way every map app does. Faster _and_ clearer.

### 2.4 Chrome typography has no scale

11 distinct ad-hoc sizes (`text-[10px]` … `text-[26px]`, including `text-[11.5px]`
and `text-[12.5px]`), and **zero** uses of the `--fs-*` scale the design system
already defines.

> **Fix.** Map to four roles — `micro` (11) for eyebrows, `small` (13) for panel
> body, `body` (15) for dialogs, `h4` (18) for titles — and delete the rest. Add
> the token sizes to `tailwind.config.ts` so `text-small` works, then codemod.

---

## Phase 3 — Design

### 3.1 Dark mode does not exist here

`grep "dark:"` in the Mindmap feature: **0**. The rest of `app/employer`: **154**.
The chrome uses semantic tokens so it _does_ flip — which produces the worst
possible result: dark panels framing a blinding white canvas.

> **Fix.** The document's `background.color` is deliberately document data (a
> shared diagram must not repaint per viewer), so the canvas keeps its paper
> colour. Instead: surround the paper with a dark deck (like Figma's canvas
> gutter), give the page a subtle border and shadow so it reads as a sheet, and
> add a per-user "dim paper in dark mode" preference that tints the _view_ only
> and is explicitly excluded from export.

### 3.2 No visual system — 6 radii, ad-hoc shadows

`rounded-md` ×29, `rounded-full` ×13, `rounded-lg` ×9, `rounded-xl` ×4, plus
`rounded-[3px]` and `rounded-[4px]`. Zero uses of `--r-*`.

> **Fix.** Three radii only: controls `--r-sm`, panels/cards `--r-md`,
> dialogs/thumbnails `--r-lg`. Pills stay `--r-full`.

### 3.3 Panels are fixed-width and not resizable

`MindmapEditor.tsx:289,378` hardcode `w-[264px]` and `w-[268px]`. Meanwhile
`react-resizable-panels` **and** `src/components/ui/resizable.tsx` already exist
in the repo, unused here.

> **Fix.** Move to `ResizablePanelGroup`, persist sizes in `localStorage`. A
> shape palette you cannot widen is the most-reported complaint about tools in
> this category.

### 3.4 Spinners where skeletons belong

13 `Loader2` spinners, 0 skeletons. The gallery flashes: spinner → sudden grid.

> **Fix.** Card-shaped skeletons in the gallery, and keep the canvas mounted
> while the document loads instead of swapping to a centred spinner.

### 3.5 No motion vocabulary

Only `transition-colors`. Nothing eases; panels and dialogs pop.

> **Fix.** Two durations (120ms for controls, 200ms for panels/overlays) and one
> easing token, applied through the kit. Respect `prefers-reduced-motion`.

### 3.6 The inspector is an undifferentiated wall

Every property has equal weight in one long scroll of 12px rows.

> **Fix.** Promote the three controls people reach for constantly — fill,
> stroke, text colour — into a compact swatch row pinned to the top; collapse
> Position/Size and Arrange into closed-by-default sections (`ui/collapsible`
> already exists).

---

## Sequencing

| Phase         | Why this order                                                     | Rough effort |
| ------------- | ------------------------------------------------------------------ | ------------ |
| 1. Smoothness | Jank makes everything else feel cheap, and it is mostly mechanical | 1–2 days     |
| 2. Text       | 2.1 is a genuine bug with visible wrong output today               | 1 day        |
| 3. Design     | Cosmetic, and easier to judge once the canvas is smooth            | 2–3 days     |

Phases 1 and 2 are independent and can run in parallel. 3.1 (dark mode) is the
only item with a product decision in it and should be agreed before building.

## Guardrails to add alongside

- A dev-only FPS + render-count HUD behind a query flag, so "is it smooth" stops
  being a matter of opinion.
- An ESLint rule banning `text-[Npx]` inside `app/employer/mindmap`, matching the
  existing hex-literal ratchet.
- A test asserting the measurement font stack equals the render font stack, so
  2.1 cannot silently come back.
