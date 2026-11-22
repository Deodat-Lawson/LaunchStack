# Mindmap

A diagramming app — mindmaps, flowcharts, org charts, ERDs, whiteboards — that
lives inside the Documents workspace rather than beside it. A diagram can be
**made citable**: the server renders its outline and runs it through ordinary
ingestion, so it is chunked, embedded and cited like any uploaded document,
and re-publishing updates that one document as a new version rather than
adding another. That round trip is the reason this is part of the workspace
instead of a link to a third-party tool.

## Where it is

A mindmap is a **source**. It has no pages of its own: it is listed in the
Documents workspace beside every upload, found by the same three search boxes
(the rail, Knowledge, ⌘K — node labels included), filed in the same folders,
and opened, renamed, moved and deleted through the same controls.

Everything a map opens is a tab of the workspace's centre, like any other
source or Studio app.

| Surface | Where                                                  | What it is                                                                                                  |
| ------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Preview | A tab named after the map                              | The workspace viewer showing the live canvas read-only (`ui/MindmapPreview`), with **Edit**                 |
| Editor  | The **Mindmap** tab, `?source=m<id>&edit=1` while open | `MindmapEditor` in the workspace's centre; the rail stays. One map at a time; never restored on reload      |
| Create  | Sidebar → **Add knowledge → Mindmap**                  | Picks a template, creates the row, opens the editor in place                                                |
| Create  | Studio → **Mindmap**                                   | Opens the Mindmap tab on its "New mindmap" page                                                             |
| Link    | `/employer/documents?source=m<id>`                     | A way in, not an address: opens the preview tab and drops the param. `&present=1` opens it in the presenter |

How you leave the editor decides what stays open. Its **Back** button saves,
lets go of the map and brings the preview tab forward. The browser's back
button also brings the preview forward but keeps the editor open in its tab
behind, undo history and all, so a stray swipe costs nothing; closing the
preview then shows the editor again, and closing the Mindmap tab lets go.
With the Mindmap tab in front, ⌘K is the editor's palette, except while the
focus is in the tab strip (where closing or picking a tab leaves it): the strip
is the workspace's, so there ⌘K opens "Jump to anything".

`/employer/mindmap/[id]` survives only as a redirect for links shared before
the move. The glue on the workspace side is `_workspace/useWorkspaceData`
(lists maps as `WorkspaceSource`s of type `mindmap`), `_workspace/sourceApi`
(the one place that picks an API by id prefix) and
`_workspace/MindmapEditorHost`.

## Layout

```
_mindmap/
  model/     pure TypeScript — no React, no DOM, fully unit-tested
    flowchart/  the flowchart look, its arrangement, and the step language
  flow/      the flowchart editor's UI: keys, the "What goes here?" menu, Steps
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

| Module           | Responsibility                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `types.ts`       | The document shape. `DOC_SCHEMA_VERSION` lives here.                                                                   |
| `factory.ts`     | The only place a node/edge/page/doc literal is constructed.                                                            |
| `shapes.ts`      | ~60 shapes as pure `(w, h) → SVG path` functions. One registry drives the canvas, the palette thumbnails and export.   |
| `geometry.ts`    | Rects, rotation, ports, polylines, viewport transforms.                                                                |
| `routing.ts`     | Straight / elbow / curved connectors, arrowhead orientation, bend insertion.                                           |
| `layout.ts`      | Tidy-tree layouts: mindmap (both sides), tree, org, radial, grid.                                                      |
| `layered.ts`     | Layered (Sugiyama) layout for flowcharts: loops, merges, long edges, subgraph clusters.                                |
| `mermaid.ts`     | Mermaid flowchart parser and builder (shapes, labels, chains, subgraphs → frames), laid out by `layered.ts`.           |
| `generate.ts`    | AI specs → documents: an outline (mindmap, org chart, tree) or Mermaid (flowchart), themed and laid out.               |
| `agent-edits.ts` | How a model reads a page (`describeDiagram`) and changes it (`runDiagramEdits` / `applyDiagramEdits`).                 |
| `snapping.ts`    | Grid quantisation, edge/centre alignment, equal-spacing detection.                                                     |
| `resize.ts`      | Resize in the shape's own rotated frame; multi-select box scaling.                                                     |
| `text.ts`        | Measurement and wrapping — SVG has no line breaking.                                                                   |
| `grow.ts`        | Boxes that grow with their text: wider to a cap, then taller; never below their drawn size.                            |
| `avoid.ts`       | Orthogonal A\* around boxes — the detour a connector takes when its plain route crosses one.                           |
| `tidy.ts`        | Connectors as a set: nudges apart elbows sharing a channel, moves labels off each other and off their own bends.       |
| `doc.ts`         | Queries and immutable edits. Two hierarchies: containment (`parentId`) and graph (edges).                              |
| `containers.ts`  | Groups wrap their members; frames grow to hold theirs. Applied by the store on every write (see below).                |
| `flowchart/`     | The flowchart look (`look.ts`), its arrangement (`arrange.ts`) and the step language (`syntax`, `steps`, `reconcile`). |
| `commands.ts`    | Every user-facing operation. Toolbar, menu, shortcut and palette all route through here, so they cannot drift.         |
| `store.ts`       | External store + snapshot-based undo/redo with gesture coalescing.                                                     |
| `serialize.ts`   | The trust boundary. `parseDoc` never throws. Markdown/Mermaid/CSV import and export (Mermaid via `mermaid.ts`).        |
| `templates.ts`   | Starter documents, built from the same factories.                                                                      |

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

Topics are the one exception, because in an outline the edges _are_ ownership:
when the selection is nothing but topics, Delete takes each with its branch
(`branchOf` — everything that would be left without a parent, so a topic
another branch merely cross-links to survives) and ⌥Delete lifts the children
up a level instead (`deleteTopicsOrSelection`). Any selection with a
non-topic in it falls back to the plain delete above.

Child order is edge order: the layouts read a node's children off
`page.edges`, so inserting, outdenting and reordering topics are edits to
where an edge sits in that list (`insertEdgesBeside`), not to coordinates. A
topic's parent is its first incoming edge from another topic (`topicParent`),
and the reorder only ever moves an edge earlier so that stays true.

### Groups and frames

Both are containment, and both hold what they hold (`model/containers.ts`,
applied by the store at its write boundary, so no command can leave one out
of step):

- A **group** (⌘G) is exactly the bounds of its members. A click on a
  grouped box selects the group — so a drag moves all of it, arrows and
  bends included — and a marquee over a member selects the group too
  (Figma's and PowerPoint's rule). A double-click goes inside and selects the
  box; from there a click picks another member, and a double-click opens a
  label. The group follows a member that moves, grows or goes; an empty group
  goes too.
- A **frame** grows to hold a child that lands past its edge — added by
  Tab, the menu or the Steps panel, dropped, drawn, or dragged — and never
  shrinks on its own. Only at a commit: while a box is dragged the frame
  stays put, so a box leaves a frame when its centre does
  (`reparentIntoContainers`). A drag on a frame's empty inside is a marquee
  over what it holds (a marquee catches a frame only whole); the frame moves
  by its title or its edge, or once it is selected. A double-click inside
  adds a box there, in the frame; a double-click on the title renames it.
  Tab never clones a frame or a group: on an empty frame it adds the first
  step inside, otherwise it does nothing.

## Keyboard

`ui/useKeyboard.ts` is the whole map, and its `SHORTCUTS` table is the
shortcuts dialog. With a topic selected the keys are an outliner's, after
XMind, MindNode and MindMeister:

| Key              | While typing a label             | With a topic selected                                          |
| ---------------- | -------------------------------- | -------------------------------------------------------------- |
| Enter            | Finish the label — only that     | Add a sibling right after it (a child, on the centre)          |
| ⇧Enter           | New line                         | Add a sibling right before it                                  |
| ⌥Enter           | New line                         | —                                                              |
| Tab / ⇧Tab       | Finish, then add child / outdent | Add child / outdent                                            |
| Esc              | Finish the label                 | Clear the selection                                            |
| Arrows           | —                                | Go to the nearest visible topic that way (⌥ nudges)            |
| ⌘↑ / ⌘↓          | —                                | Move among its siblings                                        |
| ⌘/               | —                                | Collapse / expand                                              |
| Delete / ⌥Delete | —                                | Delete with its branch / keep its children (not on the centre) |
| Any character    | —                                | Start typing; the character replaces the label                 |

Enter finishing and nothing else is the point of the table: one Enter used to
commit _and_ create, which put boxes on the canvas nobody asked for. Now the
label field swallows its Enter — propagation stopped, and default-prevented,
which the window handler also checks — the topic stays selected, and the
second Enter is the window's. Other shapes keep a canvas's keys: Enter opens
their text, letters stay tools (R then a click places a rectangle — typing over
a selected box would rename it "r"), arrows nudge, Delete removes only the
selection. ⌥Delete on a centre that holds branches does nothing: its children
have no parent to be handed to, and keeping them would split one map into one
centre per branch.

Type-to-edit does not prevent the keystroke. The field mounts and focuses
during the keydown and the browser delivers the character into it; the
character is also written in as a selected `seed`, so a delivery replaces it
rather than doubling it, and a missing one (jsdom) still leaves it there. If
focus ever slips out of an open field, the next character pulls it back in
(`focusEditorField`) and Enter or Esc still finish the label.

Every structural edit — add, outdent, reorder, delete — runs its auto-arrange
pass inside `store.group`, so one ⌘Z takes back the edit and the layout
together.

The table is a mindmap's. A flowchart has its own keys (next section).

## Flowcharts

Most people who open a blank canvas here draw boxes and arrows, not an
outline, so **a blank canvas works as a flowchart** (`kindForTemplate`) and
the outliner behaviour belongs to the Mindmap template. How a document works
is `DocSettings.kind`, asked through `worksAsFlow` (flowchart and board) and
`stepsFrom` (per box, for a freeform drawing), and switched in the top bar's
Layout menu — **Works as: Flowchart / Mindmap** (`setDiagramKind`) — so a map
someone built as a flowchart out of topics is fixed without redrawing it.

A document worked as a flowchart is drawn three ways at once — by keys, by
picking shapes, and by writing steps — chosen from four prototypes tried side
by side (the keyboard flow, drop-and-pick, and write-it-see-it; the fourth,

- arrows on every side of a box, was dropped). Mindmaps and freeform drawings are untouched by all of
  it: every hook below is skipped unless `worksAsFlow`.

### The look

Every new box and arrow on a flowchart, by every path (the first box, Tab,
⇧Tab, the menu, a double-click, the rail's tools, the shape library, the
Steps panel, agents), wears `flowchartLook` (`model/flowchart/look.ts`,
reached through `flowLookOf(doc)`, `dressBox`, `edgeOptions`): coloured by
kind — a step blue, a decision amber, Start/End green, data violet, a note
sticky yellow — no outline, a soft shadow, 15px regular type; right-angled
arrows in the board's soft ink, 12px labels. A label ending in "?" makes a
plain step a decision when it is finished, "Start" or "End" a pill
(`afterText`, in `commitNodeText`'s undo step); words never take a kind
away, so a Decision picked from the menu and labelled "Approve", or a
Start/End labelled "Order placed", keeps its kind until someone changes the
shape. The Steps panel writes such a decision as "Approve?" (and leaves the
box's own words alone), and keeps a pill a pill whatever its line says,
except one its own typing just made. Boxes keep their width and grow down.
Boxes already on a document are never repainted.

### Keys (`flow/keys`)

| Key                | While typing a label        | One step selected                  | Several selected | Empty board     |
| ------------------ | --------------------------- | ---------------------------------- | ---------------- | --------------- |
| Any character      | —                           | —                                  | —                | Start the chart |
| Tab                | Finish, add the next step   | Add the next step after it         | —                | —               |
| ⇧Tab               | Finish, add a branch beside | Add a branch beside it             | —                | —               |
| Enter              | Finish                      | Open its label                     | —                | Start it empty  |
| Esc                | Finish; an empty step goes  | Clear the selection                | Clear it         | —               |
| ↑ ↓ ← →            | —                           | Walk the chart                     | Nudge 1px        | —               |
| ⌥ / ⇧ + arrows     | —                           | Nudge 1px / 10px                   | Nudge 1px / 10px | —               |
| Delete / Backspace | —                           | Remove it, join the line around it | Delete them      | —               |

Tab puts the new step _after_ its box, as a new line in the Steps panel
would: the arrows that left the box now leave the new step. Out of a
decision it is another branch, and its arrow says **Yes**, then **No**, in
the reader's language — from every path that adds a step (`addNextStep`:
Tab, the selection toolbar's +, the menu's "Add next step"). The key legend
sits in the stage's bottom-left corner, opaque, foldable to a button (the
choice remembered per browser), gone on an empty board.

### "What goes here?" (`flow/pick`)

An arrow dragged out of a box and let go over empty space opens a menu
there — Step, Decision, Start/End, Data, Note, Just the arrow — with a
dashed preview of the pick on the board; a double-click on empty canvas opens
it too, without "Just the arrow". 1–6 pick straight away, arrows and Enter
pick the highlighted one, Esc or a click elsewhere closes it and leaves
nothing. A pick is one undo step; out of a decision its arrow says Yes, then
No; picked inside a frame, the box joins it.

### Steps (`flow/steps`)

The chart as lines, in a panel docked left of the canvas: one step per line,
joined in order; a line ending in "?" is a decision; indented `Label: step`
lines are its branches; `-> Step` jumps; Start and End are pills; a blank
line starts a separate chain — the line after it is not joined to the line
before it (the grammar is `model/flowchart/syntax.ts`, shared with agents).
A top-bar **Steps** button toggles it; it is open unless the person closed
it (`lib/preferences.ts`, per browser) and never shown while presenting.

Typing is drawn within ~300ms, one undo step per burst, boxes keeping their
ids; boxes already on the page keep their places (a box on its own stays
where it was put), and on a chart that arranges itself each chain the lines
hold is arranged. Selecting a box lights its line (every selected box's
line); the caret's line selects its box. Only typing in the panel draws the
chart. A canvas edit — a rename, Tab, Delete, a deleted arrow, a box
dropped on its own — only ever rewrites the lines, never the chart
(`StepsSync`): they are edited where they stand when that says the chart,
else written out afresh, and two steps the canvas does not join are kept
apart with a blank line. So the lines always say the canvas, and drawing
them again changes nothing.

### Arrangement (`DocSettings.flowLayout`)

| `flowLayout` | What happens                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `auto`       | After every structural change the chart is laid out top to bottom (`tidyChart`, `arrangeIfAuto`) |
| `manual`     | Nothing already placed moves; a new box goes below the box it follows, beside its other steps    |

A blank flowchart is `auto`; a template's sample and anything saved before
the setting existed is `manual`, so **opening a document never moves
anything**. Structural changes are Tab, ⇧Tab, a menu pick, a Steps edit,
Delete joining the line, and a finished label that reshapes or grows a box;
the arrangement lands in the same undo step. Moving a box by hand — a drag,
a group drag, a nudge, an align — turns the chart `manual` in that move's
undo step (`holdChartInPlace`), and a toast says so with **Arrange
automatically**; the same toggle is in the Layout menu (turning it on
arranges now). Layout › Arrange now lays it out once and leaves the setting.
`tidyChart` is a tidy tree when the chart is one, the layered layout for
merges and loops, kept where its first step is; boxes in a frame are laid
out among themselves, inside it. On a hand-placed chart the Steps panel
passes `applySteps`' `keepPlaced`, so a reworded line never moves its box.

### Selecting several

A drag on empty canvas (or on a frame's empty inside) selects every box it
touches and the arrows between them; ⇧- or ⌘-click adds and removes; ⌘A
selects everything. Dragging any selected box, a selected arrow, or empty
space inside the selection's frame moves all of it, bends included; arrow
keys nudge a selection of several. The selection toolbar's colours apply to
the selected boxes only. None of the flowchart's own gestures get in the
way: a marquee never opens the menu, and a drag that starts on a box moves
it — an arrow is drawn only from a dot.

Also on a flowchart: Delete takes the box only, never the steps after it;
there are no fold buttons (a box with arrows out is not a branch to fold);
the empty board is one opaque card with the three ways to start — start
typing (a ghost of the first step, where it will land), double-click to
pick a shape, or write the steps in the panel — and the keys that grow it.
On a freeform drawing Tab steps from any box that is not a topic, and topics
keep the outliner's keys.

## Boxes that grow with their text

Typing into a box makes it as big as its words need (`model/grow.ts`): it
widens until its text area reaches `GROW_MAX_TEXT_WIDTH`, then the label
wraps and the box grows taller. It never drops below the size it had when
typing began, so deleting words gives back the box that was drawn. Growth is
anchored by the text alignment — centred text grows on both sides, so a box
keeps its place on a flowchart's line; left/top-aligned text grows right and
down — and a rotated box grows about its centre. A sticky note keeps its
width and grows down (FigJam); frames and lanes are sized by their contents,
not their titles.

The text field previews it live (`previewTextGrowth`, transient) and
`commitNodeText` lands words and size as **one** undo step: it rolls the
previews back first, so the entry starts from the box as it was. Opening a
label and closing it unchanged is not an edit and does not resize anything.

## Connectors

**Drawing one.** Drag out of a shape's dot (dots show on hover):

| Released on…                               | Result                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| another shape's body, or within 24px of it | joined by the sides that face each other; while you approach, that shape alone gets an outline and its dots |
| another shape's dot                        | the end pinned to that dot (the start never is)                                                             |
| empty space, from a topic                  | the next topic (the mindmap gesture)                                                                        |
| empty space, on a flowchart                | the "What goes here?" menu (see Flowcharts)                                                                 |
| empty space, from any other shape          | the arrow with a free end, to re-drag onto the right shape                                                  |
| a few pixels away, or a plain click        | nothing — the click selects the box                                                                         |

The new connector ends up selected, so Delete takes it straight back, and
Escape during any drag abandons it. A plain click on a dot no longer mints a
connected twin (Lucid's click-a-port): the dots reach a few pixels into the
shape, so clicking near a box's edge to select it made boxes nobody asked
for. A press more than 4px inside the outline is a press on the box
(`PORT_INNER_GRACE`), and Tab or the toolbar's + add the next step instead.
The dot a drag started from is only a handle — left pinned, a drag from a
right-hand dot to a box on the left ran back through its own box, and a drop
on the near dot of a box behind it made a U-turn. Re-dragging a selected
connector's end moves the connector itself, live, rather than drawing a
second dashed line from the old end. On a selected shape the side dots sit
16px outside its edges and the corner and top dots are hidden, so they no
longer cover the resize handles or the rotate handle (a corner drag used to
draw a connector). A drag released back on its own box, or within the snap
zone around it, makes nothing.

**Where lines attach.** Two lined-up boxes (one above the other with their
widths overlapping, or side by side) get a straight line on their shared
span (`alignedEnds`) instead of a few-pixel zig-zag between their centres —
or, against a diamond or circle, at its tip when the tip falls on the other
box. Connectors that share a side are spread along it (`sideSlotInfo`),
ordered by the direction each one leaves in (its angle from the side's
normal), so a fan of lines to the same side never crosses itself. Two arrows
between the same boxes, or a loop arriving where the next arrow leaves, used
to be drawn on top of each other. A straight connector takes the slot of
the busier of its two sides at both ends, so it stays straight without
landing on a neighbour; a neighbour that detours round a box is not counted
on the side it would have used; a detour arriving on a side already in use
lands beside the lines there, on the end nearer where it comes from. Spreading and straightening only happen on
sides that are straight along the whole box (`FLAT` — rectangles, topics,
stickies, a cylinder's sides, a terminator's top and bottom…); a diamond's
or a circle's ends stay on its own ports.

**Which sides.** An elbow with no bends picks its sides from where its two
boxes are (`chooseEnds` in `routing.ts`): every pair of sides is drawn and
priced — length, a price per corner, steep prices for a leg under `MIN_LEG`
(20) or a last leg too short for the arrowhead and its corner, and for any
run back behind a side it leaves or enters (a U-turn) — and the cheapest
wins. So lined-up boxes are joined straight, a box mostly beside goes side
to side, one mostly below end to end, and a diagonal takes one clean bend
(an L) when both legs are comfortably long, else a Z whose middle run sits
halfway (moved only to give the arrowhead its room). On a document worked as
a flowchart (`routeOptionsFor` — every surface passes it) a step clearly
below is joined bottom to top; a decision's branches keep its side tips. A
tip already used by another line (lines cannot spread along a vertex) costs
as much as leaving a pin. Before this, sides were read by angle between
centres, and a box below and to the right got a Z with two 30px stubs and a
squeezed head. While a box is dragged the sides it had are kept until
another pair is clearly better, and after they change they hold until the
box has moved 8px on (`SIDE_HYSTERESIS`, `SIDE_SETTLE`), so a line does not
flicker near a diagonal. An end pinned to a dot keeps it while that side
still faces the other box; once the pin would force a U-turn the end is
routed automatically. Bends someone placed that no longer make a clean path
— one now on or in a box, or a line through them crossing its own box — are
ignored (`hasStaleBends`) and taken out when the box drag ends
(`dropStaleBends`); bends on a group moved together travel with it.

Toward a bend someone placed, a side is chosen by direction, except a bend
that sits straight beside the box — within its width (above or below) or its
height (left or right) — takes that side (`autoPort`'s `proportional`): a
bend just below a wide box's corner is below it, and read by angle as
"right" the line doubled back through its own box. A bend off a corner
diagonally is read by angle, so a small bend does not flip which side a line
uses. Straight and curved connectors still aim by angle.

**Going around boxes.** A connector nobody has routed by hand goes around the
shapes between its ends instead of under or over them (`avoidingRoute` in
`routing.ts`, the search in `avoid.ts`). Only when its plain route actually
crosses a box: a clear line is drawn exactly as before. The detour is an A\*
over a sparse grid of padded box edges, channel centres and the connector's
possible stubs — the orthogonal-visibility approach of libavoid and draw.io —
costed by length plus a price per bend, a little extra for leaving through a
side other than the one facing the other end, and more for a side another
connector already uses, which is what sends a loop back to an earlier step
round the outside of a row instead of along the forward arrows. Elbow
connectors keep the orthogonal route; straight and curved ones are pulled
tight around the same detour. Containers, free text and ink are not in the
way. Routes stay a pure function of their inputs — the edge, its two nodes,
the obstacles in its search window and its neighbours' sides — which is what
`routeEdgeCached` keys on, so dragging one box re-routes only the lines near
it. Every surface that draws a route (canvas, thumbnails, the label field)
passes the page's nodes and edges, so they agree.

**As a set** (`model/tidy.ts`). Routes are found one connector at a time, so
two elbows between the same columns took the same channel and two labels at
the middle of their lines printed over each other. After routing, the
canvas pulls middle segments that run within `NUDGE_GAP` (16px) of each
other apart (libavoid's nudging; stubs at the boxes never move), ordering
them so lines entering a channel from the same side nest their corners
instead of crossing. A label that would cover another label or sit on a bend in
its own line (where the bend's handle covers it while the line is selected)
— or, where there is room, another connector's line — slides along its own
line to the nearest free spot; this is where it is drawn, not where it is
stored. A
curved connector's detour gets wide rounded corners, not a spline through
its corners (which overshot into the boxes it went round);
`RoutedEdge.cornerRadius` carries that to the stroke shortened for
arrowheads, so the line, its halo and its hit path coincide. Labels are
drawn in a layer of their own above every connector (`EdgeLabels`) — inside
their own connector's group, a connector drawn later painted straight
through them. The label being typed has a paper-coloured backing, so its
line does not strike through it.

**Labels.** Double-click a line to label it (double-click a label to edit
that one); drag a label to slide it along its line, which is one undo step.
The drawn stroke ignores the pointer — the wide transparent hit path under it
is the one target, so the cursor and the click agree all along the line.

**Bends.** Dragging the body of a selected connector makes a bend and drags
it; the bend is only made once the pointer moves, so clicking a selected
line — or double-clicking it to label it — adds nothing (it used to, on
pointerdown, which is how bends appeared "without knowing"). A bend comes out
again by double-clicking its handle, or by dragging it back into line with
its neighbours — or anywhere the line would run anyway (`isRedundantBend`) —
and "Reset route" clears them all. An elbow route turns a corner at a bend
rather than retracing back over itself; the retrace used to be folded away by
`simplify`, leaving a handle off the line that moved nothing.

**Pointer housekeeping.** The canvas size never lags the layout
(`useElementSize`): it is re-measured after every render in a layout effect,
and a ResizeObserver update is committed synchronously. Selecting a shape
opens the inspector in the same commit, which narrows the canvas; with the
size updated a frame late, one frame drew the whole board scaled and
shifted, and a fast second click (the second half of a double-click on a
line) landed on whatever had moved under it — often another shape's text
editor. Every press re-measures the canvas, and a release always lets go of
pointer capture: a press that started nothing used to keep
the canvas capturing, so the second press of a quick double-click on a line
reported the canvas as its target and the double-click made a box instead of
a label. Fit-to-screen stops following the stage at the first selection,
edit or drag (`useAutoFit`): selecting opened the inspector, the stage
narrowed, the board was refitted, and the next click landed where the line
used to be.

**Moving a selection.** Pressing any part of a multi-selection — a box, a
selected connector, or empty space inside its frame (Figma's rule) — drags
all of it. Connectors whose ends all sit on moving boxes, and selected
connectors, carry their bends and free ends along (`edgesMovingWith`); a lasso
also selects the connectors running between the boxes it catches.

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
spot-checking: every swatch's ink clears 4.5:1 on its own fill, every topic
label at every depth clears 4.5:1 on whatever is behind it — the central
topic included, whose 18px bold label is just under WCAG's large-text line
(18.66px bold) and so gets no 3:1 allowance — every outline and connector
clears 3:1 on the paper (WCAG 1.4.11), and every label in a repainted document
is readable in all ten themes. Two colours were moved to satisfy it (green's
and amber's light strokes), and `readableInkOn()` picks the central topic's
label colour by measurement instead of by mode — near-white loses on a bright
violet root and wins on a mid violet one, and no fixed choice gets both.

The same contract governs the app's own ink ladder in `tokens.css`: `--ink-3`
is the smallest tier used for prose and must clear 4.5:1 on every surface in
its block; `--ink-4` is de-emphasised UI and must clear 3:1.

### Why the default themes look the way they do

Every choice below is a convention with a reason, not a taste call, and the
reason is what to argue with if one should change.

**Colour means "belongs together", so it is assigned by branch.** Each main
branch takes one hue from the theme's `cycle`, and every topic under it — and
every connector into one — wears that hue. This is the mind-map convention
(XMind's "Colored Branch", MindNode's themes taking branch colours from the
first level, Miro filling nodes "with the same color as the branch", Buzan's
"a colour per branch") and it rests on Gestalt similarity: a reader sees a
limb as one thing before reading a word of it. Colouring by _depth_ instead,
as this editor did until October 2026, made every main branch the same blue
and every detail the same teal — the colour carried no information the layout
did not already show.

**Depth is shown by weight, so it reads without colour** (WCAG 1.4.1, and
XMind's "colour intensity … from Center Topic to Main Topic, gradually
decreasing"). `topicPaint` in `model/theme.ts` is the whole ladder:

| Depth                  | Surface                        | Outline            | Label                                 | Line in         |
| ---------------------- | ------------------------------ | ------------------ | ------------------------------------- | --------------- |
| Central topic          | solid, in the theme's root hue | none               | measured (`readableInkOn`), 18px bold | —               |
| Main branch            | tint of the branch hue         | 2px, branch hue    | branch ink, 15px bold                 | 3px, branch hue |
| Subtopic               | the paper itself               | 1.5px, branch hue  | theme ink, 13.5px                     | 2px             |
| Leaf (underline shape) | none                           | rule in branch hue | theme ink                             | 1.5px           |

A box's label and its colours come from the same rung (`drawnLevel`). A topic
with nothing above it — double-clicked onto the canvas, placed with the Topic
tool, dropped from the palette — is drawn as a main branch, so it is lettered
as one too: 15px bold, the same as the branch Tab makes. It used to keep the
factory's 14px regular inside the same tinted box, which read as some new
boxes bold and some not.

Connectors thin from the centre outward, Buzan's "thicker… becoming thinner as
they radiate out". Details sit on the paper with neutral ink so they recede:
the strongest coloured mark is the main branch, and the strongest mark of all
is the centre.

**The centre's hue is reserved.** A theme's `root` never appears in its
`cycle`, so the anchor cannot be mistaken for a branch. (Before, a topic added
under a violet root came out violet.)

**Neighbouring branches are far apart.** Cycles alternate warm and cool. Every
coloured theme has at least four hues — a typical map shows four branches at
once — and a test holds every pair among the first four, and every adjacent
pair, at ≥ 0.1 OKLab ΔE: several just-noticeable differences, in lightness as
well as hue, which is what keeps branches apart for readers with a
colour-vision deficiency. Monochrome is the exception by design (one grey;
weight alone carries depth). Ocean was recast (blue centre; cyan, orange,
indigo, green branches) because its old teal and cyan failed this; Sunset
traded amber and magenta — too close to orange and to pink — for violet and a
teal; Forest gained a blue so a fourth branch no longer repeats the first.

**Light and dark are one identity under two lightings** (as before): each light
theme has a dark counterpart with the same root and cycle, read through the
dark swatch table, and new documents are seeded in the creator's app theme.

| Theme                  | Centre             | Branch hues                                                 |
| ---------------------- | ------------------ | ----------------------------------------------------------- |
| Launchstack / Midnight | violet (the brand) | blue, amber, teal, pink, green, orange                      |
| Monochrome / Carbon    | graphite           | slate — hierarchy by weight alone, for print and formal use |
| Ocean / Abyss          | blue               | cyan, orange, indigo, green                                 |
| Sunset / Ember         | red                | orange, pink, violet, teal                                  |
| Forest / Pine          | green              | teal, amber, blue, lime                                     |

Measured (WCAG contrast; minima over each theme's branch hues):

| Theme       | Centre label | Centre vs paper | Branch label | Outline / line vs paper | Detail label |
| ----------- | ------------ | --------------- | ------------ | ----------------------- | ------------ |
| Launchstack | 5.5          | 5.5             | 8.1          | 3.5                     | 16.9         |
| Monochrome  | 7.3          | 7.5             | 13.4         | 3.7                     | 17.3         |
| Ocean       | 4.6          | 4.5             | 8.5          | 3.5                     | 14.9         |
| Sunset      | 5.3          | 5.3             | 8.5          | 3.5                     | 14.4         |
| Forest      | 5.0          | 5.0             | 8.1          | 3.4                     | 14.9         |
| Midnight    | 6.4          | 6.8             | 9.9          | 6.9                     | 16.0         |
| Carbon      | 6.5          | 7.1             | 11.1         | 5.2                     | 16.5         |
| Abyss       | 7.1          | 7.5             | 10.0         | 6.6                     | 15.5         |
| Ember       | 5.5          | 5.9             | 9.9          | 6.8                     | 15.5         |
| Pine        | 7.7          | 8.2             | 9.9          | 7.6                     | 15.7         |

**Every path paints through the same function.** A topic's look depends on
the theme _and_ its place in the tree, which no factory can know, so Tab,
Enter, the Topic tool, a port drag, a palette drop, an outline import and the
Theme picker all end in `paintTopics` / `applyThemeToPage`. Adding to a map
follows the branch as it is (recolour a branch red and its new details are
red); switching theme replaces every colour by branch position. The colour
dots recolour a whole branch, in the tone for the board's lighting.

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

Every `id` the canvas defines for a `url(#…)` (the shadow filter, the grid
pattern, image clip paths) is prefixed with that canvas's `useCanvasIdScope()`.
Studio keeps hidden panes mounted, so a map's preview and its editor are often
in the page together, and a `url(#…)` resolves to the first element with that
id in the whole page: a fixed id pointed the editor's central topic at a filter
inside the hidden preview, and it was not painted. Because the defs live inside
the `<svg>` that export clones, the scoped ids still resolve in the file.
`__tests__/canvas-ids.test.tsx` holds any new `<defs>` to the same rule.

## AI: diagrams as a tool

The editor is also something an AI can draw in. Four ways in, one engine:

| Where                    | What                                                                                             | Code                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Ask (the chat)           | `find_diagrams`, `read_diagram`, `create_diagram`, `edit_diagram` — model-called tools           | `~/server/chat-diagram-tools.ts`                              |
| Assistants over MCP      | `list_diagrams`, `read_diagram`, `create_diagram`, `edit_diagram` for Claude, ChatGPT and others | `~/server/mcp/tools/diagrams.ts`                              |
| Gallery → "Describe it…" | The workspace's model drafts a whole map from a description (`POST /api/mindmaps/generate`)      | `_workspace/GenerateDiagramForm`, `~/server/mindmap/generate` |
| Topic → "Expand with AI" | Subtopics for one topic (`POST /api/mindmaps/expand`), added by the editor's own commands        | `ui/useAiExpand.ts`                                           |

**Models write text, never coordinates.** A model is asked for what models
write well: an indented outline for anything tree-shaped, and for flowcharts
the **step language** — the text the Steps panel shows beside a chart
(`model/flowchart/syntax.ts`). `generate.ts` turns either into an ordinary
document with the same factories, theme painter and layouts as a map someone
drew — so a generated map opens, edits, presents and publishes like any
other. Outlines tolerate what models actually send (bullets or not,
headings, a plain title line over its bullets, Mermaid's `mindmap` syntax).
Mermaid is still accepted for a flowchart that needs groups (subgraphs) or a
left-to-right flow, and tolerates chains, `&`, both label forms, quoted
labels and nested subgraphs; what the text _is_ decides how it is read,
whichever field it arrived in, fences and all.

**Flowcharts go in and out as steps.** One language for the person typing in
the Steps panel, the agent reading and writing, and the published text, so
an agent reads what it writes back and writes what a person would type. A
blank line starts a separate chain — the line after it is not joined to the
line before it — which is how the text says a box on its own, or two steps
whose arrow was deleted; agents are told to keep the blank lines they read
and to add none for spacing:

```
Start
Receive the order
In stock?
  Yes: Pick and pack
  No: Reorder from supplier -> Receive the order
Ship it
End
```

| Way                           | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read** (`read_diagram`)     | A page that reads as steps (`readsAsSteps`: a `kind: "flowchart"` page of flowchart symbols, or any drawing the step text says exactly) comes out as the step text in a ` ```steps ` fence, then "Boxes": each step's id as `(id: n_…)`, in line order. Then whatever the text cannot carry (`stepsGap`): arrows to notes, words on a non-branch arrow, joins the text implies that the page lacks, other shapes, frames — so nothing is hidden. A decision's branches come out in the order their arrows were made (Yes before No). Mind maps keep their outline; a graph of non-flowchart shapes (ERD, architecture) keeps the shapes-and-arrows list. |
| **Create** (`create_diagram`) | `type: "flowchart"` with `steps`: drawn by `stepsToFlowchart` in the product look (`flowchartLook`: coloured by kind, no outline, 15px regular), top to bottom, `kind: "flowchart"`, `flowLayout: "auto"`. From Mermaid: the same look, frames kept as paper, `flowLayout: "manual"`.                                                                                                                                                                                                                                                                                                                                                                    |
| **Rewrite** (`edit_diagram`)  | `steps`: the whole chart rewritten — the `{ op: "steps", text }` edit, drawn before any id `edits` in the same batch. Boxes whose words stay keep their id (and comments, links); new lines get new boxes; dropped lines' boxes go; notes, text marks and frames stay.                                                                                                                                                                                                                                                                                                                                                                                   |
| **Index** (publish)           | `toMarkdownOutline(doc, { sections: true })` — what the route uploads and the Publish dialog previews — writes such a page as its step text under a one-line legend, then its notes, groups and any arrows the text does not show. The download export is unchanged.                                                                                                                                                                                                                                                                                                                                                                                     |

Anything the parser cannot use (an arrow to words no step has, a branch
under a line that is not a question, an arrow with no step to leave from)
fails the create or the rewrite, and every problem is said back by line
(`describeStepNotes`) — a rewrite never half-applies. `diagramToolsPrompt`
and the MCP tool descriptions teach the language once with the example above
(`STEPS_LANGUAGE` in `agent-edits.ts`) and tell the model to prefer steps for
flowcharts.

**Edits are operations on ids, run through the editor's commands.**
`describeDiagram` writes the active page out with every shape's id beside its
label as `(id: n_…)` — never in square brackets, which Ask reads as a
citation. `edit_diagram` takes `add`, `rename`, `remove`, `move`, `connect`,
`disconnect` and `arrange`; a topic added this way is made by `addChildTopic`,
so it is the topic Tab would have made. On a flowchart, a box `add` makes is
in the product look with its kind from its words ("In stock?" a decision),
`connect` draws the look's arrow, `rename` makes a plain step a decision
or a pill by its words as typing does and never takes a decision's or a
pill's kind away (`flowchartLook.afterText`), and a chart on
`flowLayout: "auto"` takes added steps into its arrangement (`tidyChart`). A
batch is all or nothing (`runDiagramEdits` works on a scratch `EditorStore`).
On the server (`~/server/mindmap/agent`) the result is written only over the
revision it read, retried once on a fresh read, and the version before is
kept in the history as "Before an AI edit". In the editor
(`applyDiagramEdits`) it lands as one undo entry and autosave writes it.

**Access is the editor's.** Reading sees the drafts the person may open;
creating goes through `createMindmapDraft` (no folder is their Private
section; a folder takes edit access) and needs `documents.upload`; editing
takes edit access to the draft and `documents.edit`. Ask offers the tools
only to an agent allowed sources (reading) and writing (drawing, editing).
The editor's own AI calls run on the workspace's models, count as the
`mindmap` AI feature and stop at the person's AI allowance.

**An open editor follows saves made elsewhere.** When the presence heartbeat
sees a newer revision and nothing here is unsaved, the editor loads it in
place as one undo step ("Updated with changes saved elsewhere") instead of
asking for a reload — so a change the chat makes appears on the canvas within
seconds. With unsaved work the stale banner stays: that is a real conflict.

**Containers sit under connectors.** The canvas (and the thumbnails) draw
frames, swimlanes and groups first, then connectors, then everything else; a
filled frame drawn in page order used to cover every arrow inside it (the
Swimlane template showed none). A frame left as plain paper stays paper when
the board is relit or rethemed (`FRAME_PAPER` in `palette.ts`); a frame
someone coloured, like a SWOT quadrant, still takes the theme's colours.

## Chrome depths

The editor is a full diagramming application, and most people who open it
want four branches and a Present button. So the chrome has two depths, and
the document's kind picks which one it opens at:

| Depth          | What is on screen                                                                              | Opens for                                      |
| -------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Focus**      | The canvas, a rail of five tools, a toolbar on the selection, an 8‑item context menu, ⌘K       | `kind: "mindmap"`, `"board"` and `"flowchart"` |
| **Everything** | Both side panels, the 60‑shape library, the full inspector, snapping, arrange — today's editor | `kind: "freeform"`                             |

`DocSettings.kind` is set from the template's category by `buildTemplate`
(`kindForTemplate`). Documents saved before it existed are classified on load
by `inferKind` in `serialize.ts`: a page drawn with nothing but topics is a
mindmap, anything else — an empty page included — keeps Everything. A
flowchart opens in Focus: its keys, the menu, the Steps panel and the
toolbar on the selection are the whole of drawing one. The
person's own choice wins over both, remembered per kind in `localStorage`
(`lib/preferences.ts`), and the Simple ⇄ Everything toggle in the top bar
is how they make it. Every command and shortcut works in both depths; ⌘K
lists the same commands in both, and `__tests__/chrome-depth.test.tsx`
asserts that, plus a budget on how many controls Focus may show.

Three things follow from the depth being _chrome_ and nothing more:

- **The document renders identically in both.** Depth is `EditorState`, never
  `DocSettings`; a file does not know or care how it was last looked at.
- **Auto-arrange is document data** (`settings.autoLayout` for a mindmap,
  `settings.flowLayout` for a flowchart — see Flowcharts), on for the
  `mindmap` template. `commands.ts` re-runs it after every structural edit —
  but only on a mindmap, and only on a page that is nothing but topics
  (`isMindmapPage`), so a flowchart is never re-flowed into a tree because one
  box was deleted. A hand-placed Move or Resize pauses it, with Resume in the
  toast.
- **Presenting folds through view state.** `EditorState.folded` is a set of
  branch ids the canvas treats as collapsed; `ui/Presenter.tsx` reveals a map
  one branch at a time through it, and the file is never dirtied. The
  workspace preview opens straight into it with `&present=1`, which Share →
  "Copy presentation link" produces.

## Working on the UI

`/dev/mindmap` mounts the editor inside the real chrome chain — employer layout
→ `DriftShell` → `ToolsStudioShell` → editor — with a template document and
`/api/mindmaps/*` answered locally, so the canvas can be driven without a real
session or a row in the database. `?template=flowchart` picks a starter (ids in
`model/template-meta.ts`; `?template=blank` is a blank flowchart, as the
product makes one, and `&board=dark` a dark board); `?view=preview` mounts the read-only preview the
workspace viewer uses instead, which shares the canvas and therefore its
layout bugs. The route 404s in production.

Because it reproduces the chain rather than approximating it, layout that works
there works in the app: the shell is what has to hand the editor a _definite_
height, and getting that wrong is not visible from the editor alone.

## Tests

```bash
pnpm --filter @launchstack/web exec jest src/app/employer/documents/_mindmap
```

Model tests are pure. UI tests mount the real components against the real store;
jsdom does no hit-testing, so pointer gestures must be dispatched on the element
being grabbed (see `canvas.render.test.tsx`) — dispatching on the `<svg>` always
reports the `<svg>` as the target regardless of coordinates.
