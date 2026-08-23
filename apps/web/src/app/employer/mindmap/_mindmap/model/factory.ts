/**
 * Constructors for every document part, with the defaults a freshly inserted
 * object should carry. Nothing else in the editor should build a node or edge
 * literal — going through here is what guarantees a new shape picks up the
 * document's active palette, snap settings, and text defaults.
 */

import {
    branchSwatch,
    neutralsFor,
    PAPER,
    stickyColors,
    readableInkOn,
    stickyInk,
    swatchFor,
    type ThemeMode,
} from "./palette";
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

export function defaultNodeStyle(
    overrides: Partial<NodeStyle> = {},
    mode: ThemeMode = "light"
): NodeStyle {
    const n = neutralsFor(mode);
    return {
        fill: n.paper,
        stroke: n.hairline,
        strokeWidth: 1.5,
        strokeStyle: "solid",
        opacity: 1,
        radius: 8,
        shadow: false,
        ...overrides,
    };
}

export function defaultTextStyle(
    overrides: Partial<TextStyle> = {},
    mode: ThemeMode = "light"
): TextStyle {
    return {
        color: neutralsFor(mode).ink,
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
function presetFor(
    shape: ShapeId,
    mode: ThemeMode = "light"
): { style: Partial<NodeStyle>; text: Partial<TextStyle> } {
    const n = neutralsFor(mode);
    const sticky = stickyColors(mode);
    switch (shape) {
        case "sticky":
            return {
                style: {
                    fill: sticky[0]!,
                    stroke: "none",
                    strokeWidth: 0,
                    radius: 3,
                    shadow: true,
                },
                text: { align: "left", valign: "top", size: 15, color: stickyInk(mode) },
            };
        case "text":
            return {
                style: { fill: "none", stroke: "none", strokeWidth: 0, shadow: false },
                text: { align: "left", valign: "top", size: 16 },
            };
        case "mind-root": {
            const sw = branchSwatch(0, mode);
            return {
                style: {
                    fill: sw.stroke,
                    stroke: "none",
                    strokeWidth: 0,
                    shadow: true,
                    radius: 22,
                },
                text: { color: readableInkOn(sw.stroke), size: 18, bold: true },
            };
        }
        case "mind-branch": {
            const sw = branchSwatch(1, mode);
            return {
                style: { fill: sw.fill, stroke: sw.stroke, strokeWidth: 1.5, radius: 10 },
                text: { color: sw.ink, size: 14, bold: false },
            };
        }
        case "mind-leaf":
            return {
                style: { fill: "none", stroke: n.hairline, strokeWidth: 1.5 },
                text: { align: "left", valign: "bottom", size: 13, color: n.ink },
            };
        case "frame":
            return {
                style: {
                    // A frame is a slightly raised patch of paper, so it tracks
                    // the paper rather than sitting at a fixed lightness.
                    fill: mode === "dark" ? "oklch(0.235 0.018 285)" : "oklch(0.985 0.004 280)",
                    stroke: mode === "dark" ? "oklch(0.36 0.02 285)" : "oklch(0.80 0.01 280)",
                    strokeWidth: 1,
                    radius: 8,
                },
                text: { align: "left", valign: "middle", size: 12, color: n.inkSoft },
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
                    fill: mode === "dark" ? "oklch(0.22 0.015 285)" : "oklch(0.99 0.003 280)",
                    stroke: mode === "dark" ? "oklch(0.38 0.02 285)" : "oklch(0.78 0.012 280)",
                    strokeWidth: 1.2,
                    radius: 4,
                },
                text: { align: "left", valign: "middle", size: 13, bold: true, color: n.ink },
            };
        case "uml-class":
        case "erd-entity":
            return {
                style: {
                    fill: n.paper,
                    stroke: mode === "dark" ? "oklch(0.60 0.02 280)" : "oklch(0.45 0.02 280)",
                    strokeWidth: 1.4,
                    radius: 4,
                },
                text: { align: "center", valign: "top", size: 14, bold: true, color: n.ink },
            };
        case "uml-note":
            return {
                style: {
                    fill: mode === "dark" ? "oklch(0.31 0.06 92)" : "oklch(0.97 0.05 95)",
                    stroke: mode === "dark" ? "oklch(0.66 0.10 90)" : "oklch(0.65 0.09 90)",
                },
                text: { align: "left", valign: "top", size: 13, color: n.ink },
            };
        case "uml-actor":
        case "uml-interface":
            return {
                style: { fill: n.paper, stroke: n.ink, strokeWidth: 1.6 },
                text: { valign: "top", size: 13, color: n.ink },
            };
        case "line":
        case "ink":
        case "bracket-pair":
            return {
                style: { fill: "none", stroke: n.ink, strokeWidth: 2 },
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
                style: { fill: n.paper, stroke: n.ink, strokeWidth: 1.5 },
                text: { size: 12, color: n.ink },
            };
        default: {
            const sw = swatchFor("violet", mode);
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
    /** Which paper this node is being drawn on. Defaults to light. */
    mode?: ThemeMode;
}

export function createNode(opts: CreateNodeOptions): DiagramNode {
    const d = shapeDef(opts.shape);
    const mode = opts.mode ?? "light";
    const preset = presetFor(opts.shape, mode);
    return {
        id: makeId("n"),
        shape: opts.shape,
        x: opts.x,
        y: opts.y,
        w: opts.w ?? d.defaultSize.w,
        h: opts.h ?? d.defaultSize.h,
        rotation: opts.rotation ?? 0,
        text: opts.text ?? "",
        style: defaultNodeStyle({ ...preset.style, ...opts.style }, mode),
        textStyle: defaultTextStyle({ ...preset.text, ...opts.textStyle }, mode),
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
export function createMindNode(
    depth: number,
    at: Point,
    text = "",
    mode: ThemeMode = "light"
): DiagramNode {
    const shape: ShapeId = depth === 0 ? "mind-root" : depth === 1 ? "mind-branch" : "mind-branch";
    const sw = branchSwatch(depth, mode);
    const node = createNodeAt(shape, at, {
        text,
        mode,
        w: depth === 0 ? 200 : depth === 1 ? 170 : 150,
        h: depth === 0 ? 76 : depth === 1 ? 56 : 48,
        style:
            depth === 0
                ? { fill: sw.stroke, stroke: "none", strokeWidth: 0, shadow: true }
                : { fill: sw.fill, stroke: sw.stroke },
        textStyle:
            depth === 0
                ? { color: readableInkOn(sw.stroke), size: 18, bold: true }
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
