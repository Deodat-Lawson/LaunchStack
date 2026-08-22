/**
 * Constructors for every document part, with the defaults a freshly inserted
 * object should carry. Nothing else in the editor should build a node or edge
 * literal — going through here is what guarantees a new shape picks up the
 * document's active palette, snap settings, and text defaults.
 */

import { branchSwatch, HAIRLINE, INK, PAPER, STICKY_COLORS, SWATCH_BY_ID } from "./palette";
import { shapeDef } from "./shapes";
import {
    DOC_SCHEMA_VERSION,
    type DiagramEdge,
    type DiagramNode,
    type DiagramPage,
    type DocSettings,
    type EdgeKind,
    type EdgeStyle,
    type MindmapDoc,
    type NodeStyle,
    type Point,
    type ShapeId,
    type TextStyle,
} from "./types";

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

let counter = 0;

/**
 * Short, collision-resistant id. Prefixed by kind so a stray id in a JSON dump
 * is self-describing, and monotonically suffixed so ids created in one tick
 * cannot collide even if the RNG repeats.
 */
export function makeId(prefix: string): string {
    counter = (counter + 1) % 0xffff;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${rand}${counter.toString(36)}`;
}

/** Test hook: makes ids deterministic across a run. */
export function __resetIdCounter(): void {
    counter = 0;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export function defaultNodeStyle(overrides: Partial<NodeStyle> = {}): NodeStyle {
    return {
        fill: PAPER,
        stroke: HAIRLINE,
        strokeWidth: 1.5,
        strokeStyle: "solid",
        opacity: 1,
        radius: 8,
        shadow: false,
        ...overrides,
    };
}

export function defaultTextStyle(overrides: Partial<TextStyle> = {}): TextStyle {
    return {
        color: INK,
        size: 14,
        family: "sans",
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        align: "center",
        valign: "middle",
        lineHeight: 1.35,
        ...overrides,
    };
}

export function defaultEdgeStyle(overrides: Partial<EdgeStyle> = {}): EdgeStyle {
    return {
        stroke: "oklch(0.55 0.03 280)",
        strokeWidth: 1.8,
        strokeStyle: "solid",
        opacity: 1,
        ...overrides,
    };
}

export function defaultSettings(overrides: Partial<DocSettings> = {}): DocSettings {
    return {
        snapToGrid: true,
        snapToObjects: true,
        gridSize: 10,
        showGrid: true,
        showRulers: false,
        defaultEdgeKind: "elbow",
        paletteId: "default",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Per-shape presets
// ---------------------------------------------------------------------------

/**
 * Shape-specific styling applied on top of the document defaults — a sticky
 * looks nothing like a UML class even before the user touches the inspector.
 */
function presetFor(shape: ShapeId): { style: Partial<NodeStyle>; text: Partial<TextStyle> } {
    switch (shape) {
        case "sticky":
            return {
                style: {
                    fill: STICKY_COLORS[0]!,
                    stroke: "none",
                    strokeWidth: 0,
                    radius: 3,
                    shadow: true,
                },
                text: { align: "left", valign: "top", size: 15 },
            };
        case "text":
            return {
                style: { fill: "none", stroke: "none", strokeWidth: 0, shadow: false },
                text: { align: "left", valign: "top", size: 16 },
            };
        case "mind-root": {
            const sw = branchSwatch(0);
            return {
                style: {
                    fill: sw.stroke,
                    stroke: "none",
                    strokeWidth: 0,
                    shadow: true,
                    radius: 22,
                },
                text: { color: "oklch(0.99 0.002 285)", size: 18, bold: true },
            };
        }
        case "mind-branch": {
            const sw = branchSwatch(1);
            return {
                style: { fill: sw.fill, stroke: sw.stroke, strokeWidth: 1.5, radius: 10 },
                text: { color: sw.ink, size: 14, bold: false },
            };
        }
        case "mind-leaf":
            return {
                style: { fill: "none", stroke: HAIRLINE, strokeWidth: 1.5 },
                text: { align: "left", valign: "bottom", size: 13 },
            };
        case "frame":
            return {
                style: {
                    fill: "oklch(0.985 0.004 280)",
                    stroke: "oklch(0.80 0.01 280)",
                    strokeWidth: 1,
                    radius: 8,
                },
                text: { align: "left", valign: "middle", size: 12, color: "oklch(0.50 0.01 280)" },
            };
        case "group":
            return {
                style: { fill: "none", stroke: "none", strokeWidth: 0 },
                text: {},
            };
        case "swimlane-h":
        case "swimlane-v":
            return {
                style: {
                    fill: "oklch(0.99 0.003 280)",
                    stroke: "oklch(0.78 0.012 280)",
                    strokeWidth: 1.2,
                    radius: 4,
                },
                text: { align: "left", valign: "middle", size: 13, bold: true },
            };
        case "uml-class":
        case "erd-entity":
            return {
                style: { fill: PAPER, stroke: "oklch(0.45 0.02 280)", strokeWidth: 1.4, radius: 4 },
                text: { align: "center", valign: "top", size: 14, bold: true },
            };
        case "uml-note":
            return {
                style: { fill: "oklch(0.97 0.05 95)", stroke: "oklch(0.65 0.09 90)" },
                text: { align: "left", valign: "top", size: 13 },
            };
        case "uml-actor":
        case "uml-interface":
            return {
                style: { fill: PAPER, stroke: INK, strokeWidth: 1.6 },
                text: { valign: "top", size: 13 },
            };
        case "line":
        case "ink":
        case "bracket-pair":
            return {
                style: { fill: "none", stroke: INK, strokeWidth: 2 },
                text: {},
            };
        case "image":
            return {
                style: { fill: "none", stroke: "none", strokeWidth: 0, radius: 6 },
                text: {},
            };
        case "connector-dot":
        case "or-junction":
        case "summing-junction":
            return {
                style: { fill: PAPER, stroke: INK, strokeWidth: 1.5 },
                text: { size: 12 },
            };
        default: {
            const sw = SWATCH_BY_ID.violet!;
            return {
                style: { fill: sw.fill, stroke: sw.stroke, strokeWidth: 1.5 },
                text: { color: sw.ink },
            };
        }
    }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface CreateNodeOptions {
    shape: ShapeId;
    /** World position of the node's top-left. Centre-based helpers wrap this. */
    x: number;
    y: number;
    w?: number;
    h?: number;
    text?: string;
    style?: Partial<NodeStyle>;
    textStyle?: Partial<TextStyle>;
    parentId?: string | null;
    data?: DiagramNode["data"];
    rotation?: number;
}

export function createNode(opts: CreateNodeOptions): DiagramNode {
    const d = shapeDef(opts.shape);
    const preset = presetFor(opts.shape);
    return {
        id: makeId("n"),
        shape: opts.shape,
        x: opts.x,
        y: opts.y,
        w: opts.w ?? d.defaultSize.w,
        h: opts.h ?? d.defaultSize.h,
        rotation: opts.rotation ?? 0,
        text: opts.text ?? "",
        style: defaultNodeStyle({ ...preset.style, ...opts.style }),
        textStyle: defaultTextStyle({ ...preset.text, ...opts.textStyle }),
        parentId: opts.parentId ?? null,
        locked: false,
        hidden: false,
        ...(opts.data ? { data: opts.data } : {}),
    };
}

/** Same as `createNode`, but positioned so the node is centred on `at`. */
export function createNodeAt(
    shape: ShapeId,
    at: Point,
    opts: Omit<CreateNodeOptions, "shape" | "x" | "y"> = {}
): DiagramNode {
    const d = shapeDef(shape);
    const w = opts.w ?? d.defaultSize.w;
    const h = opts.h ?? d.defaultSize.h;
    return createNode({ ...opts, shape, w, h, x: at.x - w / 2, y: at.y - h / 2 });
}

/** A mindmap topic auto-styled for its depth. */
export function createMindNode(depth: number, at: Point, text = ""): DiagramNode {
    const shape: ShapeId = depth === 0 ? "mind-root" : depth === 1 ? "mind-branch" : "mind-branch";
    const sw = branchSwatch(depth);
    const node = createNodeAt(shape, at, {
        text,
        w: depth === 0 ? 200 : depth === 1 ? 170 : 150,
        h: depth === 0 ? 76 : depth === 1 ? 56 : 48,
        style:
            depth === 0
                ? { fill: sw.stroke, stroke: "none", strokeWidth: 0, shadow: true }
                : { fill: sw.fill, stroke: sw.stroke },
        textStyle:
            depth === 0
                ? { color: "oklch(0.99 0.002 285)", size: 18, bold: true }
                : { color: sw.ink, size: depth === 1 ? 15 : 13.5, bold: depth === 1 },
        data: { depth },
    });
    return node;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export interface CreateEdgeOptions {
    from: DiagramEdge["from"];
    to: DiagramEdge["to"];
    kind?: EdgeKind;
    style?: Partial<EdgeStyle>;
    startArrow?: DiagramEdge["startArrow"];
    endArrow?: DiagramEdge["endArrow"];
    label?: string;
    waypoints?: Point[];
}

export function createEdge(opts: CreateEdgeOptions): DiagramEdge {
    return {
        id: makeId("e"),
        from: opts.from,
        to: opts.to,
        kind: opts.kind ?? "elbow",
        waypoints: opts.waypoints ?? [],
        style: defaultEdgeStyle(opts.style),
        startArrow: opts.startArrow ?? "none",
        endArrow: opts.endArrow ?? "arrow",
        labels: opts.label ? [{ text: opts.label, t: 0.5, offset: 0 }] : [],
        textStyle: defaultTextStyle({ size: 12, color: "oklch(0.42 0.01 280)" }),
        locked: false,
        hidden: false,
    };
}

// ---------------------------------------------------------------------------
// Pages + documents
// ---------------------------------------------------------------------------

export function createPage(name = "Page 1", overrides: Partial<DiagramPage> = {}): DiagramPage {
    return {
        id: makeId("p"),
        name,
        nodes: [],
        edges: [],
        background: { color: PAPER, pattern: "dots", spacing: 20 },
        ...overrides,
    };
}

export function createDoc(title = "Untitled mindmap", pages?: DiagramPage[]): MindmapDoc {
    const list = pages && pages.length > 0 ? pages : [createPage()];
    return {
        schemaVersion: DOC_SCHEMA_VERSION,
        title,
        pages: list,
        activePageId: list[0]!.id,
        comments: [],
        settings: defaultSettings(),
    };
}
