/**
 * Every editing operation the UI can invoke, expressed against the store.
 *
 * Toolbar buttons, the context menu, the keyboard map and the command palette
 * all call into this module — there is exactly one implementation of "group",
 * "align left" or "bring to front", so a shortcut and a menu item can never
 * drift apart. Each function is one undo entry unless it says otherwise.
 */

import {
    buildPayload,
    instantiate,
    readClipboard,
    writeClipboard,
    type ClipboardPayload,
} from "./clipboard";
import {
    activePage,
    addEdges,
    addNodes,
    branchOf,
    childrenOf,
    collapsedHidden,
    edgesForNodes,
    graphDescendants,
    graphIndex,
    insertEdgesBeside,
    isCentreWithBranches,
    isTopicShape,
    mapEdges,
    mapNodes,
    nodeById,
    pageBounds,
    removeEdges,
    removeNodes,
    reorderNodes,
    selectionBounds,
    topicInDirection,
    topicParent,
    updatePage,
    withDescendants,
    isMindmapPage,
    stepsFrom,
    worksAsFlow,
    type NavDirection,
} from "./doc";
import { dropStaleBends } from "./routing";
import {
    createEdge,
    createNode,
    createNodeAt,
    createPage,
    defaultTextStyle,
    makeId,
} from "./factory";
import {
    clamp,
    fitViewport,
    nextZoomStep,
    nodeBounds,
    nodeCenter,
    nodesBounds,
    rectCenter,
    unionRects,
    worldToScreen,
    zoomAt,
    type ViewportLike,
} from "./geometry";
import { computeLayout, suggestChildPosition, type LayoutKind, type LayoutOptions } from "./layout";
import {
    neutralsFor,
    swatchFor,
    SWATCH_BY_ID,
    THEME_BY_ID,
    themeMode,
    type ThemeMode,
} from "./palette";
import { isContainer, shapeDef, shapeTextBox } from "./shapes";
import { containerAt } from "./containers";
import { applyThemeToDoc, paintTopics, recolourTopics, topicType } from "./theme";
import type { CommitOptions, EditorStore } from "./store";
import { restyleMovedTopics } from "./topicStyle";
import { sizeForText } from "./grow";
import { layoutText } from "./text";
import {
    branchLabel,
    edgeBetween,
    placeAfter,
    tidyAll,
    tidyChart,
    type BranchWords,
    type FlowStep,
} from "./flowchart/arrange";
import { dressBox, edgeOptions, flowLookOf } from "./flowchart/look";
import type {
    ArrowId,
    DiagramEdge,
    DiagramNode,
    DiagramPage,
    EdgeKind,
    HAlign,
    MindmapDoc,
    NodeStyle,
    Point,
    Rect,
    SelectionRef,
    ShapeId,
    TextStyle,
    VAlign,
    AutoLayoutSetting,
    DiagramKind,
    FlowLayout,
} from "./types";

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

/**
 * The paper the document is currently painted on. Every creation path asks
 * this before minting a node — otherwise dropping a box on a dark board hands
 * you a white one, which was the single most jarring thing about the dark
 * themes before they existed.
 */
export function docMode(store: EditorStore): ThemeMode {
    return themeMode(store.getState().doc.settings.paletteId);
}

/**
 * Add nodes, painting any topic among them for the document's theme. A
 * topic's colour depends on the theme *and* on where it sits in the tree,
 * which no factory can know — so every path that adds one ends here or in
 * `paintTopics` directly, and a central topic dropped on an Ocean board is
 * Ocean's centre rather than a fixed violet. Type is set in the same step, so
 * a topic placed with the Topic tool is lettered like the main branch it is
 * painted as, exactly as one double-clicked or dragged out of a port is.
 */
function addPainted(page: DiagramPage, nodes: DiagramNode[], paletteId: string): DiagramPage {
    const next = addNodes(page, nodes);
    const topics = nodes.filter(nd => nd.shape.startsWith("mind-")).map(nd => nd.id);
    return topics.length
        ? paintTopics(next, topics, paletteId, { fresh: true, retype: true })
        : next;
}

export function insertShape(
    store: EditorStore,
    shape: ShapeId,
    at: Point,
    opts: { text?: string; w?: number; h?: number; parentId?: string | null } = {}
): string {
    // A box placed inside a frame joins it (the frame then holds it as it
    // grows); a frame placed inside one is not nested by accident.
    const parentId =
        opts.parentId !== undefined
            ? opts.parentId
            : isContainer(shape)
              ? null
              : (containerAt(activePage(store.getState().doc), at)?.id ?? null);
    const made = createNodeAt(shape, at, { ...opts, parentId, mode: docMode(store) });
    // On a flowchart every new box wears the flowchart look, whatever made it.
    const look = flowLookOf(store.getState().doc);
    const node = look
        ? dressBox(look, made, docMode(store), {
              keepSize: opts.w !== undefined || opts.h !== undefined,
          })
        : made;
    const paletteId = store.getState().doc.settings.paletteId;
    // Dressed by the flowchart look, a topic is not repainted as a branch:
    // that would put back the bold type and outline the look just took off.
    store.updatePage(
        page => (look ? addNodes(page, [node]) : addPainted(page, [node], paletteId)),
        { label: `Add ${shapeDef(shape).name}` }
    );
    store.selectNodes([node.id]);
    return node.id;
}

export function insertNode(store: EditorStore, node: DiagramNode, label = "Add shape"): string {
    const paletteId = store.getState().doc.settings.paletteId;
    store.updatePage(page => addPainted(page, [node], paletteId), { label });
    store.selectNodes([node.id]);
    return node.id;
}

export function insertEdge(store: EditorStore, edge: DiagramEdge, label = "Connect"): string {
    store.updatePage(page => addEdges(page, [edge]), { label });
    store.setSelection([{ kind: "edge", id: edge.id }]);
    return edge.id;
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

export function deleteSelection(store: EditorStore): void {
    const nodeIds = store.selectedNodeIds();
    const edgeIds = store.selectedEdgeIds();
    if (nodeIds.length === 0 && edgeIds.length === 0) return;
    store.updatePage(
        page => {
            let next = page;
            if (edgeIds.length) next = removeEdges(next, edgeIds);
            if (nodeIds.length) next = removeNodes(next, nodeIds);
            return next;
        },
        { label: "Delete" }
    );
    store.clearSelection();
    autoArrangeIfOn(store);
}

/**
 * Delete a node and stitch its children onto its own parent, so a mindmap
 * branch closes up instead of leaving its subtree floating.
 *
 * The plain Delete key deliberately does *not* do this: a connector expresses a
 * relationship, not ownership, and removing one box in a flowchart must never
 * remove or re-wire the boxes downstream of it.
 */
export function deleteNodeReconnecting(store: EditorStore, nodeId: string): void {
    let moved: string[] = [];
    store.group("Delete and reconnect", () => {
        store.updatePage(
            page => {
                const result = removeReconnecting(page, nodeId);
                moved = result.moved;
                return result.page;
            },
            { label: "Delete and reconnect" }
        );
        restyleMovedTopics(store, topicsAmong(store, moved));
        autoArrangeIfOn(store);
    });
    store.clearSelection();
}

/**
 * `page` without `nodeId`, its children bridged to its own parent in the slot
 * it occupied — so the outline closes up in order instead of moving them to
 * the end of the parent's list. Returns the children that moved up a level.
 */
function removeReconnecting(
    page: DiagramPage,
    nodeId: string
): { page: DiagramPage; moved: string[] } {
    const idx = graphIndex(page);
    // The centre's branches have no parent to be handed to; keeping them
    // would split the map into one centre per branch. Leave it standing —
    // plain Delete is how a whole map goes.
    if (isCentreWithBranches(page, nodeId, idx)) return { page, moved: [] };
    const parent = (idx.in.get(nodeId) ?? [])[0];
    const removed = new Set(withDescendants(page, [nodeId]));
    const children = (idx.out.get(nodeId) ?? []).filter(id => !removed.has(id));
    if (!parent || removed.has(parent) || children.length === 0) {
        return { page: removeNodes(page, [nodeId]), moved: [] };
    }
    const bridges = children.map(childId =>
        createEdge({
            from: { nodeId: parent, port: "auto" },
            to: { nodeId: childId, port: "auto" },
            kind: page.edges[0]?.kind ?? "elbow",
        })
    );
    const slot = page.edges.find(e => e.from.nodeId === parent && e.to.nodeId === nodeId);
    return {
        page: removeNodes(insertEdgesBeside(page, bridges, slot?.id, "after"), [nodeId]),
        moved: children,
    };
}

/** Delete a node together with everything downstream of it. */
export function deleteBranch(store: EditorStore, nodeId: string): void {
    store.group("Delete branch", () => {
        store.updatePage(page => removeNodes(page, [nodeId, ...graphDescendants(page, nodeId)]), {
            label: "Delete branch",
        });
        autoArrangeIfOn(store);
    });
    store.clearSelection();
}

/**
 * What the Delete key does.
 *
 * A selection of nothing but topics goes with everything hanging off it: in an
 * outline, deleting a heading deletes its section, and a subtree left floating
 * without its parent is never what was meant. `keepChildren` (⌥⌫) lifts the
 * children up a level instead. Afterwards the nearest surviving parent is
 * selected, so the keyboard flow carries on from where the topic was.
 *
 * Anything else — a flowchart box, a sticky, a mixed selection — is
 * `deleteSelection`, unchanged: there a connector is a relationship, not
 * ownership, and removing one box must not take the boxes downstream with it.
 */
export function deleteTopicsOrSelection(
    store: EditorStore,
    opts: { keepChildren?: boolean } = {}
): void {
    const { doc } = store.getState();
    const page = activePage(doc);
    // On a flowchart a box is a box, topic-shaped or not: deleting one must
    // never take the steps after it too.
    const all = worksAsFlow(doc.settings.kind) ? null : selectedTopicIds(store);
    if (!all) {
        deleteSelection(store);
        return;
    }
    // ⌥⌫ skips a centre that holds branches (see `removeReconnecting`); with
    // nothing else selected it does nothing, and the selection stays put.
    const ids = opts.keepChildren ? all.filter(id => !isCentreWithBranches(page, id)) : all;
    if (ids.length === 0) return;

    const doomed = opts.keepChildren ? new Set(ids) : branchOf(page, ids);
    let next = topicParent(page, ids[0]!);
    const seen = new Set<string>();
    while (next && doomed.has(next) && !seen.has(next)) {
        seen.add(next);
        next = topicParent(page, next);
    }

    store.group(opts.keepChildren ? "Delete and reconnect" : "Delete", () => {
        if (opts.keepChildren) {
            const moved = new Set<string>();
            store.updatePage(
                p => {
                    let out = p;
                    for (const id of ids) {
                        const result = removeReconnecting(out, id);
                        out = result.page;
                        for (const m of result.moved) moved.add(m);
                    }
                    return out;
                },
                { label: "Delete and reconnect" }
            );
            const survivors = [...moved].filter(id => !doomed.has(id));
            restyleMovedTopics(store, topicsAmong(store, survivors));
        } else {
            store.updatePage(p => removeNodes(p, [...doomed]), { label: "Delete" });
        }
        autoArrangeIfOn(store);
    });

    if (next && nodeById(activePage(store.getState().doc), next)) store.selectNodes([next]);
    else store.clearSelection();
}

/** The selection's ids when it is one or more topics and nothing else, else null. */
function selectedTopicIds(store: EditorStore): string[] | null {
    const { selection, doc } = store.getState();
    if (selection.length === 0) return null;
    const page = activePage(doc);
    const ids: string[] = [];
    for (const ref of selection) {
        if (ref.kind !== "node") return null;
        const nd = nodeById(page, ref.id);
        if (!nd || !isTopicShape(nd.shape)) return null;
        ids.push(nd.id);
    }
    return ids;
}

function topicsAmong(store: EditorStore, ids: readonly string[]): string[] {
    const page = activePage(store.getState().doc);
    return ids.filter(id => {
        const nd = nodeById(page, id);
        return nd !== undefined && isTopicShape(nd.shape);
    });
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

function selectionPayload(store: EditorStore): ClipboardPayload | null {
    const page = activePage(store.getState().doc);
    const ids = withDescendants(page, store.selectedNodeIds());
    const nodes = ids
        .map(id => nodeById(page, id))
        .filter((nd): nd is DiagramNode => nd !== undefined);
    const selectedEdgeIds = new Set(store.selectedEdgeIds());
    // Internal connectors ride along automatically; a selected connector comes
    // even when only one of its ends was copied.
    const idSet = new Set(ids);
    const edges = page.edges.filter(
        e =>
            selectedEdgeIds.has(e.id) ||
            ((e.from.nodeId ? idSet.has(e.from.nodeId) : false) &&
                (e.to.nodeId ? idSet.has(e.to.nodeId) : false))
    );
    if (nodes.length === 0 && edges.length === 0) return null;
    return buildPayload(nodes, edges);
}

export async function copySelection(store: EditorStore): Promise<boolean> {
    const payload = selectionPayload(store);
    if (!payload) return false;
    await writeClipboard(payload);
    return true;
}

export async function cutSelection(store: EditorStore): Promise<boolean> {
    const ok = await copySelection(store);
    if (ok) deleteSelection(store);
    return ok;
}

export async function pasteClipboard(store: EditorStore, at?: Point): Promise<void> {
    const payload = await readClipboard();
    if (!payload) return;
    const offset = at
        ? { x: at.x - payload.origin.x, y: at.y - payload.origin.y }
        : { x: 24, y: 24 };
    const { nodes, edges } = instantiate(payload, offset);
    store.updatePage(page => addEdges(addNodes(page, nodes), edges), { label: "Paste" });
    store.setSelection(nodes.map(nd => ({ kind: "node" as const, id: nd.id })));
}

export function duplicateSelection(store: EditorStore): void {
    const payload = selectionPayload(store);
    if (!payload) return;
    const { nodes, edges } = instantiate(payload, { x: 24, y: 24 });
    store.updatePage(page => addEdges(addNodes(page, nodes), edges), { label: "Duplicate" });
    store.setSelection(nodes.map(nd => ({ kind: "node" as const, id: nd.id })));
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function selectAll(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const refs: SelectionRef[] = [
        ...page.nodes
            .filter(nd => !nd.locked && !nd.hidden)
            .map(nd => ({ kind: "node" as const, id: nd.id })),
        ...page.edges
            .filter(e => !e.locked && !e.hidden)
            .map(e => ({ kind: "edge" as const, id: e.id })),
    ];
    store.setSelection(refs);
}

export function selectInverse(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const current = new Set(store.getState().selection.map(s => `${s.kind}:${s.id}`));
    const refs: SelectionRef[] = [
        ...page.nodes.map(nd => ({ kind: "node" as const, id: nd.id })),
        ...page.edges.map(e => ({ kind: "edge" as const, id: e.id })),
    ].filter(ref => !current.has(`${ref.kind}:${ref.id}`));
    store.setSelection(refs);
}

/** Select every node using the same shape as the current selection. */
export function selectSameShape(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const shapes = new Set(
        store
            .selectedNodeIds()
            .map(id => nodeById(page, id)?.shape)
            .filter((s): s is ShapeId => s !== undefined)
    );
    if (shapes.size === 0) return;
    store.selectNodes(page.nodes.filter(nd => shapes.has(nd.shape)).map(nd => nd.id));
}

/** Select the whole connected component of the current selection. */
export function selectConnected(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const idx = graphIndex(page);
    const seen = new Set<string>(store.selectedNodeIds());
    const stack = [...seen];
    while (stack.length) {
        const cur = stack.pop()!;
        for (const nxt of [...(idx.out.get(cur) ?? []), ...(idx.in.get(cur) ?? [])]) {
            if (!seen.has(nxt)) {
                seen.add(nxt);
                stack.push(nxt);
            }
        }
    }
    if (seen.size === 0) return;
    store.selectNodes([...seen]);
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export function groupSelection(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const ids = store.selectedNodeIds();
    if (ids.length < 2) return;
    const nodes = ids
        .map(id => nodeById(page, id))
        .filter((nd): nd is DiagramNode => nd !== undefined);
    const bounds = nodesBounds(nodes);
    if (!bounds) return;

    const group = createNode({
        shape: "group",
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        parentId: nodes[0]?.parentId ?? null,
    });

    store.updatePage(
        p => {
            const withGroup = addNodes(p, [group]);
            return mapNodes(withGroup, ids, nd => ({ ...nd, parentId: group.id }));
        },
        { label: "Group" }
    );
    store.selectNodes([group.id]);
}

export function ungroupSelection(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const groupIds = store.selectedNodeIds().filter(id => nodeById(page, id)?.shape === "group");
    if (groupIds.length === 0) return;

    const released: string[] = [];
    store.updatePage(
        p => {
            let next = p;
            for (const gid of groupIds) {
                const group = nodeById(next, gid);
                const kids = childrenOf(next, gid).map(k => k.id);
                released.push(...kids);
                next = mapNodes(next, kids, nd => ({ ...nd, parentId: group?.parentId ?? null }));
                next = removeNodes(next, [gid]);
            }
            return next;
        },
        { label: "Ungroup" }
    );
    store.selectNodes(released);
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

export function reorder(store: EditorStore, move: "front" | "back" | "forward" | "backward"): void {
    const ids = store.selectedNodeIds();
    if (ids.length === 0) return;
    const labels = {
        front: "Bring to front",
        back: "Send to back",
        forward: "Bring forward",
        backward: "Send backward",
    } as const;
    store.updatePage(page => reorderNodes(page, withDescendants(page, ids), move), {
        label: labels[move],
    });
}

// ---------------------------------------------------------------------------
// Alignment & distribution
// ---------------------------------------------------------------------------

export type AlignAxis = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export function alignSelection(store: EditorStore, axis: AlignAxis): void {
    const page = activePage(store.getState().doc);
    const ids = store.selectedNodeIds();
    if (ids.length < 2) return;
    const nodes = ids
        .map(id => nodeById(page, id))
        .filter((nd): nd is DiagramNode => nd !== undefined);
    const bounds = nodesBounds(nodes);
    if (!bounds) return;

    const deltaFor = (nd: DiagramNode): Point => {
        const b = nodeBounds(nd);
        switch (axis) {
            case "left":
                return { x: bounds.x - b.x, y: 0 };
            case "right":
                return { x: bounds.x + bounds.w - (b.x + b.w), y: 0 };
            case "hcenter":
                return { x: bounds.x + bounds.w / 2 - (b.x + b.w / 2), y: 0 };
            case "top":
                return { x: 0, y: bounds.y - b.y };
            case "bottom":
                return { x: 0, y: bounds.y + bounds.h - (b.y + b.h) };
            case "vcenter":
            default:
                return { x: 0, y: bounds.y + bounds.h / 2 - (b.y + b.h / 2) };
        }
    };

    placeByHand(store, `Align ${axis}`, p => {
        let next = p;
        for (const nd of nodes) {
            const d = deltaFor(nd);
            if (d.x === 0 && d.y === 0) continue;
            next = translateNodes(next, [nd.id], d);
        }
        return next;
    });
}

export function distributeSelection(store: EditorStore, axis: "h" | "v"): void {
    const page = activePage(store.getState().doc);
    const ids = store.selectedNodeIds();
    if (ids.length < 3) return;
    const nodes = ids
        .map(id => nodeById(page, id))
        .filter((nd): nd is DiagramNode => nd !== undefined)
        .sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));

    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const totalSpan = axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
    const used = nodes.reduce((s, nd) => s + (axis === "h" ? nd.w : nd.h), 0);
    const gap = (totalSpan - used) / (nodes.length - 1);

    placeByHand(store, `Distribute ${axis === "h" ? "horizontally" : "vertically"}`, p => {
        let next = p;
        let cursor = axis === "h" ? first.x + first.w + gap : first.y + first.h + gap;
        for (let i = 1; i < nodes.length - 1; i++) {
            const nd = nodes[i]!;
            const delta = axis === "h" ? { x: cursor - nd.x, y: 0 } : { x: 0, y: cursor - nd.y };
            next = translateNodes(next, [nd.id], delta);
            cursor += (axis === "h" ? nd.w : nd.h) + gap;
        }
        return next;
    });
}

/**
 * Boxes put somewhere by hand (align, distribute): one undo step, and on a
 * chart that arranges itself the chart is held where it is from now on.
 */
function placeByHand(
    store: EditorStore,
    label: string,
    edit: (page: DiagramPage) => DiagramPage
): void {
    const before = store.getState().doc;
    store.group(label, () => {
        store.updatePage(edit, { label });
        if (store.getState().doc !== before) holdChartInPlace(store);
    });
}

/** Give every selected node the width/height of the largest one. */
export function matchSize(store: EditorStore, dimension: "w" | "h" | "both"): void {
    const page = activePage(store.getState().doc);
    const ids = store.selectedNodeIds();
    if (ids.length < 2) return;
    const nodes = ids
        .map(id => nodeById(page, id))
        .filter((nd): nd is DiagramNode => nd !== undefined);
    const w = Math.max(...nodes.map(nd => nd.w));
    const h = Math.max(...nodes.map(nd => nd.h));
    store.updatePage(
        p =>
            mapNodes(p, ids, nd => ({
                ...nd,
                w: dimension === "h" ? nd.w : w,
                h: dimension === "w" ? nd.h : h,
            })),
        { label: "Match size" }
    );
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/**
 * Move nodes and their descendants, and drag along any waypoint on a connector
 * whose *both* ends are inside the moved set — otherwise a moved cluster leaves
 * its own routing behind.
 */
export function translateNodes(
    page: DiagramPage,
    ids: readonly string[],
    delta: Point,
    /** Connectors the person selected too: they travel whatever their ends do. */
    selectedEdgeIds: readonly string[] = []
): DiagramPage {
    const all = withDescendants(page, ids);
    if ((all.length === 0 && selectedEdgeIds.length === 0) || (delta.x === 0 && delta.y === 0)) {
        return page;
    }
    const next = mapNodes(page, all, nd => ({ ...nd, x: nd.x + delta.x, y: nd.y + delta.y }));
    const carried = edgesMovingWith(next, all, selectedEdgeIds);
    // Bends left behind that no longer make a clean path go (routing.ts).
    if (carried.length === 0) return dropStaleBends(next, all);
    return dropStaleBends(
        mapEdges(
            next,
            carried.map(e => e.id),
            e => shiftEdge(e, delta)
        ),
        all
    );
}

/**
 * The connectors whose own geometry — bends and free-floating ends — has to
 * travel when `nodeIds` move: every selected connector, and every connector
 * whose attached ends all sit on moving nodes. Without this a moved group
 * left its hand-routed lines behind, bent towards where the boxes used to be.
 * Connectors with nothing of their own to move (no bends, no free end) are
 * left out, since routing already follows their nodes.
 */
export function edgesMovingWith(
    page: DiagramPage,
    nodeIds: readonly string[],
    selectedEdgeIds: readonly string[] = []
): DiagramEdge[] {
    const moving = new Set(nodeIds);
    const selected = new Set(selectedEdgeIds);
    return page.edges.filter(e => {
        const freeEnd = (end: DiagramEdge["from"]) => !end.nodeId && end.point !== undefined;
        const hasOwnGeometry = e.waypoints.length > 0 || freeEnd(e.from) || freeEnd(e.to);
        if (!hasOwnGeometry || e.locked) return false;
        if (selected.has(e.id)) return true;
        const attached = [e.from.nodeId, e.to.nodeId].filter((id): id is string => !!id);
        return attached.length > 0 && attached.every(id => moving.has(id));
    });
}

/** A connector's bends and free ends, shifted by `delta`. Attached ends follow their nodes. */
export function shiftEdge(e: DiagramEdge, delta: Point): DiagramEdge {
    const shift = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
    return {
        ...e,
        waypoints: e.waypoints.map(shift),
        from: !e.from.nodeId && e.from.point ? { ...e.from, point: shift(e.from.point) } : e.from,
        to: !e.to.nodeId && e.to.point ? { ...e.to, point: shift(e.to.point) } : e.to,
    };
}

/**
 * Move the selection by `delta` (the arrow keys' nudge). On a chart that
 * arranges itself this is a hand placement: the chart is held where it is
 * from now on, in the same undo step.
 */
export function moveSelection(store: EditorStore, delta: Point, label = "Move"): void {
    const ids = store.selectedNodeIds();
    if (ids.length === 0) return;
    const edgeIds = store.selectedEdgeIds();
    const hold = arrangesItself(store.getState().doc);
    store.update(
        doc => {
            const page = activePage(doc);
            const moved = translateNodes(page, ids, delta, edgeIds);
            if (moved === page) return null;
            const next = updatePage(doc, page.id, () => moved);
            return hold ? { ...next, settings: { ...next.settings, flowLayout: "manual" } } : next;
        },
        { label, coalesceKey: `move:${ids.join(",")}` }
    );
    if (hold && !arrangesItself(store.getState().doc)) chartHeld(store);
}

/** Scale a set of nodes so their combined bounds become `target`. */
export function scaleNodesToBounds(
    page: DiagramPage,
    ids: readonly string[],
    from: Rect,
    target: Rect
): DiagramPage {
    const all = withDescendants(page, ids);
    const sx = from.w === 0 ? 1 : target.w / from.w;
    const sy = from.h === 0 ? 1 : target.h / from.h;
    return mapNodes(page, all, nd => ({
        ...nd,
        x: target.x + (nd.x - from.x) * sx,
        y: target.y + (nd.y - from.y) * sy,
        w: Math.max(nd.w * sx, shapeDef(nd.shape).minSize.w),
        h: Math.max(nd.h * sy, shapeDef(nd.shape).minSize.h),
    }));
}

export function rotateSelection(store: EditorStore, degrees: number): void {
    const ids = store.selectedNodeIds();
    if (ids.length === 0) return;
    store.updatePage(
        page => mapNodes(page, ids, nd => ({ ...nd, rotation: (nd.rotation + degrees) % 360 })),
        { label: "Rotate" }
    );
}

export function flipSelection(store: EditorStore, axis: "h" | "v"): void {
    const page = activePage(store.getState().doc);
    const ids = withDescendants(page, store.selectedNodeIds());
    if (ids.length === 0) return;
    const nodes = ids
        .map(id => nodeById(page, id))
        .filter((nd): nd is DiagramNode => nd !== undefined);
    const bounds = nodesBounds(nodes);
    if (!bounds) return;
    store.updatePage(
        p =>
            mapNodes(p, ids, nd => ({
                ...nd,
                x: axis === "h" ? bounds.x + bounds.w - (nd.x - bounds.x) - nd.w : nd.x,
                y: axis === "v" ? bounds.y + bounds.h - (nd.y - bounds.y) - nd.h : nd.y,
                rotation: nd.rotation === 0 ? 0 : -nd.rotation,
            })),
        { label: `Flip ${axis === "h" ? "horizontal" : "vertical"}` }
    );
}

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

/**
 * The boxes a style change applies to: the selected ones, with a selected
 * group standing for its members (a group has no look of its own to change).
 */
export function styledNodeIds(store: EditorStore): string[] {
    const page = activePage(store.getState().doc);
    const out = new Set<string>();
    for (const id of store.selectedNodeIds()) {
        if (nodeById(page, id)?.shape !== "group") {
            out.add(id);
            continue;
        }
        for (const member of withDescendants(page, [id])) {
            if (nodeById(page, member)?.shape !== "group") out.add(member);
        }
    }
    return [...out];
}

export function styleSelection(
    store: EditorStore,
    patch: Partial<NodeStyle>,
    label = "Style"
): void {
    const nodeIds = styledNodeIds(store);
    if (nodeIds.length === 0) return;
    store.updatePage(
        page => mapNodes(page, nodeIds, nd => ({ ...nd, style: { ...nd.style, ...patch } })),
        { label, coalesceKey: `style:${Object.keys(patch).join(",")}` }
    );
}

export function styleTextSelection(
    store: EditorStore,
    patch: Partial<TextStyle>,
    label = "Text style"
): void {
    const nodeIds = styledNodeIds(store);
    const edgeIds = store.selectedEdgeIds();
    if (nodeIds.length === 0 && edgeIds.length === 0) return;
    store.updatePage(
        page => {
            let next = page;
            if (nodeIds.length) {
                next = mapNodes(next, nodeIds, nd => ({
                    ...nd,
                    textStyle: { ...nd.textStyle, ...patch },
                }));
            }
            if (edgeIds.length) {
                next = mapEdges(next, edgeIds, e => ({
                    ...e,
                    textStyle: { ...e.textStyle, ...patch },
                }));
            }
            return next;
        },
        { label, coalesceKey: `text:${Object.keys(patch).join(",")}` }
    );
}

export function styleEdgeSelection(
    store: EditorStore,
    patch: Partial<DiagramEdge["style"]>,
    label = "Connector style"
): void {
    const ids = store.selectedEdgeIds();
    if (ids.length === 0) return;
    store.updatePage(
        page => mapEdges(page, ids, e => ({ ...e, style: { ...e.style, ...patch } })),
        {
            label,
            coalesceKey: `edgestyle:${Object.keys(patch).join(",")}`,
        }
    );
}

/** Apply a whole swatch (fill + stroke + ink) to the node selection. */
/**
 * Colour the selection with a swatch, in the tone for this document's paper —
 * the light table on a dark board painted pale pastel boxes. Only the boxes
 * picked change: a topic keeps its depth's weight (`recolourTopics`), anything
 * else takes the swatch as is, and nothing below or around them is touched.
 */
export function applySwatch(store: EditorStore, swatchId: string): void {
    if (!SWATCH_BY_ID[swatchId]) return;
    const ids = styledNodeIds(store);
    if (ids.length === 0) return;
    const { paletteId } = store.getState().doc.settings;
    const sw = swatchFor(swatchId, docMode(store));
    store.updatePage(
        page => {
            const topics = ids.filter(id => nodeById(page, id)?.shape.startsWith("mind-"));
            const others = ids.filter(id => !topics.includes(id));
            const recoloured = topics.length
                ? recolourTopics(page, topics, swatchId, paletteId)
                : page;
            return mapNodes(recoloured, others, nd => ({
                ...nd,
                style: { ...nd.style, fill: sw.fill, stroke: sw.stroke },
                textStyle: { ...nd.textStyle, color: sw.ink },
            }));
        },
        { label: `Colour ${sw.name}` }
    );
}

export function setShapeType(store: EditorStore, shape: ShapeId): void {
    const ids = store.selectedNodeIds();
    if (ids.length === 0) return;
    store.updatePage(page => mapNodes(page, ids, nd => ({ ...nd, shape })), {
        label: `Change to ${shapeDef(shape).name}`,
    });
}

export function toggleLock(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const nodeIds = store.selectedNodeIds();
    const edgeIds = store.selectedEdgeIds();
    if (nodeIds.length === 0 && edgeIds.length === 0) return;
    const anyUnlocked =
        nodeIds.some(id => nodeById(page, id)?.locked === false) ||
        edgeIds.some(id => page.edges.find(e => e.id === id)?.locked === false);
    store.updatePage(
        p => {
            let next = mapNodes(p, nodeIds, nd => ({ ...nd, locked: anyUnlocked }));
            next = mapEdges(next, edgeIds, e => ({ ...e, locked: anyUnlocked }));
            return next;
        },
        { label: anyUnlocked ? "Lock" : "Unlock" }
    );
}

/** Restyle the whole active page to a named theme. */
export function applyTheme(store: EditorStore, themeId: string): void {
    const theme = THEME_BY_ID[themeId];
    if (!theme) return;
    store.update(doc => applyThemeToDoc(doc, themeId), { label: `Theme: ${theme.name}` });
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function setNodeText(
    store: EditorStore,
    nodeId: string,
    text: string,
    opts?: { fit?: boolean }
): void {
    store.updatePage(
        page =>
            mapNodes(page, [nodeId], nd => {
                const next = { ...nd, text };
                return opts?.fit ? fitToLabel(next) : next;
            }),
        {
            label: "Edit text",
            coalesceKey: `text:${nodeId}`,
        }
    );
}

export function setEdgeLabel(
    store: EditorStore,
    edgeId: string,
    index: number,
    text: string
): void {
    store.updatePage(
        page =>
            mapEdges(page, [edgeId], e => {
                const labels = [...e.labels];
                if (index < labels.length) {
                    const existing = labels[index]!;
                    labels[index] = { ...existing, text };
                } else {
                    labels.push({ text, t: 0.5, offset: 0 });
                }
                return { ...e, labels: labels.filter(l => l.text !== "" || labels.length === 1) };
            }),
        { label: "Edit label", coalesceKey: `label:${edgeId}:${index}` }
    );
}

export function setAlign(store: EditorStore, align: HAlign): void {
    styleTextSelection(store, { align }, "Align text");
}

export function setVAlign(store: EditorStore, valign: VAlign): void {
    styleTextSelection(store, { valign }, "Align text");
}

/** Width grows (never shrinks), height hugs the wrapped label. */
function fitToLabel(nd: DiagramNode): DiagramNode {
    if (!nd.text.trim()) return nd;
    const box = shapeTextBox(nd.shape, nd.w, nd.h);
    const padX = nd.w - box.w;
    const padY = nd.h - box.h;
    const laid = layoutText(nd.text, nd.textStyle, Math.max(box.w, 40));
    const min = shapeDef(nd.shape).minSize;
    return {
        ...nd,
        w: Math.max(nd.w, Math.ceil(laid.width + padX + 8), min.w),
        h: Math.max(Math.ceil(laid.height + padY + 8), min.h),
    };
}

function sameRect(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** How a box grows while typing: a flowchart's boxes keep their width and grow down. */
function growOptions(store: EditorStore): { keepWidth?: boolean } {
    return flowLookOf(store.getState().doc)?.fixedWidth ? { keepWidth: true } : {};
}

/**
 * Show a box growing while its label is typed: geometry only, and no undo
 * entry — `commitNodeText` lands the words and the size together. `start` is
 * the node as it was when typing began; the box is never smaller than that.
 */
export function previewTextGrowth(store: EditorStore, start: DiagramNode, text: string): void {
    const next = sizeForText(start, text, growOptions(store));
    store.updatePage(
        page => mapNodes(page, [start.id], nd => (sameRect(nd, next) ? nd : { ...nd, ...next })),
        { transient: true }
    );
}

/**
 * Finish typing into a box: the words, and the size they need, as one undo
 * step. The preview frames are rolled back first so that step starts from
 * the box as it was before typing. Leaving the words as they were leaves the
 * box as it was too — opening a label and closing it is not an edit.
 */
export function commitNodeText(store: EditorStore, start: DiagramNode, text: string): void {
    const current = nodeById(activePage(store.getState().doc), start.id);
    if (!current) return;
    if (!sameRect(current, start)) {
        store.updatePage(
            page =>
                mapNodes(page, [start.id], nd => ({
                    ...nd,
                    x: start.x,
                    y: start.y,
                    w: start.w,
                    h: start.h,
                })),
            { transient: true }
        );
    }
    if (text === current.text) return;
    const grown = sizeForText(start, text, growOptions(store));
    const look = flowLookOf(store.getState().doc);
    store.group("Edit text", () => {
        store.updatePage(
            page =>
                mapNodes(page, [start.id], nd => {
                    const next = { ...nd, ...grown, text };
                    // A text mark hugs its words: nobody sizes a caption first
                    // and types second, so its height follows them both ways.
                    const fitted = nd.shape === "text" ? fitToLabel(next) : next;
                    // On a flowchart a box changes with its words (a question
                    // becoming a decision), in this same step.
                    const patch = look?.afterText?.(fitted, text, docMode(store));
                    return patch ? { ...fitted, ...patch } : fitted;
                }),
            { label: "Edit text", coalesceKey: `text:${start.id}` }
        );
        // A step that grew or changed kind, on a chart that arranges itself,
        // is laid out again with the rest — however the label was finished
        // (Enter, Tab, Esc, or a click away).
        const after = nodeById(activePage(store.getState().doc), start.id);
        if (after && (after.shape !== start.shape || !sameRect(after, start))) {
            arrangeIfAuto(store, [start.id]);
        }
        // A topic that grew may now crowd its neighbours on an arranged map.
        if (!sameRect(start, grown)) autoArrangeIfOn(store);
    });
}

/** Grow (never shrink below the shape minimum) so the label fits. */
export function fitNodeToText(store: EditorStore, nodeIds: readonly string[]): void {
    if (nodeIds.length === 0) return;
    store.updatePage(page => mapNodes(page, nodeIds, fitToLabel), { label: "Fit to text" });
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export function setEdgeKind(store: EditorStore, kind: EdgeKind): void {
    const ids = store.selectedEdgeIds();
    if (ids.length === 0) {
        store.update(doc => ({ ...doc, settings: { ...doc.settings, defaultEdgeKind: kind } }), {
            label: "Connector style",
        });
        return;
    }
    store.updatePage(page => mapEdges(page, ids, e => ({ ...e, kind })), {
        label: "Connector kind",
    });
}

export function setArrow(store: EditorStore, end: "start" | "end", arrow: ArrowId): void {
    const ids = store.selectedEdgeIds();
    if (ids.length === 0) return;
    store.updatePage(
        page =>
            mapEdges(page, ids, e =>
                end === "start" ? { ...e, startArrow: arrow } : { ...e, endArrow: arrow }
            ),
        { label: "Arrowhead" }
    );
}

export function reverseEdges(store: EditorStore): void {
    const ids = store.selectedEdgeIds();
    if (ids.length === 0) return;
    store.updatePage(
        page =>
            mapEdges(page, ids, e => ({
                ...e,
                from: e.to,
                to: e.from,
                startArrow: e.endArrow,
                endArrow: e.startArrow,
                waypoints: [...e.waypoints].reverse(),
            })),
        { label: "Reverse direction" }
    );
}

export function clearWaypoints(store: EditorStore): void {
    const ids = store.selectedEdgeIds();
    if (ids.length === 0) return;
    store.updatePage(page => mapEdges(page, ids, e => ({ ...e, waypoints: [] })), {
        label: "Reset route",
    });
}

/** Take one bend out of a connector (double-clicking its handle). */
export function removeBend(store: EditorStore, edgeId: string, index: number): void {
    store.updatePage(
        page =>
            mapEdges(page, [edgeId], e =>
                index >= 0 && index < e.waypoints.length
                    ? { ...e, waypoints: e.waypoints.filter((_, i) => i !== index) }
                    : e
            ),
        { label: "Remove bend" }
    );
}

// ---------------------------------------------------------------------------
// Mindmap-specific
// ---------------------------------------------------------------------------

/** Depth of `nodeId` in the graph, walking up incoming edges. */
function depthOf(page: DiagramPage, nodeId: string): number {
    const idx = graphIndex(page);
    let depth = 0;
    let cur = nodeId;
    const seen = new Set<string>([cur]);
    while (depth < 64) {
        const parents = idx.in.get(cur) ?? [];
        const parent = parents[0];
        if (!parent || seen.has(parent)) break;
        seen.add(parent);
        cur = parent;
        depth += 1;
    }
    return depth;
}

/** Add a child topic under `parentId` and start editing it. */
/**
 * Focus depth keeps the tree tidy as it grows: after a structural edit the
 * mindmap layout runs over the whole page. The selection is cleared first,
 * because `runLayout` reads a selection as "only these".
 */
function autoArrangeIfOn(store: EditorStore): void {
    const doc = store.getState().doc;
    const layout = doc.settings.autoLayout;
    if (!layout) return;
    // Only a mindmap, and only a page that is nothing but topics: see
    // `isMindmapPage`. A flowchart drawn with topic shapes is still laid out
    // by hand.
    if (worksAsFlow(doc.settings.kind) || !isMindmapPage(activePage(doc))) return;
    store.clearSelection();
    // Part of the edit that triggered it, not an edit of its own: one ⌘Z
    // after Tab should take the new topic away, not just un-arrange it.
    runLayout(store, layout, { transient: true });
}

// ---------------------------------------------------------------------------
// Auto-arrange (a document setting — the file remembers it)
// ---------------------------------------------------------------------------

export function setAutoLayout(store: EditorStore, layout: AutoLayoutSetting | null): void {
    store.update(doc => ({ ...doc, settings: { ...doc.settings, autoLayout: layout } }), {
        label: layout ? "Auto-arrange on" : "Auto-arrange off",
    });
    if (layout) {
        store.clearSelection();
        runLayout(store, layout);
    }
}

/** Run the document's arrangement once, now — auto-arrange or not. */
export function arrangeNow(store: EditorStore): void {
    const { settings } = store.getState().doc;
    // A flowchart is laid out top to bottom, chart by chart, whether or not
    // it arranges itself; its setting is left as it is.
    if (worksAsFlow(settings.kind)) {
        store.updatePage(tidyAll, { label: "Arrange" });
        return;
    }
    const layout = settings.autoLayout ?? { kind: "mindmap" as const };
    store.clearSelection();
    runLayout(store, layout);
}

/**
 * A shape someone placed by hand should stay where they put it, so a manual
 * move ends auto-arrange. Returns the layout that was running so the caller
 * can offer to bring it back; `null` when nothing was on.
 */
export function pauseAutoArrangeAfterManualMove(store: EditorStore): AutoLayoutSetting | null {
    const layout = store.getState().doc.settings.autoLayout;
    if (!layout) return null;
    store.update(doc => ({ ...doc, settings: { ...doc.settings, autoLayout: null } }), {
        label: "Auto-arrange paused",
    });
    return layout;
}

export function addChildTopic(
    store: EditorStore,
    parentId: string,
    /** Insert beside this existing child instead of after the last one. */
    place: { after?: string; before?: string } = {}
): string | null {
    const page = activePage(store.getState().doc);
    const parent = nodeById(page, parentId);
    if (!parent) return null;
    const depth = depthOf(page, parentId) + 1;
    const { paletteId } = store.getState().doc.settings;
    const mode = themeMode(paletteId);
    const size = { w: depth === 1 ? 170 : 150, h: depth === 1 ? 56 : 48 };
    const at = suggestChildPosition(page, parentId, size, "right");

    // Shape, size and type come from the depth; colour is painted below from
    // the theme and the branch this topic joins (`paintTopics`).
    const child = createNode({
        shape: depth >= 3 ? "mind-leaf" : "mind-branch",
        mode,
        x: at.x,
        y: at.y,
        w: size.w,
        h: size.h,
        text: "",
        textStyle: defaultTextStyle({
            ...topicType(depth),
            align: depth >= 3 ? "left" : "center",
            valign: depth >= 3 ? "bottom" : "middle",
        }),
        data: { depth },
    });

    // A new branch should look like its siblings: take the connector kind
    // from an existing edge out of this parent, and fall back to the
    // document default only for the first one.
    const siblingEdge = page.edges.find(e => e.from.nodeId === parentId);
    const edge = createEdge({
        from: { nodeId: parentId, port: "auto" },
        to: { nodeId: child.id, port: "auto" },
        kind: siblingEdge?.kind ?? store.getState().doc.settings.defaultEdgeKind,
        endArrow: "none",
    });

    // Edge order is child order, so a sibling is inserted beside the topic it
    // was made from rather than at the end of the parent's list. Colour is
    // painted in the same step, from the theme and the branch it joins.
    const beside = place.after ?? place.before;
    const anchor = beside
        ? page.edges.find(e => e.from.nodeId === parentId && e.to.nodeId === beside)
        : undefined;
    store.group("Add topic", () => {
        store.updatePage(
            page2 =>
                paintTopics(
                    insertEdgesBeside(
                        // A child added under a folded branch would be born
                        // hidden, with its label field floating over nothing:
                        // open the branch first.
                        addNodes(
                            parent.collapsed
                                ? mapNodes(page2, [parentId], nd => ({ ...nd, collapsed: false }))
                                : page2,
                            [child]
                        ),
                        [edge],
                        anchor?.id,
                        place.after ? "after" : "before"
                    ),
                    [child.id],
                    paletteId,
                    { fresh: true }
                ),
            { label: "Add topic" }
        );
        autoArrangeIfOn(store);
    });
    store.selectNodes([child.id]);
    store.setEditing({ kind: "node", id: child.id });
    return child.id;
}

// ---------------------------------------------------------------------------
// Flowchart
// ---------------------------------------------------------------------------

export type { FlowStep } from "./flowchart/arrange";

function dominant(v: Point): FlowStep {
    if (Math.abs(v.x) >= Math.abs(v.y)) return v.x >= 0 ? "right" : "left";
    return v.y >= 0 ? "down" : "up";
}

/**
 * Which way a flowchart reads at this box: on in the direction the line came
 * in, else the way its existing arrows already leave, else `fallback` — to
 * the right on a freeform drawing, down on a flowchart.
 */
export function flowDirection(
    page: DiagramPage,
    nodeId: string,
    fallback: FlowStep = "right"
): FlowStep {
    const node = nodeById(page, nodeId);
    if (!node) return fallback;
    const here = nodeCenter(node);
    const idx = graphIndex(page);
    for (const id of idx.in.get(nodeId) ?? []) {
        const from = id !== nodeId ? nodeById(page, id) : undefined;
        if (from) {
            const c = nodeCenter(from);
            return dominant({ x: here.x - c.x, y: here.y - c.y });
        }
    }
    for (const id of idx.out.get(nodeId) ?? []) {
        const to = id !== nodeId ? nodeById(page, id) : undefined;
        if (to) {
            const c = nodeCenter(to);
            return dominant({ x: c.x - here.x, y: c.y - here.y });
        }
    }
    return fallback;
}

// -- the flowchart's arrangement ---------------------------------------------

/**
 * Whether this document's flowchart lays itself out: worked as a flowchart,
 * and `flowLayout` is `auto` (a blank flowchart, until a box is moved by hand).
 */
export function arrangesItself(doc: MindmapDoc): boolean {
    return worksAsFlow(doc.settings.kind) && doc.settings.flowLayout === "auto";
}

/**
 * After a structural edit on a chart that arranges itself, lay out the chart
 * holding `seeds` top to bottom (`tidyChart`). Part of the edit that called
 * it: written without an undo entry of its own, so inside a `store.group` one
 * ⌘Z takes back the edit and the arrangement together. Does nothing on a
 * hand-placed chart, a mindmap or a freeform drawing.
 */
export function arrangeIfAuto(store: EditorStore, seeds: readonly string[]): void {
    if (!arrangesItself(store.getState().doc)) return;
    store.updatePage(p => tidyChart(p, seeds), { transient: true });
}

/**
 * A box was placed by hand on a chart that arranges itself: from now on the
 * chart stays where it is put. Written without an undo entry of its own, so
 * it lands in the same step as the move that caused it — a drag, a nudge, an
 * align. Returns true when it changed the setting.
 */
export function holdChartInPlace(store: EditorStore): boolean {
    if (!arrangesItself(store.getState().doc)) return false;
    store.update(
        doc => ({ ...doc, settings: { ...doc.settings, flowLayout: "manual" as const } }),
        { transient: true }
    );
    chartHeld(store);
    return true;
}

const heldListeners = new WeakMap<EditorStore, Set<() => void>>();

/**
 * Hear when a hand placement stops a chart arranging itself — a drag, a
 * nudge, an align. The editor says so, with the way back (Layout ›
 * Arrange automatically).
 */
export function onChartHeld(store: EditorStore, fn: () => void): () => void {
    let set = heldListeners.get(store);
    if (!set) {
        set = new Set();
        heldListeners.set(store, set);
    }
    set.add(fn);
    return () => {
        set.delete(fn);
    };
}

function chartHeld(store: EditorStore): void {
    for (const fn of heldListeners.get(store) ?? []) fn();
}

/**
 * Layout › "Arrange automatically". On: every chart on the page is laid out
 * top to bottom now, and again after each step added or removed. Off: boxes
 * stay where they are. One undo step either way.
 */
export function setFlowLayout(store: EditorStore, layout: FlowLayout): void {
    const { settings } = store.getState().doc;
    if (settings.flowLayout === layout) return;
    store.group(layout === "auto" ? "Arrange automatically" : "Arrange by hand", () => {
        store.update(doc => ({ ...doc, settings: { ...doc.settings, flowLayout: layout } }), {
            label: layout === "auto" ? "Arrange automatically" : "Arrange by hand",
        });
        if (layout === "auto") store.updatePage(tidyAll, { transient: true });
    });
}

// -- a decision's branches ----------------------------------------------------

const branchWordsByStore = new WeakMap<EditorStore, BranchWords>();

/**
 * The words a decision's branches are labelled with, in the reader's
 * language. The editor publishes them once mounted (`flow/FlowOverlay`);
 * before that — in a test, say — a branch is left unlabelled rather than
 * labelled in a language nobody chose.
 */
export function setBranchWords(store: EditorStore, words: BranchWords): void {
    branchWordsByStore.set(store, words);
}

export function branchWordsOf(store: EditorStore): BranchWords {
    return branchWordsByStore.get(store) ?? { yes: "", no: "" };
}

/**
 * Label the arrow `from → to` if `from` is a decision: "Yes" for its first
 * branch, "No" for its second, in the board's soft ink at 12px. Written
 * without an undo entry: it is part of the edit that made the arrow.
 */
export function labelBranch(store: EditorStore, from: string, to: string): void {
    const page = activePage(store.getState().doc);
    const text = branchLabel(page, from, branchWordsOf(store));
    const edge = edgeBetween(page, from, to);
    if (!text || !edge || edge.labels.some(l => l.text.trim())) return;
    const color = neutralsFor(docMode(store)).inkSoft;
    store.updatePage(
        pg =>
            mapEdges(pg, [edge.id], e => ({
                ...e,
                labels: [{ text, t: 0.5, offset: 0 }],
                textStyle: { ...e.textStyle, color, size: 12, bold: false, italic: false },
            })),
        { transient: true }
    );
}

/**
 * Tab on a box in a flowchart: the next step, joined by an arrow, and
 * straight into its label — every path that adds one (Tab, the selection
 * toolbar's +, the menu's "Add next step") comes here.
 *
 * On a flowchart it wears the flowchart look (after a pill, a question or a
 * note, a plain step) and goes after its box, taking over the arrows that
 * left it — a step added in the middle of a line joins the line. Out of a
 * decision it is another branch, and its arrow says "Yes", then "No". The
 * chart is laid out again if it arranges itself. On a hand-placed
 * chart nothing moves: the step goes one gap below its box, beside any step
 * already there. On a freeform drawing it copies the box it follows and its
 * arrows, one gap along the flow.
 */
export function addNextStep(
    store: EditorStore,
    sourceId: string,
    /** A branch beside the box's other steps (⇧Tab), never put in their line. */
    opts: { branch?: boolean } = {}
): string | null {
    const page = activePage(store.getState().doc);
    const source = nodeById(page, sourceId);
    if (!source) return null;
    // A frame or a group is never cloned with an arrow to the copy. An empty
    // frame gets its first step inside; otherwise Tab on one does nothing.
    if (isContainer(source.shape)) return firstStepInside(store, source);

    const look = flowLookOf(store.getState().doc);
    const mode = docMode(store);
    // A mindmap's centre is a filled pill; a step after it is a plain topic.
    const shape =
        look?.nextShape?.(source) ?? (source.shape === "mind-root" ? "mind-branch" : source.shape);
    const def = shapeDef(shape);
    // Same size as the box it follows, unless that box grew to hold a long
    // label — then the shape's own size, since the new box starts empty.
    const grewForText =
        source.text.trim() !== "" &&
        (() => {
            const asDrawn = { ...source, shape, w: def.defaultSize.w, h: def.defaultSize.h };
            const need = sizeForText(asDrawn, source.text);
            return need.w > def.defaultSize.w || need.h > def.defaultSize.h;
        })();
    const lookSize = look?.boxLook(shape, mode).size;
    const size =
        lookSize ??
        (source.shape === "mind-root" || grewForText
            ? { w: def.defaultSize.w, h: def.defaultSize.h }
            : { w: source.w, h: source.h });

    const dir = flowDirection(page, sourceId, look?.direction ?? "right");
    const at = placeAfter(page, source, size, dir);

    const created = createNodeAt(shape, at, { mode, w: size.w, h: size.h });
    // On a flowchart a step wears the look for its shape; on a freeform
    // drawing it copies the box it follows.
    const dressed = look ? dressBox(look, created, mode, { keepSize: true }) : undefined;
    const next: DiagramNode = {
        ...created,
        style: dressed ? dressed.style : { ...source.style },
        textStyle: dressed ? dressed.textStyle : { ...source.textStyle },
        parentId: source.parentId,
        ...(source.data?.depth !== undefined
            ? { data: { depth: Math.max(1, source.data.depth) } }
            : {}),
    };

    // Look like the arrows already here: one leaving this box, else one
    // arriving at it, else the document's default.
    const like =
        page.edges.find(e => e.from.nodeId === sourceId && e.to.nodeId !== sourceId) ??
        page.edges.find(e => e.to.nodeId === sourceId && e.from.nodeId !== sourceId);
    const edge = createEdge({
        from: { nodeId: sourceId, port: "auto" },
        to: { nodeId: next.id, port: "auto" },
        ...(look
            ? edgeOptions(look, mode)
            : {
                  kind: like?.kind ?? store.getState().doc.settings.defaultEdgeKind,
                  style: like ? { ...like.style } : undefined,
                  startArrow: like?.startArrow,
                  endArrow: like ? (like.endArrow === "none" ? "arrow" : like.endArrow) : undefined,
              }),
    });

    // On a flowchart the new step goes *after* its box, as a new line in the
    // Steps panel would: the arrows that left the box now leave the new step.
    // Out of a decision it is another branch, so its arrows stay.
    const insert = look !== null && source.shape !== "decision" && !opts.branch;
    const handOn = (p: DiagramPage): DiagramPage =>
        insert
            ? {
                  ...p,
                  edges: p.edges.map(e =>
                      e.from.nodeId === sourceId && e.to.nodeId !== sourceId
                          ? { ...e, from: { ...e.from, nodeId: next.id }, waypoints: [] }
                          : e
                  ),
              }
            : p;

    store.group("Add step", () => {
        store.updatePage(
            p =>
                addEdges(
                    addNodes(
                        handOn(
                            source.collapsed
                                ? mapNodes(p, [sourceId], nd => ({ ...nd, collapsed: false }))
                                : p
                        ),
                        [next]
                    ),
                    [edge]
                ),
            { label: "Add step" }
        );
        if (look) labelBranch(store, sourceId, next.id);
        // In the same undo step as the box.
        arrangeIfAuto(store, [next.id]);
    });
    store.selectNodes([next.id]);
    store.setEditing({ kind: "node", id: next.id });
    return next.id;
}

/**
 * Tab on an empty frame: its first step, in the top middle of it, joined to
 * the frame, label open. Null for a group, or a frame that holds something.
 */
function firstStepInside(store: EditorStore, frame: DiagramNode): string | null {
    const page = activePage(store.getState().doc);
    if (frame.shape === "group" || childrenOf(page, frame.id).length > 0) return null;
    const look = flowLookOf(store.getState().doc);
    const shape = look?.stepShape ?? "process";
    const size = look?.boxLook(shape, docMode(store)).size ?? shapeDef(shape).defaultSize;
    const at = { x: frame.x + frame.w / 2, y: frame.y + Math.min(frame.h / 2, 48 + size.h / 2) };
    const id = insertShape(store, shape, at, { parentId: frame.id });
    store.setEditing({ kind: "node", id });
    return id;
}

/**
 * Tab and "Add connected": the next step on a flowchart, a child topic on a
 * mindmap. One entry point so the key, the menu and the palette agree.
 */
export function addConnected(store: EditorStore, nodeId: string): string | null {
    const { doc } = store.getState();
    const node = nodeById(activePage(doc), nodeId);
    if (!node) return null;
    // A frame or a group: never a copy, never a topic hung off it.
    return isContainer(node.shape) || stepsFrom(doc.settings.kind, node)
        ? addNextStep(store, nodeId)
        : addChildTopic(store, nodeId);
}

/**
 * Switch how a document works. A flowchart gets no auto-arrange (its layout
 * is the author's); a mindmap keeps whatever arranging was set, and the
 * Arrange menu turns it on.
 */
export function setDiagramKind(store: EditorStore, kind: DiagramKind): void {
    const { settings } = store.getState().doc;
    if (settings.kind === kind) return;
    store.update(
        doc => ({
            ...doc,
            settings: {
                ...doc.settings,
                kind,
                autoLayout: worksAsFlow(kind) ? null : doc.settings.autoLayout,
            },
        }),
        { label: worksAsFlow(kind) ? "Work as a flowchart" : "Work as a mindmap" }
    );
}

/**
 * Add a sibling right after `nodeId` (or before, for ⇧Enter) — a child of the
 * same parent, in the slot next to it. A root topic has no siblings: it gets
 * a child instead, because a second, unconnected centre is never what Enter
 * on the centre meant.
 */
export function addSiblingTopic(
    store: EditorStore,
    nodeId: string,
    side: "after" | "before" = "after"
): string | null {
    const page = activePage(store.getState().doc);
    const nd = nodeById(page, nodeId);
    if (!nd) return null;
    const parent = isTopicShape(nd.shape)
        ? topicParent(page, nodeId)
        : ((graphIndex(page).in.get(nodeId) ?? [])[0] ?? null);
    if (!parent) return addChildTopic(store, nodeId);
    return addChildTopic(store, parent, side === "after" ? { after: nodeId } : { before: nodeId });
}

/**
 * ⇧Tab: lift a topic, with its subtree, out of its parent P and into P's
 * parent, in the slot right after P — the outliner's outdent. A child of the
 * centre stays put: outdenting it would make a second centre.
 */
export function outdentTopic(store: EditorStore, nodeId: string): boolean {
    const page = activePage(store.getState().doc);
    const parent = topicParent(page, nodeId);
    const grand = parent ? topicParent(page, parent) : null;
    if (!parent || !grand) return false;
    // A cross-linked map can have the grandparent downstream of the topic;
    // re-parenting there would close a loop.
    if (grand === nodeId || graphDescendants(page, nodeId).has(grand)) return false;
    const link = page.edges.find(e => e.from.nodeId === parent && e.to.nodeId === nodeId);
    const parentLink = page.edges.find(e => e.from.nodeId === grand && e.to.nodeId === parent);
    if (!link) return false;

    store.group("Outdent topic", () => {
        store.updatePage(
            p => {
                const current = p.edges.find(e => e.id === link.id);
                if (!current) return null;
                const moved: DiagramEdge = {
                    ...current,
                    from: { nodeId: grand, port: "auto" },
                    // The bends were drawn for the old parent.
                    waypoints: [],
                };
                return insertEdgesBeside(
                    removeEdges(p, [link.id]),
                    [moved],
                    parentLink?.id,
                    "after"
                );
            },
            { label: "Outdent topic" }
        );
        restyleMovedTopics(store, [nodeId]);
        autoArrangeIfOn(store);
    });
    store.selectNodes([nodeId]);
    return true;
}

/**
 * ⌘↑ / ⌘↓: move a topic one place up or down among its siblings. Only ever
 * moves an edge *earlier* in the list (the topic's, or the neighbour's it
 * swaps with), so a topic's first incoming edge — which is what makes it its
 * parent's child — stays first.
 */
export function moveTopicAmongSiblings(store: EditorStore, nodeId: string, dir: -1 | 1): boolean {
    const page = activePage(store.getState().doc);
    const parent = topicParent(page, nodeId);
    if (!parent) return false;
    // Its siblings' edges, in order — not every edge out of the parent: a
    // cross-link to some other branch's topic is not a sibling to swap with.
    const idx = graphIndex(page);
    const siblings = page.edges.filter(
        e =>
            e.from.nodeId === parent &&
            e.to.nodeId !== undefined &&
            topicParent(page, e.to.nodeId, idx) === parent
    );
    const at = siblings.findIndex(e => e.to.nodeId === nodeId);
    const other = siblings[at + dir];
    const own = siblings[at];
    if (at < 0 || !other || !own) return false;
    // The edge that comes later jumps to just before the earlier one.
    const [early, late] = dir === -1 ? [other, own] : [own, other];

    store.group("Reorder topic", () => {
        store.updatePage(
            p => insertEdgesBeside(removeEdges(p, [late.id]), [late], early.id, "before"),
            { label: "Reorder topic" }
        );
        autoArrangeIfOn(store);
    });
    store.selectNodes([nodeId]);
    return true;
}

/**
 * ⌘/: fold or unfold every selected node that has children. Mixed states
 * fold, the way toggling a mixed lock locks.
 */
export function toggleCollapseSelection(store: EditorStore): void {
    const page = activePage(store.getState().doc);
    const idx = graphIndex(page);
    const ids = store
        .selectedNodeIds()
        .filter(id => nodeById(page, id) && (idx.out.get(id) ?? []).length > 0);
    if (ids.length === 0) return;
    const collapse = ids.some(id => !nodeById(page, id)!.collapsed);
    store.updatePage(p => mapNodes(p, ids, nd => ({ ...nd, collapsed: collapse })), {
        label: collapse ? "Collapse branch" : "Expand branch",
    });
    // A selected topic inside a branch that just folded is gone from view;
    // keep the selection to what can still be seen.
    if (collapse) {
        const state = store.getState();
        const hidden = collapsedHidden(activePage(state.doc), state.folded);
        const visible = state.selection.filter(ref => ref.kind !== "node" || !hidden.has(ref.id));
        if (visible.length !== state.selection.length) store.setSelection(visible);
    }
}

/**
 * Arrow keys on a topic: select the nearest visible topic that way (see
 * `topicInDirection`) and pan just enough to keep it on screen. Returns the
 * id it moved to, or null when there is nothing in that direction.
 */
export function selectTopicInDirection(
    store: EditorStore,
    fromId: string,
    dir: NavDirection,
    size?: { w: number; h: number }
): string | null {
    const state = store.getState();
    const page = activePage(state.doc);
    const id = topicInDirection(page, fromId, dir, collapsedHidden(page, state.folded));
    if (!id) return null;
    store.selectNodes([id]);
    if (size) revealNode(store, id, size);
    return id;
}

export function toggleCollapse(store: EditorStore, nodeId: string): void {
    store.updatePage(
        page => mapNodes(page, [nodeId], nd => ({ ...nd, collapsed: !nd.collapsed })),
        {
            label: "Collapse branch",
        }
    );
}

export function expandAll(store: EditorStore): void {
    store.updatePage(
        page => ({
            ...page,
            nodes: page.nodes.map(nd => (nd.collapsed ? { ...nd, collapsed: false } : nd)),
        }),
        { label: "Expand all" }
    );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function runLayout(
    store: EditorStore,
    options: LayoutOptions,
    commit: CommitOptions = { label: `Layout: ${options.kind}` }
): void {
    const page = activePage(store.getState().doc);
    const subset = store.selectedNodeIds();
    const positions = computeLayout(page, options, subset);
    if (positions.size === 0) return;
    store.updatePage(
        p => ({
            ...p,
            nodes: p.nodes.map(nd => {
                const pos = positions.get(nd.id);
                return pos ? { ...nd, x: pos.x, y: pos.y } : nd;
            }),
        }),
        commit
    );
}

export function tidyUp(store: EditorStore, kind: LayoutKind = "mindmap"): void {
    runLayout(store, { kind });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** `name` is the new page's name in the reader's language; English without one. */
export function addPage(store: EditorStore, name?: string): void {
    store.update(
        doc => {
            const page = createPage(name ?? `Page ${doc.pages.length + 1}`);
            return { ...doc, pages: [...doc.pages, page], activePageId: page.id };
        },
        { label: "Add page" }
    );
    store.clearSelection();
}

/** `copyName` names the copy from the source's name, in the reader's language. */
export function duplicatePage(
    store: EditorStore,
    pageId: string,
    copyName: (sourceName: string) => string = name => `${name} copy`
): void {
    store.update(
        doc => {
            const source = doc.pages.find(p => p.id === pageId);
            if (!source) return null;
            const payload = buildPayload(source.nodes, source.edges);
            const { nodes, edges } = instantiate(payload, { x: 0, y: 0 });
            const copy: DiagramPage = {
                ...source,
                id: makeId("p"),
                name: copyName(source.name),
                nodes,
                edges,
            };
            const index = doc.pages.findIndex(p => p.id === pageId);
            const pages = [...doc.pages];
            pages.splice(index + 1, 0, copy);
            return { ...doc, pages, activePageId: copy.id };
        },
        { label: "Duplicate page" }
    );
}

export function deletePage(store: EditorStore, pageId: string): void {
    store.update(
        doc => {
            if (doc.pages.length <= 1) return null;
            const pages = doc.pages.filter(p => p.id !== pageId);
            const activePageId =
                doc.activePageId === pageId ? (pages[0]?.id ?? doc.activePageId) : doc.activePageId;
            return {
                ...doc,
                pages,
                activePageId,
                comments: doc.comments.filter(c => c.pageId !== pageId),
            };
        },
        { label: "Delete page" }
    );
    store.clearSelection();
}

export function renamePage(store: EditorStore, pageId: string, name: string): void {
    store.update(doc => updatePage(doc, pageId, p => ({ ...p, name })), {
        label: "Rename page",
        coalesceKey: `page:${pageId}`,
    });
}

export function setActivePage(store: EditorStore, pageId: string): void {
    store.update(doc => (doc.activePageId === pageId ? null : { ...doc, activePageId: pageId }), {
        transient: true,
    });
    store.clearSelection();
}

export function reorderPages(store: EditorStore, from: number, to: number): void {
    store.update(
        doc => {
            if (from === to || from < 0 || from >= doc.pages.length) return null;
            const pages = [...doc.pages];
            const [moved] = pages.splice(from, 1);
            if (!moved) return null;
            pages.splice(clamp(to, 0, pages.length), 0, moved);
            return { ...doc, pages };
        },
        { label: "Reorder pages" }
    );
}

export function setPageBackground(
    store: EditorStore,
    patch: Partial<DiagramPage["background"]>
): void {
    store.update(
        doc => {
            const page = activePage(doc);
            return updatePage(doc, page.id, p => ({
                ...p,
                background: { ...p.background, ...patch },
            }));
        },
        { label: "Page background" }
    );
}

// ---------------------------------------------------------------------------
// Document settings
// ---------------------------------------------------------------------------

export function setSettings(store: EditorStore, patch: Partial<MindmapDoc["settings"]>): void {
    store.update(doc => ({ ...doc, settings: { ...doc.settings, ...patch } }), {
        label: "Settings",
        transient: true,
    });
}

export function setTitle(store: EditorStore, title: string): void {
    store.update(doc => (doc.title === title ? null : { ...doc, title }), {
        label: "Rename",
        coalesceKey: "title",
    });
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export function fitToScreen(store: EditorStore, size: { w: number; h: number }): void {
    const page = activePage(store.getState().doc);
    const bounds = pageBounds(page);
    if (!bounds || bounds.w === 0 || bounds.h === 0) {
        store.setViewport({ x: -size.w / 2, y: -size.h / 2, zoom: 1 });
        return;
    }
    store.setViewport(fitViewport(bounds, size));
}

/**
 * After the page was arranged (Layout › Arrange automatically, Arrange now,
 * the "Arrange automatically" toast): if any of it is now off screen, frame
 * the whole of it, never zoomed past 100%. A page already in view is left as
 * it is, so arranging a chart that fits does not jump the view.
 */
export function revealPage(store: EditorStore, size: { w: number; h: number }): void {
    if (size.w < 40 || size.h < 40) return;
    const bounds = pageBounds(activePage(store.getState().doc));
    if (!bounds) return;
    const { viewport } = store.getState();
    const a = worldToScreen(viewport, bounds);
    const b = worldToScreen(viewport, { x: bounds.x + bounds.w, y: bounds.y + bounds.h });
    if (a.x >= 0 && a.y >= 0 && b.x <= size.w && b.y <= size.h) return;
    store.setViewport(fitViewport(bounds, size, 64, 1));
}

/**
 * Step the zoom, keeping the middle of the canvas where it is.
 *
 * `setViewport({ zoom })` on its own scales about the world origin, so the
 * board lurches away from you and at 400% your diagram is somewhere off past
 * the corner. Every zoom that is not aimed at the cursor should be aimed at
 * the centre of what you are looking at.
 */
export function zoomByStep(store: EditorStore, dir: 1 | -1, size: { w: number; h: number }): void {
    const { viewport } = store.getState();
    store.setViewport(
        zoomAt(viewport, nextZoomStep(viewport.zoom, dir), { x: size.w / 2, y: size.h / 2 })
    );
}

/** Jump to an exact zoom (the percentage menu), also about the centre. */
export function setZoom(store: EditorStore, zoom: number, size: { w: number; h: number }): void {
    const { viewport } = store.getState();
    store.setViewport(zoomAt(viewport, zoom, { x: size.w / 2, y: size.h / 2 }));
}

export function zoomToSelection(store: EditorStore, size: { w: number; h: number }): void {
    const page = activePage(store.getState().doc);
    const bounds = selectionBounds(page, store.getState().selection);
    if (!bounds) {
        fitToScreen(store, size);
        return;
    }
    store.setViewport(fitViewport(bounds, size, 120));
}

export function centreOn(store: EditorStore, point: Point, size: { w: number; h: number }): void {
    const { zoom } = store.getState().viewport;
    store.setViewport({ x: point.x - size.w / 2 / zoom, y: point.y - size.h / 2 / zoom });
}

export function focusNode(
    store: EditorStore,
    nodeId: string,
    size: { w: number; h: number }
): void {
    const page = activePage(store.getState().doc);
    const nd = nodeById(page, nodeId);
    if (!nd) return;
    store.selectNodes([nodeId]);
    centreOn(store, rectCenter(nodeBounds(nd)), size);
}

/**
 * Pan the least distance that brings a node fully on screen, with `margin`
 * screen pixels to spare. Unlike `focusNode` it does nothing when the node is
 * already visible, so stepping through topics with the arrows never lurches.
 */
export function revealNode(
    store: EditorStore,
    nodeId: string,
    size: { w: number; h: number },
    margin = 48
): void {
    if (size.w <= 0 || size.h <= 0) return;
    const nd = nodeById(activePage(store.getState().doc), nodeId);
    if (!nd) return;
    const { viewport } = store.getState();
    const b = nodeBounds(nd);
    const m = margin / viewport.zoom;
    const shift = (start: number, length: number, viewStart: number, viewLength: number) => {
        if (start - m < viewStart || length + 2 * m > viewLength) return start - m - viewStart;
        if (start + length + m > viewStart + viewLength) {
            return start + length + m - (viewStart + viewLength);
        }
        return 0;
    };
    const dx = shift(b.x, b.w, viewport.x, size.w / viewport.zoom);
    const dy = shift(b.y, b.h, viewport.y, size.h / viewport.zoom);
    if (dx === 0 && dy === 0) return;
    store.setViewport({ x: viewport.x + dx, y: viewport.y + dy });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function addComment(
    store: EditorStore,
    input: { nodeId: string | null; at: Point; author: string; body: string }
): void {
    store.update(
        doc => ({
            ...doc,
            comments: [
                ...doc.comments,
                {
                    id: makeId("c"),
                    nodeId: input.nodeId,
                    pageId: doc.activePageId,
                    x: input.at.x,
                    y: input.at.y,
                    author: input.author,
                    body: input.body,
                    resolved: false,
                    createdAt: new Date().toISOString(),
                    replies: [],
                },
            ],
        }),
        { label: "Add comment" }
    );
}

export function replyToComment(
    store: EditorStore,
    commentId: string,
    author: string,
    body: string
): void {
    store.update(
        doc => ({
            ...doc,
            comments: doc.comments.map(c =>
                c.id === commentId
                    ? {
                          ...c,
                          replies: [
                              ...c.replies,
                              {
                                  id: makeId("r"),
                                  author,
                                  body,
                                  createdAt: new Date().toISOString(),
                              },
                          ],
                      }
                    : c
            ),
        }),
        { label: "Reply" }
    );
}

export function resolveComment(store: EditorStore, commentId: string, resolved = true): void {
    store.update(
        doc => ({
            ...doc,
            comments: doc.comments.map(c => (c.id === commentId ? { ...c, resolved } : c)),
        }),
        { label: resolved ? "Resolve comment" : "Reopen comment" }
    );
}

export function deleteComment(store: EditorStore, commentId: string): void {
    store.update(doc => ({ ...doc, comments: doc.comments.filter(c => c.id !== commentId) }), {
        label: "Delete comment",
    });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
    pageId: string;
    pageName: string;
    kind: "node" | "edge" | "comment";
    id: string;
    text: string;
}

export function searchDoc(doc: MindmapDoc, query: string): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    for (const page of doc.pages) {
        for (const nd of page.nodes) {
            if (nd.text.toLowerCase().includes(q)) {
                hits.push({
                    pageId: page.id,
                    pageName: page.name,
                    kind: "node",
                    id: nd.id,
                    text: nd.text,
                });
            }
        }
        for (const e of page.edges) {
            for (const l of e.labels) {
                if (l.text.toLowerCase().includes(q)) {
                    hits.push({
                        pageId: page.id,
                        pageName: page.name,
                        kind: "edge",
                        id: e.id,
                        text: l.text,
                    });
                }
            }
        }
    }
    for (const c of doc.comments) {
        if (c.body.toLowerCase().includes(q)) {
            const page = doc.pages.find(p => p.id === c.pageId);
            hits.push({
                pageId: c.pageId,
                pageName: page?.name ?? "",
                kind: "comment",
                id: c.id,
                text: c.body,
            });
        }
    }
    return hits;
}

// ---------------------------------------------------------------------------
// Misc helpers used by the canvas
// ---------------------------------------------------------------------------

/** Bounds of everything currently selected, for the selection overlay. */
export function currentSelectionBounds(store: EditorStore): Rect | null {
    const page = activePage(store.getState().doc);
    const nodeRects = store
        .selectedNodeIds()
        .map(id => nodeById(page, id))
        .filter((nd): nd is DiagramNode => nd !== undefined)
        .map(nodeBounds);
    return unionRects(nodeRects);
}

/** Connectors attached to the current node selection — used for hover halos. */
export function attachedEdges(store: EditorStore): DiagramEdge[] {
    const page = activePage(store.getState().doc);
    return edgesForNodes(page, store.selectedNodeIds());
}

export function viewportCentre(viewport: ViewportLike, size: { w: number; h: number }): Point {
    return {
        x: viewport.x + size.w / 2 / viewport.zoom,
        y: viewport.y + size.h / 2 / viewport.zoom,
    };
}
