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
    childrenOf,
    edgesForNodes,
    graphDescendants,
    graphIndex,
    mapEdges,
    mapNodes,
    nodeById,
    pageBounds,
    removeEdges,
    removeNodes,
    reorderNodes,
    selectionBounds,
    updatePage,
    withDescendants,
} from "./doc";
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
    nodeBounds,
    nodesBounds,
    rectCenter,
    unionRects,
    type ViewportLike,
} from "./geometry";
import { computeLayout, suggestChildPosition, type LayoutKind, type LayoutOptions } from "./layout";
import { branchSwatch, SWATCH_BY_ID, THEME_BY_ID } from "./palette";
import { shapeDef, shapeTextBox } from "./shapes";
import type { EditorStore } from "./store";
import { layoutText } from "./text";
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
} from "./types";

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

export function insertShape(
    store: EditorStore,
    shape: ShapeId,
    at: Point,
    opts: { text?: string; w?: number; h?: number; parentId?: string | null } = {}
): string {
    const node = createNodeAt(shape, at, opts);
    store.updatePage(page => addNodes(page, [node]), { label: `Add ${shapeDef(shape).name}` });
    store.selectNodes([node.id]);
    return node.id;
}

export function insertNode(store: EditorStore, node: DiagramNode, label = "Add shape"): string {
    store.updatePage(page => addNodes(page, [node]), { label });
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
    store.updatePage(
        page => {
            const idx = graphIndex(page);
            const parent = (idx.in.get(nodeId) ?? [])[0];
            const children = idx.out.get(nodeId) ?? [];
            let next = removeNodes(page, [nodeId]);
            if (parent && children.length) {
                const bridges = children
                    .filter(childId => nodeById(next, childId))
                    .map(childId =>
                        createEdge({
                            from: { nodeId: parent, port: "auto" },
                            to: { nodeId: childId, port: "auto" },
                            kind: page.edges[0]?.kind ?? "elbow",
                        })
                    );
                next = addEdges(next, bridges);
            }
            return next;
        },
        { label: "Delete and reconnect" }
    );
    store.clearSelection();
}

/** Delete a node together with everything downstream of it. */
export function deleteBranch(store: EditorStore, nodeId: string): void {
    store.updatePage(page => removeNodes(page, [nodeId, ...graphDescendants(page, nodeId)]), {
        label: "Delete branch",
    });
    store.clearSelection();
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

    store.updatePage(
        p => {
            let next = p;
            for (const nd of nodes) {
                const d = deltaFor(nd);
                if (d.x === 0 && d.y === 0) continue;
                next = translateNodes(next, [nd.id], d);
            }
            return next;
        },
        { label: `Align ${axis}` }
    );
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

    store.updatePage(
        p => {
            let next = p;
            let cursor = axis === "h" ? first.x + first.w + gap : first.y + first.h + gap;
            for (let i = 1; i < nodes.length - 1; i++) {
                const nd = nodes[i]!;
                const delta =
                    axis === "h" ? { x: cursor - nd.x, y: 0 } : { x: 0, y: cursor - nd.y };
                next = translateNodes(next, [nd.id], delta);
                cursor += (axis === "h" ? nd.w : nd.h) + gap;
            }
            return next;
        },
        { label: `Distribute ${axis === "h" ? "horizontally" : "vertically"}` }
    );
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
    delta: Point
): DiagramPage {
    const all = withDescendants(page, ids);
    if (all.length === 0 || (delta.x === 0 && delta.y === 0)) return page;
    const set = new Set(all);
    let next = mapNodes(page, all, nd => ({ ...nd, x: nd.x + delta.x, y: nd.y + delta.y }));

    const internalEdges = next.edges.filter(
        e =>
            e.from.nodeId &&
            e.to.nodeId &&
            set.has(e.from.nodeId) &&
            set.has(e.to.nodeId) &&
            e.waypoints.length > 0
    );
    if (internalEdges.length) {
        next = mapEdges(
            next,
            internalEdges.map(e => e.id),
            e => ({
                ...e,
                waypoints: e.waypoints.map(p => ({ x: p.x + delta.x, y: p.y + delta.y })),
            })
        );
    }
    // Free-floating endpoints anchored to nothing follow too, so a connector
    // drawn into empty space inside a moved group keeps its shape.
    const freeEnds = next.edges.filter(
        e =>
            (e.from.point !== undefined && e.to.nodeId !== undefined && set.has(e.to.nodeId)) ||
            (e.to.point !== undefined && e.from.nodeId !== undefined && set.has(e.from.nodeId))
    );
    if (freeEnds.length) {
        next = mapEdges(
            next,
            freeEnds.map(e => e.id),
            e => ({
                ...e,
                from: e.from.point
                    ? {
                          ...e.from,
                          point: { x: e.from.point.x + delta.x, y: e.from.point.y + delta.y },
                      }
                    : e.from,
                to: e.to.point
                    ? { ...e.to, point: { x: e.to.point.x + delta.x, y: e.to.point.y + delta.y } }
                    : e.to,
            })
        );
    }
    return next;
}

export function moveSelection(store: EditorStore, delta: Point, label = "Move"): void {
    const ids = store.selectedNodeIds();
    if (ids.length === 0) return;
    store.updatePage(page => translateNodes(page, ids, delta), {
        label,
        coalesceKey: `move:${ids.join(",")}`,
    });
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

export function styleSelection(
    store: EditorStore,
    patch: Partial<NodeStyle>,
    label = "Style"
): void {
    const nodeIds = store.selectedNodeIds();
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
    const nodeIds = store.selectedNodeIds();
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
export function applySwatch(store: EditorStore, swatchId: string): void {
    const sw = SWATCH_BY_ID[swatchId];
    if (!sw) return;
    const ids = store.selectedNodeIds();
    if (ids.length === 0) return;
    store.updatePage(
        page =>
            mapNodes(page, ids, nd => ({
                ...nd,
                style: { ...nd.style, fill: sw.fill, stroke: sw.stroke },
                textStyle: { ...nd.textStyle, color: sw.ink },
            })),
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
    store.update(
        doc => {
            const page = activePage(doc);
            let cycleIndex = 0;
            const nodes = page.nodes.map(nd => {
                if (nd.shape === "group" || nd.shape === "text" || nd.shape === "image") return nd;
                const key = theme.cycle[cycleIndex % theme.cycle.length]!;
                cycleIndex += 1;
                const sw = SWATCH_BY_ID[key]!;
                const isRoot = nd.shape === "mind-root";
                return {
                    ...nd,
                    style: {
                        ...nd.style,
                        fill: isRoot ? sw.stroke : sw.fill,
                        stroke: isRoot ? "none" : sw.stroke,
                    },
                    textStyle: {
                        ...nd.textStyle,
                        color: isRoot ? "oklch(0.99 0.002 285)" : sw.ink,
                    },
                };
            });
            const edges = page.edges.map(e => ({
                ...e,
                style: { ...e.style, stroke: theme.edgeStroke },
            }));
            const next: DiagramPage = {
                ...page,
                nodes,
                edges,
                background: { ...page.background, color: theme.background },
            };
            return {
                ...updatePage(doc, page.id, () => next),
                settings: { ...doc.settings, paletteId: themeId },
            };
        },
        { label: `Theme: ${theme.name}` }
    );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function setNodeText(store: EditorStore, nodeId: string, text: string): void {
    store.updatePage(page => mapNodes(page, [nodeId], nd => ({ ...nd, text })), {
        label: "Edit text",
        coalesceKey: `text:${nodeId}`,
    });
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

/** Grow (never shrink below the shape minimum) so the label fits. */
export function fitNodeToText(store: EditorStore, nodeIds: readonly string[]): void {
    if (nodeIds.length === 0) return;
    store.updatePage(
        page =>
            mapNodes(page, nodeIds, nd => {
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
            }),
        { label: "Fit to text" }
    );
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
export function addChildTopic(store: EditorStore, parentId: string): string | null {
    const page = activePage(store.getState().doc);
    const parent = nodeById(page, parentId);
    if (!parent) return null;
    const depth = depthOf(page, parentId) + 1;
    const sw = branchSwatch(depth);
    const size = { w: depth === 1 ? 170 : 150, h: depth === 1 ? 56 : 48 };
    const at = suggestChildPosition(page, parentId, size, "right");

    const child = createNode({
        shape: depth >= 3 ? "mind-leaf" : "mind-branch",
        x: at.x,
        y: at.y,
        w: size.w,
        h: size.h,
        text: "",
        style:
            depth >= 3 ? { fill: "none", stroke: sw.stroke } : { fill: sw.fill, stroke: sw.stroke },
        textStyle: defaultTextStyle({
            color: sw.ink,
            size: depth === 1 ? 15 : 13.5,
            bold: depth === 1,
            align: depth >= 3 ? "left" : "center",
            valign: depth >= 3 ? "bottom" : "middle",
        }),
        data: { depth },
    });

    const edge = createEdge({
        from: { nodeId: parentId, port: "auto" },
        to: { nodeId: child.id, port: "auto" },
        kind: store.getState().doc.settings.defaultEdgeKind,
        style: { stroke: sw.stroke, strokeWidth: Math.max(3 - depth * 0.5, 1.4) },
        endArrow: "none",
    });

    store.updatePage(page2 => addEdges(addNodes(page2, [child]), [edge]), { label: "Add topic" });
    store.selectNodes([child.id]);
    store.setEditing({ kind: "node", id: child.id });
    return child.id;
}

/** Add a sibling after `nodeId` — a child of the same parent. */
export function addSiblingTopic(store: EditorStore, nodeId: string): string | null {
    const page = activePage(store.getState().doc);
    const idx = graphIndex(page);
    const parent = (idx.in.get(nodeId) ?? [])[0];
    if (!parent) {
        // A root topic's "sibling" is another root: place it below.
        const nd = nodeById(page, nodeId);
        if (!nd) return null;
        const clone = createNode({
            shape: nd.shape,
            x: nd.x,
            y: nd.y + nd.h + 40,
            w: nd.w,
            h: nd.h,
            style: { ...nd.style },
            textStyle: { ...nd.textStyle },
        });
        store.updatePage(p => addNodes(p, [clone]), { label: "Add topic" });
        store.selectNodes([clone.id]);
        store.setEditing({ kind: "node", id: clone.id });
        return clone.id;
    }
    return addChildTopic(store, parent);
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

export function runLayout(store: EditorStore, options: LayoutOptions): void {
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
        { label: `Layout: ${options.kind}` }
    );
}

export function tidyUp(store: EditorStore, kind: LayoutKind = "mindmap"): void {
    runLayout(store, { kind });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

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

export function duplicatePage(store: EditorStore, pageId: string): void {
    store.update(
        doc => {
            const source = doc.pages.find(p => p.id === pageId);
            if (!source) return null;
            const payload = buildPayload(source.nodes, source.edges);
            const { nodes, edges } = instantiate(payload, { x: 0, y: 0 });
            const copy: DiagramPage = {
                ...source,
                id: makeId("p"),
                name: `${source.name} copy`,
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
