/**
 * Mermaid flowcharts → documents.
 *
 * Mermaid is how a README carries a diagram and the notation language models
 * write flowcharts in, so it is the way into the editor for both: the Import
 * dialog's Mermaid tab and the AI tools (`generate.ts`) both land here.
 *
 * The parser covers the flowchart grammar people actually use: `flowchart`/
 * `graph` with a direction, every bracket shape, quoted and `<br>` labels,
 * chains (`A --> B --> C`), `&` fan-outs, all link styles with either label
 * form (`-->|yes|` and `-- yes -->`), and `subgraph … end` blocks, nested.
 * Styling directives (`classDef`, `style`, `click`, …) are skipped rather
 * than rejected: the document's theme paints the result.
 *
 * Placement is the layered layout (`layered.ts`) in the direction the source
 * names, and every subgraph becomes a frame its members are filed inside
 * (`parentId`), so moving the frame moves them.
 */

import { createDoc, createEdge, createNode, createPage, defaultTextStyle } from "./factory";
import { layeredLayout, type LayeredDirection } from "./layered";
import { layoutText } from "./text";
import { shapeTextBox } from "./shapes";
import type {
    ArrowId,
    DiagramEdge,
    DiagramNode,
    MindmapDoc,
    ShapeId,
    StrokeStyle,
    TextStyle,
} from "./types";

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface MermaidNode {
    key: string;
    label: string;
    shape: ShapeId;
    /** The subgraphs it sits in, outermost first. */
    clusters: string[];
}

export interface MermaidEdge {
    from: string;
    to: string;
    label?: string;
    startArrow: ArrowId;
    endArrow: ArrowId;
    stroke: "solid" | "dashed" | "thick";
}

export interface MermaidCluster {
    key: string;
    title: string;
    /** The subgraph it sits in, or null at the top level. */
    parent: string | null;
}

export interface MermaidGraph {
    direction: LayeredDirection;
    nodes: MermaidNode[];
    edges: MermaidEdge[];
    clusters: MermaidCluster[];
}

const DIRECTIONS: Record<string, LayeredDirection> = {
    TB: "down",
    TD: "down",
    BT: "up",
    LR: "right",
    RL: "left",
};

const SKIPPED = /^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction|%%)\b/;

/** Shape brackets, longest opener first so `([` is never read as `(`. */
const BRACKETS: ReadonlyArray<{ open: string; close: readonly string[]; shape: ShapeId }> = [
    { open: "(((", close: [")))"], shape: "circle" },
    { open: "([", close: ["])"], shape: "terminator" },
    { open: "[[", close: ["]]"], shape: "predefined-process" },
    { open: "[(", close: [")]"], shape: "database" },
    { open: "((", close: ["))"], shape: "circle" },
    { open: "{{", close: ["}}"], shape: "preparation" },
    { open: "[/", close: ["/]", "\\]"], shape: "data" },
    { open: "[\\", close: ["\\]", "/]"], shape: "manual-operation" },
    { open: ">", close: ["]"], shape: "off-page-connector" },
    { open: "[", close: ["]"], shape: "process" },
    { open: "(", close: [")"], shape: "rounded-rectangle" },
    { open: "{", close: ["}"], shape: "decision" },
];

/** A node id: letters, digits, `_`, and single hyphens inside (`my-step`), never `--`. */
const ID = /^[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/u;

/** Parse a Mermaid flowchart. Never throws: what it cannot read, it leaves out. */
export function parseMermaidFlowchart(text: string): MermaidGraph {
    const graph: MermaidGraph = { direction: "down", nodes: [], edges: [], clusters: [] };
    const nodes = new Map<string, MermaidNode>();
    const clusterKeys = new Set<string>();
    const stack: string[] = [];
    let anonymous = 0;

    const touch = (key: string, label?: string, shape?: ShapeId): MermaidNode => {
        const existing = nodes.get(key);
        if (existing) {
            // A later definition with a label is the one Mermaid draws.
            if (label !== undefined) existing.label = label;
            if (shape) existing.shape = shape;
            // Listing a node inside a subgraph files it there, wherever it
            // was first mentioned — as Mermaid does.
            if (stack.length > 0) existing.clusters = [...stack];
            return existing;
        }
        const node: MermaidNode = {
            key,
            label: label ?? key,
            shape: shape ?? "process",
            clusters: [...stack],
        };
        nodes.set(key, node);
        graph.nodes.push(node);
        return node;
    };

    for (const statement of statements(text)) {
        const header = /^(flowchart|graph)\b\s*([A-Za-z]{2})?/i.exec(statement);
        if (header) {
            const dir = DIRECTIONS[(header[2] ?? "").toUpperCase()];
            if (dir) graph.direction = dir;
            continue;
        }
        const sub = /^subgraph\b\s*(.*)$/i.exec(statement);
        if (sub) {
            const { key, title } = subgraphName(sub[1] ?? "", () => `subgraph${++anonymous}`);
            if (!clusterKeys.has(key)) {
                clusterKeys.add(key);
                graph.clusters.push({ key, title, parent: stack[stack.length - 1] ?? null });
            }
            stack.push(key);
            continue;
        }
        if (/^end\b/i.test(statement)) {
            stack.pop();
            continue;
        }
        if (SKIPPED.test(statement)) continue;
        readChain(statement, touch, graph.edges);
    }

    // An edge may end on a subgraph; one that names neither is dropped.
    graph.edges = graph.edges.filter(
        e =>
            (nodes.has(e.from) || clusterKeys.has(e.from)) &&
            (nodes.has(e.to) || clusterKeys.has(e.to))
    );
    // A node created by an edge to a subgraph's key is the subgraph, not a box.
    graph.nodes = graph.nodes.filter(n => !(clusterKeys.has(n.key) && n.label === n.key));
    return graph;
}

/** Lines and `;`-separated statements, comments dropped, quotes respected. */
function statements(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
        const line = raw.replace(/%%.*$/, "").trim();
        if (!line || line.startsWith("```")) continue;
        let current = "";
        let quoted = false;
        for (const ch of line) {
            if (ch === '"') quoted = !quoted;
            if (ch === ";" && !quoted) {
                if (current.trim()) out.push(current.trim());
                current = "";
            } else current += ch;
        }
        if (current.trim()) out.push(current.trim());
    }
    return out;
}

function subgraphName(rest: string, fresh: () => string): { key: string; title: string } {
    const trimmed = rest.trim();
    if (!trimmed) {
        const key = fresh();
        return { key, title: "" };
    }
    const quoted = /^"([^"]*)"$/.exec(trimmed);
    if (quoted) return { key: fresh(), title: cleanLabel(quoted[1] ?? "") };
    const bracketed = /^([^\s[]+)\s*\[\s*"?([^"\]]*)"?\s*\]$/.exec(trimmed);
    if (bracketed) return { key: bracketed[1]!, title: cleanLabel(bracketed[2] ?? "") };
    // `subgraph Payment flow`: the words are both its id and its title.
    return { key: trimmed, title: cleanLabel(trimmed) };
}

/** Mermaid's label escapes and line breaks, read as plain text. */
function cleanLabel(raw: string): string {
    return raw
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/#quot;/g, '"')
        .replace(/#amp;/g, "&")
        .replace(/#lt;/g, "<")
        .replace(/#gt;/g, ">")
        .replace(/^`|`$/g, "")
        .replace(/<\/?(b|i|em|strong|u|small|span)[^>]*>/gi, "")
        .replace(/[ \t]+/g, " ")
        .split("\n")
        .map(l => l.trim())
        .join("\n")
        .trim();
}

type Touch = (key: string, label?: string, shape?: ShapeId) => MermaidNode;

/** `A & B -->|x| C --> D[Done]`: every node, and an edge for every link. */
function readChain(statement: string, touch: Touch, edges: MermaidEdge[]): void {
    let at = 0;
    const group = readGroup(statement, at, touch);
    if (!group) return;
    let left = group.keys;
    at = group.end;
    while (at < statement.length) {
        const link = readLink(statement, at);
        if (!link) return;
        const right = readGroup(statement, link.end, touch);
        if (!right) return;
        for (const from of left) {
            for (const to of right.keys) {
                edges.push({
                    from,
                    to,
                    label: link.label,
                    startArrow: link.startArrow,
                    endArrow: link.endArrow,
                    stroke: link.stroke,
                });
            }
        }
        left = right.keys;
        at = right.end;
    }
}

function readGroup(s: string, start: number, touch: Touch): { keys: string[]; end: number } | null {
    const keys: string[] = [];
    let at = start;
    for (;;) {
        const node = readNode(s, at, touch);
        if (!node) return keys.length > 0 ? { keys, end: at } : null;
        keys.push(node.key);
        at = node.end;
        const amp = /^\s*&\s*/.exec(s.slice(at));
        if (!amp) return { keys, end: at };
        at += amp[0].length;
    }
}

function readNode(s: string, start: number, touch: Touch): { key: string; end: number } | null {
    let at = start;
    while (s[at] === " " || s[at] === "\t") at += 1;
    const id = ID.exec(s.slice(at));
    if (!id) return null;
    const key = id[0];
    at += key.length;

    for (const b of BRACKETS) {
        if (!s.startsWith(b.open, at)) continue;
        const bodyStart = at + b.open.length;
        let label: string | null = null;
        let end = -1;
        const rest = s.slice(bodyStart);
        const quoted = /^\s*"((?:[^"\\]|\\.)*)"\s*/.exec(rest);
        if (quoted) {
            const after = bodyStart + quoted[0].length;
            const close = b.close.find(c => s.startsWith(c, after));
            if (close) {
                label = quoted[1] ?? "";
                end = after + close.length;
            }
        }
        if (end < 0) {
            let best = -1;
            let bestClose = "";
            for (const c of b.close) {
                const i = s.indexOf(c, bodyStart);
                if (i >= 0 && (best < 0 || i < best)) {
                    best = i;
                    bestClose = c;
                }
            }
            if (best < 0) continue;
            label = s.slice(bodyStart, best);
            end = best + bestClose.length;
        }
        // `A>text]` is an asymmetric flag; it only means that after an id.
        touch(key, cleanLabel(label ?? ""), b.shape);
        at = end;
        const cls = /^:::[\w-]+/.exec(s.slice(at));
        if (cls) at += cls[0].length;
        return { key, end: at };
    }

    touch(key);
    const cls = /^:::[\w-]+/.exec(s.slice(at));
    if (cls) at += cls[0].length;
    return { key, end: at };
}

interface Link {
    end: number;
    label?: string;
    startArrow: ArrowId;
    endArrow: ArrowId;
    stroke: MermaidEdge["stroke"];
}

const HEAD: Record<string, ArrowId> = { ">": "arrow", o: "circle", x: "bar" };

function readLink(s: string, start: number): Link | null {
    const rest = s.slice(start);
    const lead = /^\s*/.exec(rest)![0].length;
    let at = start + lead;

    let startArrow: ArrowId = "none";
    const tail = /^([<ox])(?=[-=.])/.exec(s.slice(at));
    if (tail) {
        startArrow = HEAD[tail[1] === "<" ? ">" : tail[1]!] ?? "arrow";
        at += 1;
    }

    // `-- text -->`, `== text ==>`, `-. text .->`
    const inline = /^(--|==|-\.)\s*(?![->=.|\s])([^|]*?)\s*(-{2,}|={2,}|\.+-)([>ox])?/.exec(
        s.slice(at)
    );
    // `-->`, `---`, `==>`, `===`, `-.->`, `-.-`, `--o`, `--x`
    const plain = /^(-{2,}|={2,}|-\.+-)([>ox])?/.exec(s.slice(at));

    let body: string;
    let head: string | undefined;
    let label: string | undefined;
    if (plain && !(inline && plain[0].length <= 2 && !plain[2])) {
        body = plain[1]!;
        head = plain[2];
        at += plain[0].length;
    } else if (inline) {
        body = inline[1]! + inline[3]!;
        head = inline[4];
        label = cleanLabel(inline[2] ?? "") || undefined;
        at += inline[0].length;
    } else {
        return null;
    }

    const pipe = /^\s*\|\s*"?([^|"]*)"?\s*\|/.exec(s.slice(at));
    if (pipe) {
        label = cleanLabel(pipe[1] ?? "") || label;
        at += pipe[0].length;
    }

    const stroke: Link["stroke"] = body.includes(".")
        ? "dashed"
        : body.includes("=")
          ? "thick"
          : "solid";
    return {
        end: at,
        label,
        startArrow,
        endArrow: head ? (HEAD[head] ?? "arrow") : "none",
        stroke,
    };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const LABEL_STYLE: Partial<TextStyle> = { size: 14 };
/** A label wider than this wraps rather than stretching its box; a diamond wraps sooner. */
const MAX_TEXT_WIDTH = 200;
const MAX_DECISION_TEXT_WIDTH = 130;

/** A box that holds its label: grown from the shape's text area, never below a floor. */
export function sizeForLabel(
    shape: ShapeId,
    label: string,
    textStyle: TextStyle
): { w: number; h: number } {
    const floor =
        shape === "decision"
            ? { w: 150, h: 92 }
            : shape === "circle"
              ? { w: 96, h: 96 }
              : shape === "database"
                ? { w: 120, h: 96 }
                : { w: 132, h: 52 };
    const laid = layoutText(
        label || " ",
        textStyle,
        shape === "decision" ? MAX_DECISION_TEXT_WIDTH : MAX_TEXT_WIDTH
    );
    // How much of the box the shape lets text use, measured at the floor size.
    const box = shapeTextBox(shape, floor.w, floor.h);
    const usableW = Math.max(box.w / floor.w, 0.3);
    const usableH = Math.max(box.h / floor.h, 0.3);
    let w = Math.max(floor.w, Math.ceil((laid.width + 28) / usableW));
    let h = Math.max(floor.h, Math.ceil((laid.height + 20) / usableH));
    if (shape === "circle") w = h = Math.max(w, h);
    w = Math.round(w / 2) * 2;
    h = Math.round(h / 2) * 2;
    return { w, h };
}

/**
 * A Mermaid flowchart as a document: boxes sized to their labels, laid out in
 * layers in the source's direction, subgraphs as frames. `pageName` is the
 * page's name in the reader's language.
 */
export function mermaidToDoc(
    text: string,
    title = "Imported diagram",
    pageName = "Page 1"
): MindmapDoc {
    const graph = parseMermaidFlowchart(text);
    const textStyle = defaultTextStyle(LABEL_STYLE);

    const nodeByKey = new Map<string, DiagramNode>();
    for (const n of graph.nodes) {
        const size = sizeForLabel(n.shape, n.label, textStyle);
        nodeByKey.set(
            n.key,
            createNode({
                shape: n.shape,
                x: 0,
                y: 0,
                w: size.w,
                h: size.h,
                text: n.label,
                textStyle: LABEL_STYLE,
            })
        );
    }

    const membership = new Map<string, readonly string[]>();
    for (const n of graph.nodes) {
        if (n.clusters.length > 0) membership.set(nodeByKey.get(n.key)!.id, n.clusters);
    }
    const laid = layeredLayout(
        graph.nodes.map(n => {
            const nd = nodeByKey.get(n.key)!;
            return { id: nd.id, w: nd.w, h: nd.h };
        }),
        graph.edges.flatMap(e => {
            const from = nodeByKey.get(e.from);
            const to = nodeByKey.get(e.to);
            return from && to ? [{ from: from.id, to: to.id }] : [];
        }),
        { direction: graph.direction, clusters: membership }
    );

    // Frames, outermost first so they draw under what they hold.
    const frameByKey = new Map<string, DiagramNode>();
    const depthOf = (key: string): number => {
        let depth = 0;
        let cur = graph.clusters.find(c => c.key === key)?.parent ?? null;
        while (cur && depth < 32) {
            depth += 1;
            cur = graph.clusters.find(c => c.key === cur)?.parent ?? null;
        }
        return depth;
    };
    const ordered = [...graph.clusters].sort((a, b) => depthOf(a.key) - depthOf(b.key));
    for (const c of ordered) {
        const rect = laid.clusters.get(c.key);
        if (!rect) continue;
        frameByKey.set(
            c.key,
            createNode({
                shape: "frame",
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
                text: c.title,
                parentId: c.parent ? (frameByKey.get(c.parent)?.id ?? null) : null,
                textStyle: { bold: true },
            })
        );
    }

    const nodes: DiagramNode[] = [...frameByKey.values()];
    for (const n of graph.nodes) {
        const nd = nodeByKey.get(n.key)!;
        const pos = laid.positions.get(nd.id) ?? { x: 0, y: 0 };
        const inner = n.clusters[n.clusters.length - 1];
        nodes.push({
            ...nd,
            x: pos.x,
            y: pos.y,
            parentId: inner ? (frameByKey.get(inner)?.id ?? null) : null,
        });
    }

    const endpoint = (key: string) => (nodeByKey.get(key) ?? frameByKey.get(key))?.id;
    const edges: DiagramEdge[] = graph.edges.flatMap(e => {
        const from = endpoint(e.from);
        const to = endpoint(e.to);
        if (!from || !to) return [];
        const strokeStyle: StrokeStyle = e.stroke === "dashed" ? "dashed" : "solid";
        return [
            createEdge({
                from: { nodeId: from, port: "auto" },
                to: { nodeId: to, port: "auto" },
                kind: "elbow",
                label: e.label,
                startArrow: e.startArrow,
                endArrow: e.endArrow,
                style: { strokeStyle, ...(e.stroke === "thick" ? { strokeWidth: 3 } : {}) },
            }),
        ];
    });

    const page = createPage(pageName);
    const doc = createDoc(title, [{ ...page, nodes, edges }]);
    return {
        ...doc,
        settings: {
            ...doc.settings,
            kind: "flowchart",
            autoLayout: null,
            defaultEdgeKind: "elbow",
        },
    };
}
