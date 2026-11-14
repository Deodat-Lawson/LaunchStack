/**
 * How a model reads a diagram and changes it.
 *
 * `describeDiagram` writes the active page out as text a model can follow —
 * the topic tree as an indented outline, a flowchart as its boxes and
 * arrows — with every shape's id beside it. `applyDiagramEdits` takes a
 * list of small operations that name those ids ("add under [n_x]", "rename
 * [n_y]") and runs them through the editor's own commands on an
 * `EditorStore`, inside one `group`:
 *
 * - on the server (Ask's and MCP's `edit_diagram`) the store is a scratch
 *   copy of the saved document, and its result is saved as a new revision;
 * - in the editor ("Expand with AI") it is the live store, so one ⌘Z takes
 *   the whole change back.
 *
 * Either way a topic added by a model is the topic Tab would have made —
 * same shape for its depth, same paint for its branch, same auto-arrange —
 * because it is made by `addChildTopic`. Operations work on ids, never on
 * positions: what a person placed by hand stays where they put it unless
 * the model asks to `arrange`.
 */

import {
    addChildTopic,
    deleteNodeReconnecting,
    deleteSelection,
    deleteTopicsOrSelection,
    insertEdge,
    insertNode,
    runLayout,
    setNodeText,
} from "./commands";
import {
    activePage,
    graphDescendants,
    graphIndex,
    insertEdgesBeside,
    isMindmapPage,
    isTopicShape,
    mapNodes,
    nodeById,
    topicParent,
} from "./doc";
import { createEdge, createNode } from "./factory";
import { parseOutline, topicSize, type OutlineNode } from "./generate";
import { layeredLayout, type LayeredDirection } from "./layered";
import { sizeForLabel } from "./mermaid";
import { nonEmpty } from "./strings";
import { themeMode } from "./palette";
import { paintTopics } from "./theme";
import { EditorStore } from "./store";
import type { DiagramEdge, DiagramNode, DiagramPage, MindmapDoc, ShapeId } from "./types";

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Lines of description past which the rest is summarised. */
const DESCRIBE_LINE_LIMIT = 400;

/** What sort of page a model is looking at: a topic tree or a flowchart-like graph. */
export function pageStyle(page: DiagramPage): "topics" | "shapes" {
    return isMindmapPage(page) ? "topics" : "shapes";
}

function label(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat || "(no text)";
}

/**
 * The active page as text, every shape's id beside it — `(id: n_…)`, never
 * in square brackets, which the chat reads as a citation. Topic pages read as an outline
 * (first parent wins, as in the layout) with any cross-links listed after;
 * other pages list their shapes, frames and arrows.
 */
export function describeDiagram(doc: MindmapDoc): string {
    const page = activePage(doc);
    const lines: string[] = [];
    const otherPages = doc.pages.filter(p => p.id !== page.id).map(p => `"${p.name}"`);
    lines.push(
        `Page "${page.name}"${otherPages.length ? ` (other pages: ${otherPages.join(", ")}; edits apply to this page)` : ""}.`
    );
    if (page.nodes.length === 0) {
        lines.push("The page is empty.");
        return lines.join("\n");
    }

    const byId = new Map(page.nodes.map(n => [n.id, n]));
    const idx = graphIndex(page);

    if (pageStyle(page) === "topics") {
        const treeEdges = new Set<string>();
        const roots = page.nodes.filter(
            n => isTopicShape(n.shape) && topicParent(page, n.id, idx) === null
        );
        const printed = new Set<string>();
        const walk = (id: string, depth: number) => {
            if (printed.has(id) || lines.length > DESCRIBE_LINE_LIMIT) return;
            printed.add(id);
            const nd = byId.get(id)!;
            lines.push(
                `${"  ".repeat(depth)}- ${label(nd.text)} (id: ${id})${nd.collapsed ? " (collapsed)" : ""}`
            );
            for (const e of page.edges) {
                if (e.from.nodeId !== id || !e.to.nodeId) continue;
                const child = byId.get(e.to.nodeId);
                if (!child || !isTopicShape(child.shape)) continue;
                if (topicParent(page, child.id, idx) !== id) continue;
                treeEdges.add(e.id);
                walk(child.id, depth + 1);
            }
        };
        lines.push("Topics (each line is a topic; indentation is the tree):");
        for (const root of roots) walk(root.id, 0);
        const links = page.edges.filter(e => !treeEdges.has(e.id) && e.from.nodeId && e.to.nodeId);
        if (links.length > 0) {
            lines.push("Cross-links (not part of the tree):");
            for (const e of links) lines.push(`- ${edgeLine(e, byId)}`);
        }
        const loose = page.nodes.filter(n => !isTopicShape(n.shape));
        if (loose.length > 0) {
            lines.push("Notes on the page:");
            for (const n of loose) lines.push(`- ${n.shape}: ${label(n.text)} (id: ${n.id})`);
        }
    } else {
        const frames = page.nodes.filter(n => isContainer(n.shape));
        const shapes = page.nodes.filter(n => !isContainer(n.shape));
        lines.push("Shapes:");
        for (const n of shapes) {
            if (lines.length > DESCRIBE_LINE_LIMIT) break;
            const frame = n.parentId ? byId.get(n.parentId) : undefined;
            lines.push(
                `- ${n.shape}: ${label(n.text)} (id: ${n.id})${frame ? `, in the frame "${label(frame.text)}" (id: ${frame.id})` : ""}`
            );
        }
        if (frames.length > 0) {
            lines.push("Frames (groups drawn around shapes):");
            for (const n of frames) lines.push(`- ${label(n.text)} (id: ${n.id})`);
        }
        const arrows = page.edges.filter(e => e.from.nodeId && e.to.nodeId);
        if (arrows.length > 0) {
            lines.push("Arrows:");
            for (const e of arrows) {
                if (lines.length > DESCRIBE_LINE_LIMIT) break;
                lines.push(`- ${edgeLine(e, byId)}`);
            }
        }
    }
    if (lines.length > DESCRIBE_LINE_LIMIT) {
        lines.length = DESCRIBE_LINE_LIMIT;
        lines.push("… (the rest of the page is left out; it is too large to list in full)");
    }
    return lines.join("\n");
}

function edgeLine(e: DiagramEdge, byId: ReadonlyMap<string, DiagramNode>): string {
    const a = byId.get(e.from.nodeId ?? "");
    const b = byId.get(e.to.nodeId ?? "");
    const text = e.labels
        .map(l => l.text)
        .filter(Boolean)
        .join(" / ");
    const arrow =
        e.endArrow === "none" && e.startArrow === "none"
            ? "—"
            : e.startArrow !== "none" && e.endArrow !== "none"
              ? "↔"
              : "→";
    return `${a ? label(a.text) : "?"} (id: ${a?.id ?? "?"}) ${arrow} ${b ? label(b.text) : "?"} (id: ${b?.id ?? "?"})${text ? `, labelled "${text}"` : ""}`;
}

function isContainer(shape: ShapeId): boolean {
    return (
        shape === "frame" || shape === "group" || shape === "swimlane-h" || shape === "swimlane-v"
    );
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * The version-history entry that keeps a diagram as it was before an AI
 * changed it. Stored as this fixed text and worded for the reader by the
 * History panel, like its other system labels.
 */
export const AI_EDIT_SNAPSHOT_LABEL = "Before an AI edit";

/** Flowchart shapes a model may ask for by name. */
export const FLOW_SHAPES = [
    "process",
    "decision",
    "terminator",
    "data",
    "database",
    "document",
    "sticky",
] as const;
export type FlowShape = (typeof FLOW_SHAPES)[number];

export type DiagramEdit =
    | {
          op: "add";
          /** The topic or shape it hangs from; on a flowchart, the arrow comes from it. */
          under?: string;
          /** Its label. On a topic page, an indented outline adds a whole branch. */
          text: string;
          /** Place it right after this sibling instead of last. */
          after?: string;
          /** Flowcharts: what it is. Default process. */
          shape?: FlowShape;
          /** Flowcharts: the arrow's label, e.g. "yes". */
          label?: string;
          /** A name later edits in the same call can use for it. */
          ref?: string;
      }
    | { op: "rename"; node: string; text: string }
    | { op: "remove"; node: string; keep_children?: boolean }
    | { op: "move"; node: string; under: string; after?: string }
    | { op: "connect"; from: string; to: string; label?: string }
    | { op: "disconnect"; from: string; to: string }
    | { op: "arrange" };

export const DIAGRAM_EDIT_OPS = [
    "add",
    "rename",
    "remove",
    "move",
    "connect",
    "disconnect",
    "arrange",
] as const;

/** Most operations one call may carry. */
export const MAX_EDITS = 60;

/** A failed operation; the message is written for the model that sent it. */
export class DiagramEditError extends Error {
    constructor(
        message: string,
        /** Which operation (0-based) failed. */
        readonly index: number
    ) {
        super(message);
        this.name = "DiagramEditError";
    }
}

export interface EditOutcome {
    /** One line per operation, said back to the model. */
    applied: string[];
    /** Ids of every shape the edits made, in order. */
    added: string[];
}

/**
 * Run `edits` against a copy of `doc`'s active page. All or nothing: an
 * operation that cannot apply throws {@link DiagramEditError} and `doc` is
 * untouched. Pure — the server saves what it returns.
 */
export function runDiagramEdits(
    doc: MindmapDoc,
    edits: readonly DiagramEdit[]
): { doc: MindmapDoc } & EditOutcome {
    if (edits.length === 0) throw new DiagramEditError("No edits were given.", 0);
    if (edits.length > MAX_EDITS) {
        throw new DiagramEditError(
            `At most ${MAX_EDITS} edits per call; split the change.`,
            MAX_EDITS
        );
    }
    const scratch = new EditorStore(doc);
    const applied: string[] = [];
    const added: string[] = [];
    const refs = new Map<string, string>();
    scratch.group("AI edit", () => {
        edits.forEach((edit, index) => {
            applied.push(applyOne(scratch, edit, index, refs, added));
        });
        settle(scratch);
    });
    return { doc: scratch.getState().doc, applied, added };
}

/**
 * The same, on a live editor: the result lands as one undo entry, so ⌘Z
 * takes the whole change back, and autosave writes it like any edit.
 */
export function applyDiagramEdits(
    store: EditorStore,
    edits: readonly DiagramEdit[],
    options: { label?: string } = {}
): EditOutcome {
    const { doc, applied, added } = runDiagramEdits(store.getState().doc, edits);
    store.replaceDoc(doc, { label: options.label ?? "AI edit" });
    return { applied, added };
}

function page(store: EditorStore): DiagramPage {
    return activePage(store.getState().doc);
}

/** An id as a model may write it: `n_ab12`, `[n_ab12]`, a ref from this call, or a unique label. */
function resolve(
    store: EditorStore,
    raw: string | undefined,
    refs: ReadonlyMap<string, string>,
    index: number,
    what: string
): DiagramNode {
    const p = page(store);
    // "n_ab12", "[n_ab12]", "(id: n_ab12)" and "id: n_ab12" all name it.
    const given = (raw ?? "")
        .trim()
        .replace(/^\[(.*)\]$/, "$1")
        .replace(/^\(?\s*id:\s*([^)\s]+)\s*\)?$/i, "$1")
        .trim();
    if (!given) throw new DiagramEditError(`Edit ${index + 1}: "${what}" is missing.`, index);
    const id = refs.get(given) ?? given;
    const direct = nodeById(p, id);
    if (direct) return direct;
    const byLabel = p.nodes.filter(n => n.text.trim().toLowerCase() === given.toLowerCase());
    if (byLabel.length === 1) return byLabel[0]!;
    throw new DiagramEditError(
        byLabel.length > 1
            ? `Edit ${index + 1}: "${given}" matches ${byLabel.length} shapes; use its id from read_diagram.`
            : `Edit ${index + 1}: no shape "${given}" on this page. Use an id read_diagram shows (id: n_…), or a ref an earlier add in this call gave.`,
        index
    );
}

/** `resolve` for an optional hint: null instead of an error when it names nothing. */
function tryResolve(
    store: EditorStore,
    raw: string,
    refs: ReadonlyMap<string, string>
): DiagramNode | null {
    try {
        return resolve(store, raw, refs, 0, "after");
    } catch {
        return null;
    }
}

function applyOne(
    store: EditorStore,
    edit: DiagramEdit,
    index: number,
    refs: Map<string, string>,
    added: string[]
): string {
    switch (edit.op) {
        case "add":
            return addEdit(store, edit, index, refs, added);
        case "rename": {
            const nd = resolve(store, edit.node, refs, index, "node");
            const text = edit.text.trim();
            if (!text) throw new DiagramEditError(`Edit ${index + 1}: rename needs text.`, index);
            setNodeText(store, nd.id, text);
            growToLabel(store, nd.id);
            return `Renamed ${nd.id} to "${text}".`;
        }
        case "remove":
            return removeEdit(store, edit, index, refs);
        case "move":
            return moveEdit(store, edit, index, refs);
        case "connect": {
            const from = resolve(store, edit.from, refs, index, "from");
            const to = resolve(store, edit.to, refs, index, "to");
            if (from.id === to.id)
                throw new DiagramEditError(
                    `Edit ${index + 1}: a shape cannot connect to itself.`,
                    index
                );
            const topics = pageStyle(page(store)) === "topics";
            const kind = topics
                ? "curved"
                : (page(store).edges[0]?.kind ?? store.getState().doc.settings.defaultEdgeKind);
            insertEdge(
                store,
                createEdge({
                    from: { nodeId: from.id, port: "auto" },
                    to: { nodeId: to.id, port: "auto" },
                    kind,
                    label: nonEmpty(edit.label),
                    // A link across a mind map is a relation, not a branch: dashed, so it reads as one.
                    style: topics ? { strokeStyle: "dashed" } : undefined,
                    endArrow: "arrow",
                }),
                "Connect"
            );
            return `Connected ${from.id} → ${to.id}${edit.label ? ` ("${edit.label.trim()}")` : ""}.`;
        }
        case "disconnect": {
            const from = resolve(store, edit.from, refs, index, "from");
            const to = resolve(store, edit.to, refs, index, "to");
            const p = page(store);
            const matching = p.edges.filter(
                e =>
                    (e.from.nodeId === from.id && e.to.nodeId === to.id) ||
                    (e.from.nodeId === to.id && e.to.nodeId === from.id)
            );
            if (matching.length === 0) {
                throw new DiagramEditError(
                    `Edit ${index + 1}: ${from.id} and ${to.id} are not connected.`,
                    index
                );
            }
            const treeLink = matching.some(
                e =>
                    isTopicShape(nodeById(p, e.to.nodeId ?? "")?.shape ?? "rectangle") &&
                    topicParent(p, e.to.nodeId!) === e.from.nodeId
            );
            if (treeLink) {
                throw new DiagramEditError(
                    `Edit ${index + 1}: that line is a branch of the tree; disconnecting it would leave a topic floating. Use move or remove instead.`,
                    index
                );
            }
            store.setSelection(matching.map(e => ({ kind: "edge" as const, id: e.id })));
            deleteSelection(store);
            return `Disconnected ${from.id} and ${to.id}.`;
        }
        case "arrange":
            arrange(store);
            return "Arranged the page.";
        default: {
            const op = (edit as { op?: unknown }).op;
            throw new DiagramEditError(
                `Edit ${index + 1}: unknown op "${String(op)}". Use one of: ${DIAGRAM_EDIT_OPS.join(", ")}.`,
                index
            );
        }
    }
}

// -- add ----------------------------------------------------------------------

function addEdit(
    store: EditorStore,
    edit: Extract<DiagramEdit, { op: "add" }>,
    index: number,
    refs: Map<string, string>,
    added: string[]
): string {
    const text = edit.text?.trim() ?? "";
    if (!text) throw new DiagramEditError(`Edit ${index + 1}: add needs text.`, index);
    const parent = edit.under ? resolve(store, edit.under, refs, index, "under") : null;
    const topics = parent ? isTopicShape(parent.shape) : pageStyle(page(store)) === "topics";

    if (topics) {
        if (!parent) {
            throw new DiagramEditError(
                `Edit ${index + 1}: on a mind map, say which topic to add under (under).`,
                index
            );
        }
        // Where among its siblings is a hint: one that names nothing on the
        // page puts the topic last rather than failing the whole edit.
        const after = edit.after ? tryResolve(store, edit.after, refs)?.id : undefined;
        const outline = text.includes("\n") || /^\s*([-*+•]|\d+[.)])\s/.test(text);
        const roots = outline ? parseOutline(text) : [{ text, children: [] } as OutlineNode];
        if (roots.length === 0)
            throw new DiagramEditError(`Edit ${index + 1}: add had no topic text.`, index);
        let anchor = after;
        const made: string[] = [];
        for (const root of roots) {
            const id = addTopicBranch(store, parent.id, root, anchor);
            if (!id)
                throw new DiagramEditError(
                    `Edit ${index + 1}: could not add under ${parent.id}.`,
                    index
                );
            made.push(id);
            anchor = id;
        }
        if (edit.ref && made[0]) refs.set(edit.ref.trim(), made[0]);
        added.push(...made);
        const count = made.length + roots.reduce((n, r) => n + countDescendants(r), 0);
        return `Added ${count === 1 ? `topic ${made[0]} "${roots[0]!.text}"` : `${count} topics (first ${made[0]})`} under ${parent.id}.`;
    }

    // A box on a flowchart: sized to its label, placed past its parent in the
    // direction the chart flows, with an arrow from the parent.
    const shape: ShapeId =
        edit.shape && (FLOW_SHAPES as readonly string[]).includes(edit.shape)
            ? edit.shape
            : "process";
    const doc = store.getState().doc;
    const mode = themeMode(doc.settings.paletteId);
    const probe = createNode({
        shape,
        x: 0,
        y: 0,
        text,
        mode,
        textStyle: shape === "sticky" ? {} : { size: 14 },
    });
    const size =
        shape === "sticky" ? { w: 180, h: 120 } : sizeForLabel(shape, text, probe.textStyle);
    const at = placeNear(page(store), parent, size);
    const node: DiagramNode = styledLike({ ...probe, ...at, ...size }, parent);
    insertNode(store, node, "Add shape");
    if (parent) {
        const kind = page(store).edges[0]?.kind ?? doc.settings.defaultEdgeKind;
        insertEdge(
            store,
            createEdge({
                from: { nodeId: parent.id, port: "auto" },
                to: { nodeId: node.id, port: "auto" },
                kind,
                label: nonEmpty(edit.label),
            }),
            "Connect"
        );
    }
    if (edit.ref) refs.set(edit.ref.trim(), node.id);
    added.push(node.id);
    return `Added ${shape} ${node.id} "${text}"${parent ? ` after ${parent.id}` : ""}.`;
}

/**
 * Grow a shape so its label fits — never shrink it. A topic Tab made keeps
 * its depth's size until its words need more; a long label gets a taller
 * box rather than spilling out of it.
 */
function growToLabel(store: EditorStore, id: string): void {
    const nd = nodeById(page(store), id);
    if (!nd?.text.trim()) return;
    const size = isTopicShape(nd.shape)
        ? topicSize(nd.shape, nd.data?.depth ?? 2, nd.text, nd.textStyle)
        : sizeForLabel(nd.shape, nd.text, nd.textStyle);
    if (size.w <= nd.w && size.h <= nd.h) return;
    store.updatePage(
        p => mapNodes(p, [id], n => ({ ...n, w: Math.max(n.w, size.w), h: Math.max(n.h, size.h) })),
        { label: "Fit to text" }
    );
}

function countDescendants(node: OutlineNode): number {
    return node.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}

/** A topic and its subtree, made the way Tab makes them. Returns the topic's id. */
function addTopicBranch(
    store: EditorStore,
    parentId: string,
    outline: OutlineNode,
    after?: string
): string | null {
    const id = addChildTopic(store, parentId, after ? { after } : {});
    if (!id) return null;
    setNodeText(store, id, outline.text);
    growToLabel(store, id);
    let anchor: string | undefined;
    for (const child of outline.children) {
        const childId = addTopicBranch(store, id, child, anchor);
        if (childId) anchor = childId;
    }
    return id;
}

/**
 * A new box looks like the box it follows — a step after a blue step is
 * blue — and otherwise like a shape dropped from the palette onto this
 * board, in the board's lighting.
 */
function styledLike(node: DiagramNode, parent: DiagramNode | null): DiagramNode {
    if (
        !parent ||
        isContainer(parent.shape) ||
        parent.shape === "sticky" ||
        node.shape === "sticky"
    )
        return node;
    if (parent.style.fill === "none") return node;
    return {
        ...node,
        style: { ...node.style, fill: parent.style.fill, stroke: parent.style.stroke },
        textStyle: { ...node.textStyle, color: parent.textStyle.color },
    };
}

/**
 * Which way a page's arrows mostly run: each arrow votes for the way it
 * points most, so one box dragged far off does not turn the whole chart.
 */
function flowDirection(p: DiagramPage): LayeredDirection {
    const votes: Record<LayeredDirection, number> = { down: 0, up: 0, right: 0, left: 0 };
    for (const e of p.edges) {
        const a = nodeById(p, e.from.nodeId ?? "");
        const b = nodeById(p, e.to.nodeId ?? "");
        if (!a || !b) continue;
        const dx = b.x + b.w / 2 - (a.x + a.w / 2);
        const dy = b.y + b.h / 2 - (a.y + a.h / 2);
        if (Math.abs(dx) > Math.abs(dy)) votes[dx >= 0 ? "right" : "left"] += 1;
        else votes[dy >= 0 ? "down" : "up"] += 1;
    }
    const order: LayeredDirection[] = ["down", "right", "up", "left"];
    return order.reduce((best, dir) => (votes[dir] > votes[best] ? dir : best), "down");
}

/** The first free spot past `parent` along the flow, stepping sideways; right of everything without one. */
function placeNear(
    p: DiagramPage,
    parent: DiagramNode | null,
    size: { w: number; h: number }
): { x: number; y: number } {
    const overlaps = (x: number, y: number) =>
        p.nodes.some(
            n =>
                !isContainer(n.shape) &&
                x < n.x + n.w + 24 &&
                x + size.w + 24 > n.x &&
                y < n.y + n.h + 24 &&
                y + size.h + 24 > n.y
        );
    if (!parent) {
        const right = p.nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
        const top = p.nodes.reduce((m, n) => Math.min(m, n.y), Infinity);
        return { x: right + 80, y: Number.isFinite(top) ? top : 0 };
    }
    const dir = flowDirection(p);
    const cx = parent.x + parent.w / 2 - size.w / 2;
    const cy = parent.y + parent.h / 2 - size.h / 2;
    const start =
        dir === "down"
            ? { x: cx, y: parent.y + parent.h + 64 }
            : dir === "up"
              ? { x: cx, y: parent.y - 64 - size.h }
              : dir === "right"
                ? { x: parent.x + parent.w + 80, y: cy }
                : { x: parent.x - 80 - size.w, y: cy };
    const step =
        dir === "down" || dir === "up" ? { x: size.w + 40, y: 0 } : { x: 0, y: size.h + 32 };
    for (let k = 0; k < 40; k += 1) {
        // 0, +1, -1, +2, -2 … steps sideways.
        const n = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -(k / 2);
        const x = start.x + step.x * n;
        const y = start.y + step.y * n;
        if (!overlaps(x, y)) return { x, y };
    }
    return start;
}

// -- remove -------------------------------------------------------------------

function removeEdit(
    store: EditorStore,
    edit: Extract<DiagramEdit, { op: "remove" }>,
    index: number,
    refs: ReadonlyMap<string, string>
): string {
    const nd = resolve(store, edit.node, refs, index, "node");
    const p = page(store);
    if (isTopicShape(nd.shape)) {
        if (topicParent(p, nd.id) === null && (graphIndex(p).out.get(nd.id) ?? []).length > 0) {
            throw new DiagramEditError(
                `Edit ${index + 1}: ${nd.id} is the central topic; removing it would take the whole map. Rename it instead.`,
                index
            );
        }
        store.selectNodes([nd.id]);
        deleteTopicsOrSelection(store, { keepChildren: edit.keep_children === true });
        return edit.keep_children
            ? `Removed ${nd.id} "${label(nd.text)}"; its subtopics moved up a level.`
            : `Removed ${nd.id} "${label(nd.text)}" with its subtopics.`;
    }
    if (isContainer(nd.shape)) {
        // A frame goes alone: what it held stays on the page.
        store.updatePage(
            q => ({
                ...mapNodes(
                    q,
                    q.nodes.filter(n => n.parentId === nd.id).map(n => n.id),
                    n => ({ ...n, parentId: nd.parentId })
                ),
            }),
            { label: "Ungroup" }
        );
        store.selectNodes([nd.id]);
        deleteSelection(store);
        return `Removed the frame ${nd.id} "${label(nd.text)}"; the shapes in it stay.`;
    }
    if (edit.keep_children) {
        deleteNodeReconnecting(store, nd.id);
        return `Removed ${nd.id} "${label(nd.text)}" and joined what came before it to what came after.`;
    }
    store.selectNodes([nd.id]);
    deleteSelection(store);
    return `Removed ${nd.id} "${label(nd.text)}" and its arrows.`;
}

// -- move ---------------------------------------------------------------------

function moveEdit(
    store: EditorStore,
    edit: Extract<DiagramEdit, { op: "move" }>,
    index: number,
    refs: ReadonlyMap<string, string>
): string {
    const nd = resolve(store, edit.node, refs, index, "node");
    const target = resolve(store, edit.under, refs, index, "under");
    if (!isTopicShape(nd.shape) || !isTopicShape(target.shape)) {
        throw new DiagramEditError(
            `Edit ${index + 1}: move re-files a topic under another topic. On a flowchart, use connect and disconnect.`,
            index
        );
    }
    const p = page(store);
    if (nd.id === target.id || graphDescendants(p, nd.id).has(target.id)) {
        throw new DiagramEditError(
            `Edit ${index + 1}: ${nd.id} cannot go under itself or its own subtopic.`,
            index
        );
    }
    const oldParent = topicParent(p, nd.id);
    if (oldParent === null) {
        throw new DiagramEditError(
            `Edit ${index + 1}: ${nd.id} is a central topic and cannot be moved under another.`,
            index
        );
    }
    const after = edit.after ? tryResolve(store, edit.after, refs)?.id : undefined;
    const paletteId = store.getState().doc.settings.paletteId;
    store.updatePage(
        q => {
            const old = q.edges.find(e => e.from.nodeId === oldParent && e.to.nodeId === nd.id);
            const kept = old ? { ...q, edges: q.edges.filter(e => e.id !== old.id) } : q;
            const anchor = after
                ? kept.edges.find(e => e.from.nodeId === target.id && e.to.nodeId === after)
                : undefined;
            const edge = createEdge({
                from: { nodeId: target.id, port: "auto" },
                to: { nodeId: nd.id, port: "auto" },
                kind: old?.kind ?? "curved",
                endArrow: "none",
            });
            const moved = insertEdgesBeside(kept, [edge], anchor?.id, "after");
            // It takes the depth and branch it now has: size, weight and hue.
            return paintTopics(moved, [nd.id], paletteId, { retype: true });
        },
        { label: "Move topic" }
    );
    return `Moved ${nd.id} "${label(nd.text)}" under ${target.id}.`;
}

// -- arrange ------------------------------------------------------------------

/** Re-run the page's layout: the map's own arrangement, or layers for a flowchart. */
function arrange(store: EditorStore): void {
    const p = page(store);
    const doc = store.getState().doc;
    if (pageStyle(p) === "topics") {
        store.clearSelection();
        runLayout(store, doc.settings.autoLayout ?? { kind: "mindmap" }, { label: "Arrange" });
        return;
    }
    const containers = new Set(p.nodes.filter(n => isContainer(n.shape)).map(n => n.id));
    const boxes = p.nodes.filter(n => !containers.has(n.id));
    const membership = new Map<string, string[]>();
    for (const n of boxes) {
        const path: string[] = [];
        let cur = n.parentId;
        while (cur && containers.has(cur) && path.length < 16) {
            path.unshift(cur);
            cur = nodeById(p, cur)?.parentId ?? null;
        }
        if (path.length > 0) membership.set(n.id, path);
    }
    const laid = layeredLayout(
        boxes.map(n => ({ id: n.id, w: n.w, h: n.h })),
        p.edges.flatMap(e =>
            e.from.nodeId && e.to.nodeId ? [{ from: e.from.nodeId, to: e.to.nodeId }] : []
        ),
        { direction: flowDirection(p), clusters: membership }
    );
    store.updatePage(
        q => ({
            ...q,
            nodes: q.nodes.map(n => {
                const frame = laid.clusters.get(n.id);
                if (frame) return { ...n, ...frame };
                const pos = laid.positions.get(n.id);
                return pos ? { ...n, x: pos.x, y: pos.y } : n;
            }),
            edges: q.edges.map(e => (e.waypoints.length ? { ...e, waypoints: [] } : e)),
        }),
        { label: "Arrange" }
    );
}

/** After the edits: a self-arranging map is tidied once, now that every label has its size. */
function settle(store: EditorStore): void {
    const doc = store.getState().doc;
    const layout = doc.settings.autoLayout;
    if (!layout || !isMindmapPage(activePage(doc))) return;
    store.clearSelection();
    runLayout(store, layout, { label: "Arrange", transient: true });
}

// ---------------------------------------------------------------------------
// Context for suggestions
// ---------------------------------------------------------------------------

export interface TopicContext {
    /** The map's centre down to the topic, as labels. */
    path: string[];
    /** The topic's subtopics already there. */
    existing: string[];
    /** The other main branches, for staying in this one's lane. */
    siblings: string[];
}

/** Where a topic sits, in words — what "Expand with AI" sends instead of the document. */
export function topicContext(p: DiagramPage, nodeId: string): TopicContext | null {
    const nd = nodeById(p, nodeId);
    if (!nd || !isTopicShape(nd.shape)) return null;
    const idx = graphIndex(p);
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = nodeId;
    while (cur && !seen.has(cur) && chain.length < 12) {
        seen.add(cur);
        chain.unshift(cur);
        cur = topicParent(p, cur, idx);
    }
    const words = (id: string) => label(nodeById(p, id)?.text ?? "");
    const childrenOf = (id: string) =>
        (idx.out.get(id) ?? []).filter(child => {
            const c = nodeById(p, child);
            return c !== undefined && isTopicShape(c.shape) && topicParent(p, child, idx) === id;
        });
    const root = chain[0]!;
    const branch = chain[1];
    return {
        path: chain.map(words),
        existing: childrenOf(nodeId).map(words),
        siblings: childrenOf(root)
            .filter(id => id !== branch && id !== nodeId)
            .map(words),
    };
}
