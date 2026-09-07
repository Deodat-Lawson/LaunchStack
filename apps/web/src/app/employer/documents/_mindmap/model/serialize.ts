/**
 * Document (de)serialisation and text-format conversions.
 *
 * `parseDoc` is the trust boundary: everything coming back from `jsonb`, a
 * `.mindmap.json` file or the clipboard passes through it, so a document
 * written by an older build — or by hand — can never put an undefined `style`
 * or a missing page into the editor.
 */

import {
    createDoc,
    createEdge,
    createNode,
    createPage,
    defaultEdgeStyle,
    defaultNodeStyle,
    defaultSettings,
    defaultTextStyle,
    makeId,
} from "./factory";
import { graphIndex } from "./doc";
import { branchSwatch } from "./palette";
import { SHAPE_BY_ID } from "./shapes";
import { nonEmpty, trimmedOr } from "./strings";
import {
    DOC_SCHEMA_VERSION,
    type ArrowId,
    type DiagramEdge,
    type DiagramNode,
    type DiagramPage,
    type DocComment,
    type EdgeKind,
    type MindmapDoc,
    type NodeStyle,
    type Point,
    type ShapeId,
    type TextStyle,
} from "./types";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
    return typeof v === "boolean" ? v : fallback;
}

function point(v: unknown): Point | null {
    if (!isRecord(v)) return null;
    if (typeof v.x !== "number" || typeof v.y !== "number") return null;
    return { x: v.x, y: v.y };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseNodeStyle(v: unknown): NodeStyle {
    const base = defaultNodeStyle();
    if (!isRecord(v)) return base;
    const strokeStyle = str(v.strokeStyle, base.strokeStyle);
    return {
        fill: str(v.fill, base.fill),
        stroke: str(v.stroke, base.stroke),
        strokeWidth: num(v.strokeWidth, base.strokeWidth),
        strokeStyle: strokeStyle === "dashed" || strokeStyle === "dotted" ? strokeStyle : "solid",
        opacity: Math.min(Math.max(num(v.opacity, base.opacity), 0), 1),
        radius: num(v.radius, base.radius),
        shadow: bool(v.shadow, base.shadow),
    };
}

function parseTextStyle(v: unknown): TextStyle {
    const base = defaultTextStyle();
    if (!isRecord(v)) return base;
    const family = str(v.family, base.family);
    const align = str(v.align, base.align);
    const valign = str(v.valign, base.valign);
    return {
        color: str(v.color, base.color),
        size: num(v.size, base.size),
        family: family === "serif" || family === "mono" ? family : "sans",
        bold: bool(v.bold),
        italic: bool(v.italic),
        underline: bool(v.underline),
        strike: bool(v.strike),
        align: align === "left" || align === "right" ? align : "center",
        valign: valign === "top" || valign === "bottom" ? valign : "middle",
        lineHeight: num(v.lineHeight, base.lineHeight),
        ...(bool(v.outside) ? { outside: true } : {}),
    };
}

function parseNode(v: unknown): DiagramNode | null {
    if (!isRecord(v)) return null;
    const id = str(v.id);
    if (!id) return null;
    const shape = str(v.shape, "rectangle");
    return {
        id,
        shape: (SHAPE_BY_ID[shape] ? shape : "rectangle") as ShapeId,
        x: num(v.x, 0),
        y: num(v.y, 0),
        w: Math.max(num(v.w, 160), 1),
        h: Math.max(num(v.h, 90), 1),
        rotation: num(v.rotation, 0),
        text: str(v.text),
        style: parseNodeStyle(v.style),
        textStyle: parseTextStyle(v.textStyle),
        parentId: typeof v.parentId === "string" ? v.parentId : null,
        locked: bool(v.locked),
        hidden: bool(v.hidden),
        ...(bool(v.collapsed) ? { collapsed: true } : {}),
        ...(isRecord(v.data) ? { data: v.data as DiagramNode["data"] } : {}),
    };
}

function parseEndpoint(v: unknown): DiagramEdge["from"] {
    if (!isRecord(v)) return {};
    const out: DiagramEdge["from"] = {};
    if (typeof v.nodeId === "string") out.nodeId = v.nodeId;
    if (typeof v.port === "string") out.port = v.port as DiagramEdge["from"]["port"];
    const p = point(v.point);
    if (p) out.point = p;
    return out;
}

const ARROWS = new Set<string>([
    "none",
    "arrow",
    "arrow-open",
    "triangle-hollow",
    "diamond",
    "diamond-hollow",
    "circle",
    "circle-hollow",
    "bar",
    "crowfoot-one",
    "crowfoot-many",
    "crowfoot-one-many",
    "crowfoot-zero-one",
    "crowfoot-zero-many",
]);

function parseArrow(v: unknown, fallback: ArrowId): ArrowId {
    const s = str(v, fallback);
    return (ARROWS.has(s) ? s : fallback) as ArrowId;
}

function parseEdge(v: unknown): DiagramEdge | null {
    if (!isRecord(v)) return null;
    const id = str(v.id);
    if (!id) return null;
    const kind = str(v.kind, "elbow");
    return {
        id,
        from: parseEndpoint(v.from),
        to: parseEndpoint(v.to),
        kind: (kind === "straight" || kind === "curved" ? kind : "elbow") as EdgeKind,
        waypoints: Array.isArray(v.waypoints)
            ? v.waypoints.map(point).filter((p): p is Point => p !== null)
            : [],
        style: isRecord(v.style)
            ? {
                  ...defaultEdgeStyle(),
                  stroke: str(v.style.stroke, defaultEdgeStyle().stroke),
                  strokeWidth: num(v.style.strokeWidth, 1.8),
                  strokeStyle:
                      v.style.strokeStyle === "dashed" || v.style.strokeStyle === "dotted"
                          ? v.style.strokeStyle
                          : "solid",
                  opacity: Math.min(Math.max(num(v.style.opacity, 1), 0), 1),
              }
            : defaultEdgeStyle(),
        startArrow: parseArrow(v.startArrow, "none"),
        endArrow: parseArrow(v.endArrow, "arrow"),
        labels: Array.isArray(v.labels)
            ? v.labels
                  .filter(isRecord)
                  .map(l => ({ text: str(l.text), t: num(l.t, 0.5), offset: num(l.offset, 0) }))
            : [],
        textStyle: parseTextStyle(v.textStyle),
        locked: bool(v.locked),
        hidden: bool(v.hidden),
    };
}

function parsePage(v: unknown, index: number): DiagramPage {
    const fallback = createPage(`Page ${index + 1}`);
    if (!isRecord(v)) return fallback;
    const pattern = str(isRecord(v.background) ? v.background.pattern : "", "dots");
    return {
        id: str(v.id, fallback.id),
        name: str(v.name, fallback.name),
        nodes: Array.isArray(v.nodes)
            ? v.nodes.map(parseNode).filter((nd): nd is DiagramNode => nd !== null)
            : [],
        edges: Array.isArray(v.edges)
            ? v.edges.map(parseEdge).filter((e): e is DiagramEdge => e !== null)
            : [],
        background: {
            color: str(isRecord(v.background) ? v.background.color : "", fallback.background.color),
            pattern:
                pattern === "grid" || pattern === "lines" || pattern === "plain" ? pattern : "dots",
            spacing: num(isRecord(v.background) ? v.background.spacing : undefined, 20),
        },
    };
}

function parseComment(v: unknown): DocComment | null {
    if (!isRecord(v)) return null;
    const id = str(v.id);
    if (!id) return null;
    return {
        id,
        nodeId: typeof v.nodeId === "string" ? v.nodeId : null,
        pageId: str(v.pageId),
        x: num(v.x, 0),
        y: num(v.y, 0),
        author: str(v.author, "Unknown"),
        body: str(v.body),
        resolved: bool(v.resolved),
        createdAt: str(v.createdAt, new Date(0).toISOString()),
        replies: Array.isArray(v.replies)
            ? v.replies.filter(isRecord).map(r => ({
                  id: str(r.id, makeId("r")),
                  author: str(r.author, "Unknown"),
                  body: str(r.body),
                  createdAt: str(r.createdAt, new Date(0).toISOString()),
              }))
            : [],
    };
}

/**
 * Turn arbitrary JSON into a valid document. Never throws: an unrecognisable
 * payload yields an empty document rather than a broken editor.
 */
export function parseDoc(raw: unknown, fallbackTitle = "Untitled mindmap"): MindmapDoc {
    if (!isRecord(raw)) return createDoc(fallbackTitle);

    const pages =
        Array.isArray(raw.pages) && raw.pages.length > 0
            ? raw.pages.map(parsePage)
            : [createPage()];

    const activePageId = str(raw.activePageId);
    const settings = isRecord(raw.settings) ? raw.settings : {};
    const edgeKind = str(settings.defaultEdgeKind, "elbow");

    return {
        schemaVersion: DOC_SCHEMA_VERSION,
        title: str(raw.title, fallbackTitle),
        pages,
        activePageId: pages.some(p => p.id === activePageId) ? activePageId : pages[0]!.id,
        comments: Array.isArray(raw.comments)
            ? raw.comments.map(parseComment).filter((c): c is DocComment => c !== null)
            : [],
        settings: defaultSettings({
            snapToGrid: bool(settings.snapToGrid, true),
            snapToObjects: bool(settings.snapToObjects, true),
            gridSize: num(settings.gridSize, 10),
            showGrid: bool(settings.showGrid, true),
            showRulers: bool(settings.showRulers, false),
            defaultEdgeKind: (edgeKind === "straight" || edgeKind === "curved"
                ? edgeKind
                : "elbow") as EdgeKind,
            paletteId: str(settings.paletteId, "default"),
        }),
    };
}

export function serializeDoc(doc: MindmapDoc): string {
    return JSON.stringify(doc);
}

// ---------------------------------------------------------------------------
// Markdown outline
// ---------------------------------------------------------------------------

export interface OutlineOptions {
    /**
     * Put every top-level branch under its own Markdown heading.
     *
     * The heading-aware chunker splits on headings and stamps each chunk
     * with the heading path, and that path is prepended to the text that is
     * embedded. With sections on, a chunk cut out of a large map still says
     * which branch it came from ("Launch plan > Infrastructure") instead of
     * only which map. Off by default so the export people download keeps
     * reading as one outline.
     */
    sections?: boolean;
}

/**
 * Depth-first outline of every page. This is the text that gets indexed when a
 * mindmap is published as a knowledge source, so it has to read as prose-ish
 * structure rather than a dump of coordinates.
 */
export function toMarkdownOutline(doc: MindmapDoc, options: OutlineOptions = {}): string {
    const sections = options.sections === true;
    const out: string[] = [`# ${doc.title || "Untitled mindmap"}`, ""];
    // With sections on, a page heading takes the H2 slot and branches become
    // H3s; without pages the branches are H2s. The chunker reads three levels.
    const pageHeading = doc.pages.length > 1 ? "## " : "";
    const branchHeading = doc.pages.length > 1 ? "### " : "## ";

    for (const page of doc.pages) {
        if (doc.pages.length > 1) out.push(`${pageHeading}${page.name}`, "");
        const idx = graphIndex(page);
        const byId = new Map(page.nodes.map(nd => [nd.id, nd]));
        const roots = page.nodes.filter(nd => (idx.in.get(nd.id) ?? []).length === 0);
        const seen = new Set<string>();
        const labelOf = (nd: { text: string }) =>
            (nd.text.trim() || "(untitled)").replace(/\n+/g, " ");

        const walk = (id: string, depth: number) => {
            if (seen.has(id) || depth > 32) return;
            seen.add(id);
            const nd = byId.get(id);
            if (!nd) return;
            out.push(`${"  ".repeat(depth)}- ${labelOf(nd)}`);
            for (const childId of idx.out.get(id) ?? []) walk(childId, depth + 1);
        };

        if (sections) {
            // One section per top-level branch: the root's label leads the
            // section so the root topic is never separated from its
            // children, and a root with no branches is a section of its own.
            for (const root of roots) {
                if (seen.has(root.id)) continue;
                const branches = (idx.out.get(root.id) ?? []).filter(id => !seen.has(id));
                if (branches.length === 0) {
                    walk(root.id, 0);
                    out.push("");
                    continue;
                }
                seen.add(root.id);
                for (const branchId of branches) {
                    const branch = byId.get(branchId);
                    if (!branch || seen.has(branchId)) continue;
                    out.push(`${branchHeading}${labelOf(branch)}`, "", `- ${labelOf(root)}`);
                    walk(branchId, 1);
                    out.push("");
                }
            }
        } else {
            for (const root of roots) walk(root.id, 0);
        }
        // Nodes in a cycle never appear as roots — list whatever is left so no
        // content is silently dropped from the export.
        for (const nd of page.nodes) if (!seen.has(nd.id)) walk(nd.id, 0);

        const labelled = page.edges.filter(e => e.labels.some(l => l.text.trim()));
        if (labelled.length) {
            out.push("", sections ? `${branchHeading}Connections` : "**Connections**", "");
            for (const e of labelled) {
                const a = e.from.nodeId ? byId.get(e.from.nodeId)?.text : undefined;
                const b = e.to.nodeId ? byId.get(e.to.nodeId)?.text : undefined;
                const label = e.labels
                    .map(l => l.text)
                    .filter(Boolean)
                    .join(" / ");
                out.push(`- ${trimmedOr(a, "?")} → ${trimmedOr(b, "?")}: ${label}`);
            }
        }
        out.push("");
    }

    const openComments = doc.comments.filter(c => !c.resolved);
    if (openComments.length) {
        out.push("## Open comments", "");
        for (const c of openComments) out.push(`- **${c.author}**: ${c.body}`);
        out.push("");
    }

    return out.join("\n");
}

/** Indented outline → a mindmap document. Tabs or 2/4 spaces all work. */
export function fromMarkdownOutline(text: string, title = "Imported mindmap"): MindmapDoc {
    const lines = text
        .split("\n")
        .map(l => l.replace(/\t/g, "    "))
        .filter(l => l.trim() !== "");

    const page = createPage("Page 1");
    const nodes: DiagramNode[] = [];
    const edges: DiagramEdge[] = [];
    /** Most recent node id at each indent depth. */
    const stack: string[] = [];

    let docTitle = title;
    let y = 0;

    // Indent width is per-document, not universal: 2 spaces, 4 spaces and tabs
    // are all common. Infer it from the smallest indent that actually appears,
    // so a 4-space outline nests the same way a 2-space one does.
    const indentsPresent = lines
        .map(l => /^(\s*)/.exec(l)?.[1]?.length ?? 0)
        .filter(width => width > 0);
    const indentUnit = indentsPresent.length > 0 ? Math.min(...indentsPresent) : 2;

    for (const raw of lines) {
        const indentMatch = /^(\s*)/.exec(raw);
        const indent = indentMatch?.[1]?.length ?? 0;
        const content = raw.trim().replace(/^([-*+]|\d+\.)\s+/, "");
        const heading = /^(#+)\s+(.*)$/.exec(content);

        if (heading && (heading[1]?.length ?? 0) === 1) {
            docTitle = heading[2] ?? docTitle;
            continue;
        }

        const label = heading ? (heading[2] ?? "") : content;
        if (!label) continue;

        const rawDepth = heading
            ? Math.max((heading[1]?.length ?? 2) - 2, 0)
            : Math.round(indent / indentUnit);
        // A jump of more than one level attaches to the deepest topic so far
        // rather than dangling: skipped levels are a typo, not a new root.
        const depth = Math.min(rawDepth, stack.length);
        const sw = branchSwatch(depth);
        const node = createNode({
            shape: depth === 0 ? "mind-root" : depth === 1 ? "mind-branch" : "mind-branch",
            x: depth * 260,
            y,
            w: depth === 0 ? 200 : 170,
            h: depth === 0 ? 76 : 54,
            text: label,
            style:
                depth === 0
                    ? { fill: sw.stroke, stroke: "none", strokeWidth: 0, shadow: true }
                    : { fill: sw.fill, stroke: sw.stroke },
            textStyle: {
                color: depth === 0 ? "oklch(0.99 0.002 285)" : sw.ink,
                size: depth === 0 ? 18 : 14,
                bold: depth <= 1,
            },
            data: { depth },
        });
        nodes.push(node);
        y += 74;

        const parentId = depth > 0 ? stack[depth - 1] : undefined;
        if (parentId) {
            edges.push(
                createEdge({
                    from: { nodeId: parentId, port: "auto" },
                    to: { nodeId: node.id, port: "auto" },
                    kind: "curved",
                    style: { stroke: sw.stroke, strokeWidth: Math.max(3 - depth * 0.5, 1.4) },
                    endArrow: "none",
                })
            );
        }
        stack[depth] = node.id;
        stack.length = depth + 1;
    }

    return createDoc(docTitle, [{ ...page, nodes, edges }]);
}

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

const MERMAID_SHAPE_WRAP: Partial<Record<ShapeId, [string, string]>> = {
    decision: ["{", "}"],
    diamond: ["{", "}"],
    terminator: ["([", "])"],
    "rounded-rectangle": ["(", ")"],
    "mind-root": ["((", "))"],
    circle: ["((", "))"],
    ellipse: ["([", "])"],
    data: ["[/", "/]"],
    parallelogram: ["[/", "/]"],
    database: ["[(", ")]"],
    cylinder: ["[(", ")]"],
    hexagon: ["{{", "}}"],
};

function mermaidId(index: number): string {
    return `N${index}`;
}

function escapeMermaid(text: string): string {
    return text.replace(/\n+/g, " ").replace(/"/g, "'").trim() || " ";
}

/** Flowchart export of the active page, for pasting into Markdown docs. */
export function toMermaid(doc: MindmapDoc, pageId?: string): string {
    const page = doc.pages.find(p => p.id === (pageId ?? doc.activePageId)) ?? doc.pages[0];
    if (!page) return "flowchart LR\n";

    const ids = new Map<string, string>();
    page.nodes.forEach((nd, i) => ids.set(nd.id, mermaidId(i)));

    const out: string[] = ["flowchart LR"];
    for (const nd of page.nodes) {
        const [open, close] = MERMAID_SHAPE_WRAP[nd.shape] ?? ["[", "]"];
        out.push(`    ${ids.get(nd.id)}${open}"${escapeMermaid(nd.text)}"${close}`);
    }
    for (const e of page.edges) {
        const a = e.from.nodeId ? ids.get(e.from.nodeId) : undefined;
        const b = e.to.nodeId ? ids.get(e.to.nodeId) : undefined;
        if (!a || !b) continue;
        const label = e.labels
            .map(l => l.text)
            .filter(Boolean)
            .join(" / ");
        const arrow = e.style.strokeStyle === "dashed" ? "-.->" : "-->";
        out.push(
            label ? `    ${a} ${arrow}|"${escapeMermaid(label)}"| ${b}` : `    ${a} ${arrow} ${b}`
        );
    }
    return out.join("\n");
}

/**
 * Minimal Mermaid flowchart import — enough to bring a diagram from a README
 * into the editor. Unsupported directives are skipped rather than rejected.
 */
export function fromMermaid(text: string, title = "Imported diagram"): MindmapDoc {
    const nodes = new Map<string, DiagramNode>();
    const edges: DiagramEdge[] = [];
    let cursor = 0;

    const ensure = (key: string, label?: string, shape: ShapeId = "process"): DiagramNode => {
        const existing = nodes.get(key);
        if (existing) {
            if (label && !existing.text) existing.text = label;
            return existing;
        }
        const col = cursor % 4;
        const row = Math.floor(cursor / 4);
        cursor += 1;
        const node = createNode({
            shape,
            x: col * 230,
            y: row * 150,
            text: label ?? key,
        });
        nodes.set(key, node);
        return node;
    };

    const nodePattern =
        /([A-Za-z0-9_]+)\s*(\(\(|\(\[|\[\(|\{\{|\[\/|\[|\(|\{)\s*"?([^"\]})/]*)"?\s*(\)\)|\]\)|\)\]|\}\}|\/\]|\]|\)|\})/g;
    const edgePattern =
        /([A-Za-z0-9_]+)\s*(-{2,3}>|-\.->|={2,3}>|---)\s*(?:\|\s*"?([^"|]*)"?\s*\|)?\s*([A-Za-z0-9_]+)/g;

    const shapeFor = (open: string): ShapeId => {
        switch (open) {
            case "((":
                return "circle";
            case "([":
                return "terminator";
            case "[(":
                return "database";
            case "{{":
                return "hexagon";
            case "[/":
                return "data";
            case "{":
                return "decision";
            case "(":
                return "rounded-rectangle";
            default:
                return "process";
        }
    };

    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || /^(flowchart|graph|subgraph|end|classDef|class |style |%%)/.test(trimmed)) {
            continue;
        }
        nodePattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = nodePattern.exec(trimmed)) !== null) {
            ensure(m[1]!, trimmedOr(m[3], m[1]!), shapeFor(m[2]!));
        }
        edgePattern.lastIndex = 0;
        let e: RegExpExecArray | null;
        while ((e = edgePattern.exec(trimmed)) !== null) {
            const from = ensure(e[1]!);
            const to = ensure(e[4]!);
            edges.push(
                createEdge({
                    from: { nodeId: from.id, port: "auto" },
                    to: { nodeId: to.id, port: "auto" },
                    kind: "elbow",
                    label: nonEmpty(e[3]),
                    endArrow: e[2] === "---" ? "none" : "arrow",
                    style: e[2] === "-.->" ? { strokeStyle: "dashed" } : undefined,
                })
            );
        }
    }

    const page = createPage("Page 1");
    return createDoc(title, [{ ...page, nodes: [...nodes.values()], edges }]);
}

// ---------------------------------------------------------------------------
// CSV / tabular import
// ---------------------------------------------------------------------------

/**
 * Two-column `parent,child` CSV → a tree. Handy for importing an org chart or
 * a dependency list exported from a spreadsheet.
 */
export function fromEdgeList(text: string, title = "Imported chart"): MindmapDoc {
    const nodes = new Map<string, DiagramNode>();
    const edges: DiagramEdge[] = [];
    let cursor = 0;

    const ensure = (label: string): DiagramNode => {
        const key = label.trim();
        const existing = nodes.get(key);
        if (existing) return existing;
        const node = createNode({
            shape: "mind-branch",
            x: (cursor % 5) * 210,
            y: Math.floor(cursor / 5) * 110,
            text: key,
        });
        cursor += 1;
        nodes.set(key, node);
        return node;
    };

    for (const line of text.split("\n")) {
        const cells = line.split(/[,\t;]/).map(c => c.replace(/^"|"$/g, "").trim());
        const [a, b, label] = cells;
        if (!a || !b) continue;
        if (/^(parent|from|source)$/i.test(a)) continue; // header row
        const from = ensure(a);
        const to = ensure(b);
        edges.push(
            createEdge({
                from: { nodeId: from.id, port: "auto" },
                to: { nodeId: to.id, port: "auto" },
                kind: "elbow",
                label: nonEmpty(label),
            })
        );
    }

    const page = createPage("Page 1");
    return createDoc(title, [{ ...page, nodes: [...nodes.values()], edges }]);
}
