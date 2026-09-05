/**
 * The shape library.
 *
 * Every entry is a pure function from a node's local box (`w × h`) to SVG path
 * data, so the same registry drives on-canvas rendering, the palette preview
 * thumbnails, and SVG/PNG export — there is no second implementation to keep
 * in sync.
 *
 * Paths are generated in *local* space with the origin at the node's top-left;
 * rotation and world placement are applied by the renderer's transform.
 */

import { clamp } from "./geometry";
import type { PortId, Rect, ShapeCategory, ShapeId, Size } from "./types";

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

function n(v: number): string {
    return String(Math.round(v * 100) / 100);
}

/** Closed polygon through `pts`. */
function poly(pts: readonly [number, number][]): string {
    if (pts.length === 0) return "";
    const [first, ...rest] = pts;
    const head = `M ${n(first![0])} ${n(first![1])}`;
    const body = rest.map(p => `L ${n(p[0])} ${n(p[1])}`).join(" ");
    return `${head} ${body} Z`;
}

/** Open polyline through `pts`. */
function line(pts: readonly [number, number][]): string {
    if (pts.length === 0) return "";
    const [first, ...rest] = pts;
    return `M ${n(first![0])} ${n(first![1])} ${rest.map(p => `L ${n(p[0])} ${n(p[1])}`).join(" ")}`;
}

function roundedRect(w: number, h: number, r: number): string {
    const rr = clamp(r, 0, Math.min(w, h) / 2);
    if (rr <= 0)
        return poly([
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
        ]);
    return [
        `M ${n(rr)} 0`,
        `H ${n(w - rr)}`,
        `A ${n(rr)} ${n(rr)} 0 0 1 ${n(w)} ${n(rr)}`,
        `V ${n(h - rr)}`,
        `A ${n(rr)} ${n(rr)} 0 0 1 ${n(w - rr)} ${n(h)}`,
        `H ${n(rr)}`,
        `A ${n(rr)} ${n(rr)} 0 0 1 0 ${n(h - rr)}`,
        `V ${n(rr)}`,
        `A ${n(rr)} ${n(rr)} 0 0 1 ${n(rr)} 0`,
        "Z",
    ].join(" ");
}

function ellipsePath(w: number, h: number): string {
    const rx = w / 2;
    const ry = h / 2;
    return [
        `M 0 ${n(ry)}`,
        `A ${n(rx)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)}`,
        `A ${n(rx)} ${n(ry)} 0 0 1 0 ${n(ry)}`,
        "Z",
    ].join(" ");
}

/** Regular n-gon inscribed in the box, first vertex pointing up. */
function regularPolygon(w: number, h: number, sides: number, rotationDeg = -90): string {
    const cx = w / 2;
    const cy = h / 2;
    const pts: [number, number][] = [];
    for (let i = 0; i < sides; i++) {
        const a = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
        pts.push([cx + cx * Math.cos(a), cy + cy * Math.sin(a)]);
    }
    return poly(pts);
}

function starPath(w: number, h: number, points = 5, innerRatio = 0.42): string {
    const cx = w / 2;
    const cy = h / 2;
    const pts: [number, number][] = [];
    for (let i = 0; i < points * 2; i++) {
        const outer = i % 2 === 0;
        const rx = outer ? cx : cx * innerRatio;
        const ry = outer ? cy : cy * innerRatio;
        const a = ((-90 + (360 / (points * 2)) * i) * Math.PI) / 180;
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return poly(pts);
}

/** A wavy bottom edge — the flowchart "document" tail. */
function waveBottom(w: number, h: number, amp: number): string {
    return [
        `M 0 0`,
        `H ${n(w)}`,
        `V ${n(h - amp)}`,
        `C ${n(w * 0.75)} ${n(h - amp * 2.2)} ${n(w * 0.25)} ${n(h + amp * 0.6)} 0 ${n(h - amp)}`,
        "Z",
    ].join(" ");
}

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export interface ShapeGeometry {
    /** Filled + stroked outline. */
    path: string;
    /**
     * Extra outlines painted *behind* `path` with the same fill and stroke —
     * the offset ghost sheets of a document stack, for instance.
     */
    backing?: string[];
    /** Stroked-only decorations drawn on top (fold lines, dividers, …). */
    decorations?: string[];
}

export interface ShapeDef {
    id: ShapeId;
    name: string;
    category: ShapeCategory;
    /** Extra search terms for the palette's filter box. */
    keywords: string[];
    defaultSize: Size;
    minSize: Size;
    /** Resizing preserves the aspect ratio (circle, square, actor). */
    keepAspect?: boolean;
    /** Honours `style.radius` for its corners. */
    rounded?: boolean;
    /** Accepts children dropped inside it (groups, frames, swimlanes). */
    container?: boolean;
    /** Rendered with no fill/stroke chrome — text or bitmap only. */
    chromeless?: boolean;
    /**
     * Kept in the registry so existing documents render, but not offered in
     * the palette: another tile with the same silhouette carries this shape's
     * keywords (the diamond is the decision, the cylinder is the database).
     */
    paletteHidden?: boolean;
    /**
     * Whether the shape carries a text label. Defaults to true: nearly every
     * shape here is a container you put words in, which is the whole point of
     * dropping one. The exceptions are the shapes with nothing to say — a
     * bitmap, a pen stroke, a rule.
     */
    holdsText?: boolean;
    /** Connectable anchors. Defaults to the four cardinal sides. */
    ports?: readonly Exclude<PortId, "auto">[];
    /** Text area in local coordinates. Defaults to the full box, inset 8px. */
    textBox?: (w: number, h: number) => Rect;
    geometry: (w: number, h: number, radius: number) => ShapeGeometry;
}

const DEFAULT_PORTS: readonly Exclude<PortId, "auto">[] = ["n", "e", "s", "w"];
const ALL8: readonly Exclude<PortId, "auto">[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

const TEXT_PAD = 8;

function insetBox(w: number, h: number, pad = TEXT_PAD): Rect {
    return { x: pad, y: pad, w: Math.max(w - pad * 2, 0), h: Math.max(h - pad * 2, 0) };
}

function def(d: ShapeDef): ShapeDef {
    return d;
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const BASIC: ShapeDef[] = [
    def({
        id: "rectangle",
        name: "Rectangle",
        category: "Standard",
        keywords: ["box", "square", "block", "process", "step"],
        defaultSize: { w: 160, h: 90 },
        minSize: { w: 12, h: 12 },
        ports: ALL8,
        geometry: (w, h) => ({
            path: poly([
                [0, 0],
                [w, 0],
                [w, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "rounded-rectangle",
        name: "Rounded rectangle",
        category: "Standard",
        keywords: ["box", "card", "pill"],
        defaultSize: { w: 160, h: 90 },
        minSize: { w: 12, h: 12 },
        rounded: true,
        ports: ALL8,
        geometry: (w, h, r) => ({ path: roundedRect(w, h, r || 12) }),
    }),
    def({
        id: "ellipse",
        name: "Ellipse",
        category: "Standard",
        keywords: ["oval", "circle", "round"],
        defaultSize: { w: 160, h: 100 },
        minSize: { w: 12, h: 12 },
        ports: ALL8,
        textBox: (w, h) => insetBox(w * 0.86, h * 0.86, 0),
        geometry: (w, h) => ({ path: ellipsePath(w, h) }),
    }),
    def({
        id: "circle",
        name: "Circle",
        category: "Standard",
        keywords: ["round", "dot", "connector", "junction"],
        defaultSize: { w: 120, h: 120 },
        minSize: { w: 12, h: 12 },
        keepAspect: true,
        ports: ALL8,
        geometry: (w, h) => ({ path: ellipsePath(w, h) }),
    }),
    def({
        id: "diamond",
        name: "Diamond",
        category: "Standard",
        keywords: ["rhombus", "decision", "choice"],
        defaultSize: { w: 160, h: 110 },
        minSize: { w: 24, h: 24 },
        textBox: (w, h) => ({ x: w * 0.2, y: h * 0.25, w: w * 0.6, h: h * 0.5 }),
        geometry: (w, h) => ({
            path: poly([
                [w / 2, 0],
                [w, h / 2],
                [w / 2, h],
                [0, h / 2],
            ]),
        }),
    }),
    def({
        id: "triangle",
        name: "Triangle",
        category: "Standard",
        keywords: ["delta", "up", "extract", "split"],
        defaultSize: { w: 140, h: 120 },
        minSize: { w: 16, h: 16 },
        textBox: (w, h) => ({ x: w * 0.2, y: h * 0.42, w: w * 0.6, h: h * 0.5 }),
        geometry: (w, h) => ({
            path: poly([
                [w / 2, 0],
                [w, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "right-triangle",
        name: "Right triangle",
        category: "Standard",
        keywords: ["corner", "wedge"],
        defaultSize: { w: 130, h: 120 },
        minSize: { w: 16, h: 16 },
        textBox: (w, h) => ({ x: w * 0.1, y: h * 0.5, w: w * 0.55, h: h * 0.42 }),
        geometry: (w, h) => ({
            path: poly([
                [0, 0],
                [w, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "pentagon",
        name: "Pentagon",
        category: "Standard",
        keywords: ["five"],
        defaultSize: { w: 130, h: 120 },
        minSize: { w: 20, h: 20 },
        geometry: (w, h) => ({ path: regularPolygon(w, h, 5) }),
    }),
    def({
        id: "hexagon",
        name: "Hexagon",
        category: "Standard",
        keywords: ["six", "preparation"],
        defaultSize: { w: 160, h: 100 },
        minSize: { w: 20, h: 20 },
        textBox: (w, h) => ({ x: w * 0.2, y: TEXT_PAD, w: w * 0.6, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => ({
            path: poly([
                [w * 0.25, 0],
                [w * 0.75, 0],
                [w, h / 2],
                [w * 0.75, h],
                [w * 0.25, h],
                [0, h / 2],
            ]),
        }),
    }),
    def({
        id: "octagon",
        name: "Octagon",
        category: "Standard",
        keywords: ["eight", "stop"],
        defaultSize: { w: 130, h: 120 },
        minSize: { w: 24, h: 24 },
        geometry: (w, h) => {
            const kx = w * 0.29;
            const ky = h * 0.29;
            return {
                path: poly([
                    [kx, 0],
                    [w - kx, 0],
                    [w, ky],
                    [w, h - ky],
                    [w - kx, h],
                    [kx, h],
                    [0, h - ky],
                    [0, ky],
                ]),
            };
        },
    }),
    def({
        id: "trapezoid",
        name: "Trapezoid",
        category: "Standard",
        keywords: ["manual", "operation"],
        defaultSize: { w: 160, h: 90 },
        minSize: { w: 24, h: 16 },
        geometry: (w, h) => ({
            path: poly([
                [w * 0.2, 0],
                [w * 0.8, 0],
                [w, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "parallelogram",
        name: "Parallelogram",
        category: "Standard",
        keywords: ["data", "input", "output", "skew", "io"],
        defaultSize: { w: 170, h: 90 },
        minSize: { w: 24, h: 16 },
        geometry: (w, h) => ({
            path: poly([
                [w * 0.22, 0],
                [w, 0],
                [w * 0.78, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "star",
        name: "Star",
        category: "Standard",
        keywords: ["favourite", "rating"],
        defaultSize: { w: 130, h: 125 },
        minSize: { w: 24, h: 24 },
        textBox: (w, h) => ({ x: w * 0.25, y: h * 0.34, w: w * 0.5, h: h * 0.36 }),
        geometry: (w, h) => ({ path: starPath(w, h) }),
    }),
    def({
        id: "cross",
        name: "Cross",
        category: "Standard",
        keywords: ["plus", "add"],
        defaultSize: { w: 120, h: 120 },
        minSize: { w: 24, h: 24 },
        geometry: (w, h) => {
            const tx = w * 0.33;
            const ty = h * 0.33;
            return {
                path: poly([
                    [tx, 0],
                    [w - tx, 0],
                    [w - tx, ty],
                    [w, ty],
                    [w, h - ty],
                    [w - tx, h - ty],
                    [w - tx, h],
                    [tx, h],
                    [tx, h - ty],
                    [0, h - ty],
                    [0, ty],
                    [tx, ty],
                ]),
            };
        },
    }),
    def({
        id: "cylinder",
        name: "Cylinder",
        category: "Standard",
        keywords: ["database", "storage", "disk"],
        paletteHidden: true,
        defaultSize: { w: 130, h: 140 },
        minSize: { w: 30, h: 40 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: h * 0.24, w: Math.max(w - 16, 0), h: h * 0.6 }),
        geometry: (w, h) => {
            const ry = Math.min(h * 0.14, 22);
            return {
                path: [
                    `M 0 ${n(ry)}`,
                    `A ${n(w / 2)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)}`,
                    `V ${n(h - ry)}`,
                    `A ${n(w / 2)} ${n(ry)} 0 0 1 0 ${n(h - ry)}`,
                    "Z",
                ].join(" "),
                decorations: [`M 0 ${n(ry)} A ${n(w / 2)} ${n(ry)} 0 0 0 ${n(w)} ${n(ry)}`],
            };
        },
    }),
    def({
        id: "cloud",
        name: "Cloud",
        category: "Standard",
        keywords: ["internet", "service", "saas"],
        defaultSize: { w: 180, h: 110 },
        minSize: { w: 40, h: 30 },
        textBox: (w, h) => ({ x: w * 0.16, y: h * 0.3, w: w * 0.68, h: h * 0.45 }),
        geometry: (w, h) => ({
            path: [
                `M ${n(w * 0.25)} ${n(h * 0.85)}`,
                `A ${n(w * 0.18)} ${n(h * 0.22)} 0 0 1 ${n(w * 0.18)} ${n(h * 0.48)}`,
                `A ${n(w * 0.2)} ${n(h * 0.26)} 0 0 1 ${n(w * 0.42)} ${n(h * 0.2)}`,
                `A ${n(w * 0.22)} ${n(h * 0.28)} 0 0 1 ${n(w * 0.76)} ${n(h * 0.3)}`,
                `A ${n(w * 0.16)} ${n(h * 0.22)} 0 0 1 ${n(w * 0.82)} ${n(h * 0.82)}`,
                `Z`,
            ].join(" "),
        }),
    }),
    def({
        id: "callout",
        name: "Callout",
        category: "Standard",
        keywords: ["speech", "bubble", "comment"],
        defaultSize: { w: 170, h: 100 },
        minSize: { w: 40, h: 40 },
        rounded: true,
        textBox: (w, h) => ({ x: TEXT_PAD, y: TEXT_PAD, w: Math.max(w - 16, 0), h: h * 0.72 }),
        geometry: (w, h, r) => {
            const body = h * 0.78;
            const rr = clamp(r || 10, 0, Math.min(w, body) / 2);
            return {
                path: [
                    `M ${n(rr)} 0`,
                    `H ${n(w - rr)}`,
                    `A ${n(rr)} ${n(rr)} 0 0 1 ${n(w)} ${n(rr)}`,
                    `V ${n(body - rr)}`,
                    `A ${n(rr)} ${n(rr)} 0 0 1 ${n(w - rr)} ${n(body)}`,
                    `H ${n(w * 0.38)}`,
                    `L ${n(w * 0.22)} ${n(h)}`,
                    `L ${n(w * 0.26)} ${n(body)}`,
                    `H ${n(rr)}`,
                    `A ${n(rr)} ${n(rr)} 0 0 1 0 ${n(body - rr)}`,
                    `V ${n(rr)}`,
                    `A ${n(rr)} ${n(rr)} 0 0 1 ${n(rr)} 0`,
                    "Z",
                ].join(" "),
            };
        },
    }),
    def({
        id: "chevron",
        name: "Chevron",
        category: "Standard",
        keywords: ["step", "process", "phase"],
        defaultSize: { w: 170, h: 80 },
        minSize: { w: 40, h: 20 },
        textBox: (w, h) => ({ x: w * 0.18, y: TEXT_PAD, w: w * 0.66, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => {
            const k = Math.min(w * 0.18, h * 0.5);
            return {
                path: poly([
                    [0, 0],
                    [w - k, 0],
                    [w, h / 2],
                    [w - k, h],
                    [0, h],
                    [k, h / 2],
                ]),
            };
        },
    }),
    def({
        id: "bracket-pair",
        name: "Brackets",
        category: "Standard",
        keywords: ["annotation", "span"],
        defaultSize: { w: 160, h: 90 },
        minSize: { w: 24, h: 24 },
        chromeless: true,
        geometry: (w, h) => {
            const k = Math.min(w * 0.12, 16);
            return {
                path: "",
                decorations: [
                    line([
                        [k, 0],
                        [0, 0],
                        [0, h],
                        [k, h],
                    ]),
                    line([
                        [w - k, 0],
                        [w, 0],
                        [w, h],
                        [w - k, h],
                    ]),
                ],
            };
        },
    }),
];

const ARROWS: ShapeDef[] = [
    def({
        id: "arrow-right",
        name: "Arrow right",
        category: "Arrows",
        keywords: ["direction", "flow"],
        defaultSize: { w: 160, h: 70 },
        minSize: { w: 30, h: 16 },
        textBox: (w, h) => ({ x: w * 0.08, y: h * 0.28, w: w * 0.6, h: h * 0.44 }),
        geometry: (w, h) => {
            const head = Math.min(w * 0.32, h);
            const shaft = h * 0.28;
            return {
                path: poly([
                    [0, shaft],
                    [w - head, shaft],
                    [w - head, 0],
                    [w, h / 2],
                    [w - head, h],
                    [w - head, h - shaft],
                    [0, h - shaft],
                ]),
            };
        },
    }),
    def({
        id: "arrow-left",
        name: "Arrow left",
        category: "Arrows",
        keywords: ["direction", "back"],
        defaultSize: { w: 160, h: 70 },
        minSize: { w: 30, h: 16 },
        textBox: (w, h) => ({ x: w * 0.32, y: h * 0.28, w: w * 0.6, h: h * 0.44 }),
        geometry: (w, h) => {
            const head = Math.min(w * 0.32, h);
            const shaft = h * 0.28;
            return {
                path: poly([
                    [w, shaft],
                    [head, shaft],
                    [head, 0],
                    [0, h / 2],
                    [head, h],
                    [head, h - shaft],
                    [w, h - shaft],
                ]),
            };
        },
    }),
    def({
        id: "arrow-up",
        name: "Arrow up",
        category: "Arrows",
        keywords: ["direction", "increase"],
        defaultSize: { w: 70, h: 160 },
        minSize: { w: 16, h: 30 },
        geometry: (w, h) => {
            const head = Math.min(h * 0.32, w);
            const shaft = w * 0.28;
            return {
                path: poly([
                    [shaft, h],
                    [shaft, head],
                    [0, head],
                    [w / 2, 0],
                    [w, head],
                    [w - shaft, head],
                    [w - shaft, h],
                ]),
            };
        },
    }),
    def({
        id: "arrow-down",
        name: "Arrow down",
        category: "Arrows",
        keywords: ["direction", "decrease"],
        defaultSize: { w: 70, h: 160 },
        minSize: { w: 16, h: 30 },
        geometry: (w, h) => {
            const head = Math.min(h * 0.32, w);
            const shaft = w * 0.28;
            return {
                path: poly([
                    [shaft, 0],
                    [shaft, h - head],
                    [0, h - head],
                    [w / 2, h],
                    [w, h - head],
                    [w - shaft, h - head],
                    [w - shaft, 0],
                ]),
            };
        },
    }),
    def({
        id: "arrow-double",
        name: "Double arrow",
        category: "Arrows",
        keywords: ["bidirectional", "both"],
        defaultSize: { w: 180, h: 70 },
        minSize: { w: 40, h: 16 },
        textBox: (w, h) => ({ x: w * 0.24, y: h * 0.28, w: w * 0.52, h: h * 0.44 }),
        geometry: (w, h) => {
            const head = Math.min(w * 0.22, h);
            const shaft = h * 0.28;
            return {
                path: poly([
                    [0, h / 2],
                    [head, 0],
                    [head, shaft],
                    [w - head, shaft],
                    [w - head, 0],
                    [w, h / 2],
                    [w - head, h],
                    [w - head, h - shaft],
                    [head, h - shaft],
                    [head, h],
                ]),
            };
        },
    }),
];

const FLOWCHART: ShapeDef[] = [
    def({
        id: "process",
        name: "Process",
        category: "Standard",
        keywords: ["step", "action", "rectangle"],
        paletteHidden: true,
        defaultSize: { w: 170, h: 84 },
        minSize: { w: 24, h: 20 },
        rounded: true,
        ports: ALL8,
        geometry: (w, h, r) => ({ path: roundedRect(w, h, r || 4) }),
    }),
    def({
        id: "decision",
        name: "Decision",
        category: "Standard",
        keywords: ["if", "branch", "diamond", "condition"],
        paletteHidden: true,
        defaultSize: { w: 170, h: 110 },
        minSize: { w: 40, h: 30 },
        textBox: (w, h) => ({ x: w * 0.2, y: h * 0.25, w: w * 0.6, h: h * 0.5 }),
        geometry: (w, h) => ({
            path: poly([
                [w / 2, 0],
                [w, h / 2],
                [w / 2, h],
                [0, h / 2],
            ]),
        }),
    }),
    def({
        id: "terminator",
        name: "Terminator",
        category: "Standard",
        keywords: ["start", "end", "stadium", "pill"],
        defaultSize: { w: 160, h: 66 },
        minSize: { w: 40, h: 24 },
        geometry: (w, h) => ({ path: roundedRect(w, h, h / 2) }),
    }),
    def({
        id: "data",
        name: "Data",
        category: "Standard",
        keywords: ["input", "output", "parallelogram", "io"],
        paletteHidden: true,
        defaultSize: { w: 175, h: 84 },
        minSize: { w: 40, h: 24 },
        geometry: (w, h) => ({
            path: poly([
                [w * 0.2, 0],
                [w, 0],
                [w * 0.8, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "document",
        name: "Document",
        category: "Standard",
        keywords: ["report", "page", "paper"],
        defaultSize: { w: 165, h: 100 },
        minSize: { w: 40, h: 34 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: TEXT_PAD, w: Math.max(w - 16, 0), h: h * 0.7 }),
        geometry: (w, h) => ({ path: waveBottom(w, h, Math.min(h * 0.18, 18)) }),
    }),
    def({
        id: "multi-document",
        name: "Multi-document",
        category: "Standard",
        keywords: ["reports", "stack", "copies"],
        defaultSize: { w: 170, h: 110 },
        minSize: { w: 40, h: 40 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: h * 0.18, w: Math.max(w - 24, 0), h: h * 0.55 }),
        geometry: (w, h) => {
            const off = Math.min(w * 0.05, 9);
            const bw = w - off * 2;
            const bh = h - off * 2;
            const amp = Math.min(bh * 0.18, 16);
            // Two offset ghost sheets sit behind the front document, so their
            // outlines peek out at the top-right without crossing its face.
            const sheet = (dx: number, dy: number) =>
                `M ${n(dx)} ${n(dy)} h ${n(bw)} v ${n(bh - amp)} q ${n(-bw * 0.25)} ${n(-amp * 1.2)} ${n(-bw * 0.5)} 0 q ${n(-bw * 0.25)} ${n(amp * 1.2)} ${n(-bw * 0.5)} 0 Z`;
            return {
                path: sheet(0, off * 2),
                backing: [sheet(off * 2, 0), sheet(off, off)],
            };
        },
    }),
    def({
        id: "predefined-process",
        name: "Predefined process",
        category: "Standard",
        keywords: ["subroutine", "function", "call"],
        defaultSize: { w: 175, h: 84 },
        minSize: { w: 44, h: 24 },
        textBox: (w, h) => ({ x: w * 0.14, y: TEXT_PAD, w: w * 0.72, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => {
            const k = Math.min(w * 0.1, 16);
            return {
                path: poly([
                    [0, 0],
                    [w, 0],
                    [w, h],
                    [0, h],
                ]),
                decorations: [
                    line([
                        [k, 0],
                        [k, h],
                    ]),
                    line([
                        [w - k, 0],
                        [w - k, h],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "internal-storage",
        name: "Internal storage",
        category: "Standard",
        keywords: ["memory", "register"],
        defaultSize: { w: 165, h: 100 },
        minSize: { w: 40, h: 34 },
        textBox: (w, h) => ({ x: w * 0.16, y: h * 0.24, w: w * 0.78, h: h * 0.68 }),
        geometry: (w, h) => {
            const kx = Math.min(w * 0.14, 22);
            const ky = Math.min(h * 0.2, 22);
            return {
                path: poly([
                    [0, 0],
                    [w, 0],
                    [w, h],
                    [0, h],
                ]),
                decorations: [
                    line([
                        [kx, 0],
                        [kx, h],
                    ]),
                    line([
                        [0, ky],
                        [w, ky],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "manual-input",
        name: "Manual input",
        category: "Standard",
        keywords: ["keyboard", "entry"],
        defaultSize: { w: 165, h: 90 },
        minSize: { w: 40, h: 30 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: h * 0.28, w: Math.max(w - 16, 0), h: h * 0.62 }),
        geometry: (w, h) => ({
            path: poly([
                [0, h * 0.24],
                [w, 0],
                [w, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "manual-operation",
        name: "Manual operation",
        category: "Standard",
        keywords: ["hand", "manual", "trapezoid"],
        defaultSize: { w: 170, h: 88 },
        minSize: { w: 40, h: 26 },
        geometry: (w, h) => ({
            path: poly([
                [0, 0],
                [w, 0],
                [w * 0.82, h],
                [w * 0.18, h],
            ]),
        }),
    }),
    def({
        id: "preparation",
        name: "Preparation",
        category: "Standard",
        keywords: ["setup", "init", "hexagon"],
        paletteHidden: true,
        defaultSize: { w: 175, h: 90 },
        minSize: { w: 44, h: 26 },
        textBox: (w, h) => ({ x: w * 0.18, y: TEXT_PAD, w: w * 0.64, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => ({
            path: poly([
                [w * 0.18, 0],
                [w * 0.82, 0],
                [w, h / 2],
                [w * 0.82, h],
                [w * 0.18, h],
                [0, h / 2],
            ]),
        }),
    }),
    def({
        id: "off-page-connector",
        name: "Off-page connector",
        category: "Standard",
        keywords: ["link", "continue", "pentagon"],
        defaultSize: { w: 110, h: 100 },
        minSize: { w: 30, h: 30 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: TEXT_PAD, w: Math.max(w - 16, 0), h: h * 0.62 }),
        geometry: (w, h) => ({
            path: poly([
                [0, 0],
                [w, 0],
                [w, h * 0.68],
                [w / 2, h],
                [0, h * 0.68],
            ]),
        }),
    }),
    def({
        id: "connector-dot",
        name: "Connector",
        category: "Standard",
        keywords: ["junction", "on-page", "circle"],
        paletteHidden: true,
        defaultSize: { w: 64, h: 64 },
        minSize: { w: 16, h: 16 },
        keepAspect: true,
        ports: ALL8,
        geometry: (w, h) => ({ path: ellipsePath(w, h) }),
    }),
    def({
        id: "database",
        name: "Database",
        category: "Standard",
        keywords: ["store", "sql", "cylinder", "disk"],
        defaultSize: { w: 130, h: 140 },
        minSize: { w: 32, h: 44 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: h * 0.26, w: Math.max(w - 16, 0), h: h * 0.56 }),
        geometry: (w, h) => {
            const ry = Math.min(h * 0.14, 22);
            return {
                path: [
                    `M 0 ${n(ry)}`,
                    `A ${n(w / 2)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)}`,
                    `V ${n(h - ry)}`,
                    `A ${n(w / 2)} ${n(ry)} 0 0 1 0 ${n(h - ry)}`,
                    "Z",
                ].join(" "),
                decorations: [`M 0 ${n(ry)} A ${n(w / 2)} ${n(ry)} 0 0 0 ${n(w)} ${n(ry)}`],
            };
        },
    }),
    def({
        id: "direct-data",
        name: "Direct data",
        category: "Standard",
        keywords: ["drum", "disk"],
        defaultSize: { w: 165, h: 100 },
        minSize: { w: 44, h: 30 },
        textBox: (w, h) => ({ x: w * 0.12, y: TEXT_PAD, w: w * 0.7, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => {
            const rx = Math.min(w * 0.14, 24);
            return {
                path: [
                    `M ${n(rx)} 0`,
                    `H ${n(w - rx)}`,
                    `A ${n(rx)} ${n(h / 2)} 0 0 1 ${n(w - rx)} ${n(h)}`,
                    `H ${n(rx)}`,
                    `A ${n(rx)} ${n(h / 2)} 0 0 1 ${n(rx)} 0`,
                    "Z",
                ].join(" "),
                decorations: [`M ${n(w - rx)} 0 A ${n(rx)} ${n(h / 2)} 0 0 0 ${n(w - rx)} ${n(h)}`],
            };
        },
    }),
    def({
        id: "stored-data",
        name: "Stored data",
        category: "Standard",
        keywords: ["archive", "tape"],
        defaultSize: { w: 165, h: 95 },
        minSize: { w: 44, h: 30 },
        textBox: (w, h) => ({ x: w * 0.14, y: TEXT_PAD, w: w * 0.74, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => {
            const rx = Math.min(w * 0.13, 22);
            return {
                path: [
                    `M ${n(rx)} 0`,
                    `H ${n(w)}`,
                    `A ${n(rx)} ${n(h / 2)} 0 0 0 ${n(w)} ${n(h)}`,
                    `H ${n(rx)}`,
                    `A ${n(rx)} ${n(h / 2)} 0 0 1 ${n(rx)} 0`,
                    "Z",
                ].join(" "),
            };
        },
    }),
    def({
        id: "display",
        name: "Display",
        category: "Standard",
        keywords: ["screen", "monitor", "output"],
        defaultSize: { w: 175, h: 90 },
        minSize: { w: 44, h: 30 },
        textBox: (w, h) => ({ x: w * 0.14, y: TEXT_PAD, w: w * 0.68, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => {
            const k = Math.min(w * 0.14, 24);
            return {
                path: [
                    `M ${n(k)} 0`,
                    `H ${n(w - k)}`,
                    `A ${n(k)} ${n(h / 2)} 0 0 1 ${n(w - k)} ${n(h)}`,
                    `H ${n(k)}`,
                    `L 0 ${n(h / 2)}`,
                    "Z",
                ].join(" "),
            };
        },
    }),
    def({
        id: "delay",
        name: "Delay",
        category: "Standard",
        keywords: ["wait", "pause"],
        defaultSize: { w: 165, h: 88 },
        minSize: { w: 44, h: 28 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: TEXT_PAD, w: w * 0.7, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => ({
            path: [
                `M 0 0`,
                `H ${n(w - h / 2)}`,
                `A ${n(h / 2)} ${n(h / 2)} 0 0 1 ${n(w - h / 2)} ${n(h)}`,
                `H 0`,
                "Z",
            ].join(" "),
        }),
    }),
    def({
        id: "merge",
        name: "Merge",
        category: "Standard",
        keywords: ["combine", "down triangle"],
        defaultSize: { w: 140, h: 90 },
        minSize: { w: 30, h: 24 },
        textBox: (w, h) => ({ x: w * 0.2, y: h * 0.08, w: w * 0.6, h: h * 0.45 }),
        geometry: (w, h) => ({
            path: poly([
                [0, 0],
                [w, 0],
                [w / 2, h],
            ]),
        }),
    }),
    def({
        id: "extract",
        name: "Extract",
        category: "Standard",
        keywords: ["split", "up triangle"],
        paletteHidden: true,
        defaultSize: { w: 140, h: 90 },
        minSize: { w: 30, h: 24 },
        textBox: (w, h) => ({ x: w * 0.2, y: h * 0.45, w: w * 0.6, h: h * 0.45 }),
        geometry: (w, h) => ({
            path: poly([
                [w / 2, 0],
                [w, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "or-junction",
        name: "Or",
        category: "Standard",
        keywords: ["logical", "circle", "cross"],
        defaultSize: { w: 70, h: 70 },
        minSize: { w: 20, h: 20 },
        keepAspect: true,
        geometry: (w, h) => ({
            path: ellipsePath(w, h),
            decorations: [
                line([
                    [0, h / 2],
                    [w, h / 2],
                ]),
                line([
                    [w / 2, 0],
                    [w / 2, h],
                ]),
            ],
        }),
    }),
    def({
        id: "summing-junction",
        name: "Summing junction",
        category: "Standard",
        keywords: ["and", "circle", "x"],
        defaultSize: { w: 70, h: 70 },
        minSize: { w: 20, h: 20 },
        keepAspect: true,
        geometry: (w, h) => {
            const k = 0.1465; // (1 - 1/√2) / 2 — where the diagonal meets the ellipse
            return {
                path: ellipsePath(w, h),
                decorations: [
                    line([
                        [w * k, h * k],
                        [w * (1 - k), h * (1 - k)],
                    ]),
                    line([
                        [w * (1 - k), h * k],
                        [w * k, h * (1 - k)],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "sort",
        name: "Sort",
        category: "Standard",
        keywords: ["order", "diamond"],
        defaultSize: { w: 150, h: 110 },
        minSize: { w: 30, h: 30 },
        textBox: (w, h) => ({ x: w * 0.22, y: h * 0.1, w: w * 0.56, h: h * 0.34 }),
        geometry: (w, h) => ({
            path: poly([
                [w / 2, 0],
                [w, h / 2],
                [w / 2, h],
                [0, h / 2],
            ]),
            decorations: [
                line([
                    [0, h / 2],
                    [w, h / 2],
                ]),
            ],
        }),
    }),
    def({
        id: "collate",
        name: "Collate",
        category: "Standard",
        keywords: ["hourglass", "gather"],
        defaultSize: { w: 130, h: 110 },
        minSize: { w: 30, h: 30 },
        chromeless: false,
        geometry: (w, h) => ({
            path: poly([
                [0, 0],
                [w, 0],
                [0, h],
                [w, h],
            ]),
        }),
    }),
    def({
        id: "loop-limit",
        name: "Loop limit",
        category: "Standard",
        keywords: ["for", "while", "repeat"],
        defaultSize: { w: 165, h: 88 },
        minSize: { w: 44, h: 28 },
        textBox: (w, h) => ({ x: TEXT_PAD, y: h * 0.2, w: Math.max(w - 16, 0), h: h * 0.7 }),
        geometry: (w, h) => {
            const k = Math.min(w * 0.14, h * 0.28);
            return {
                path: poly([
                    [k, 0],
                    [w - k, 0],
                    [w, k],
                    [w, h],
                    [0, h],
                    [0, k],
                ]),
            };
        },
    }),
];

/**
 * The shapes people reach for first: a box you type in and wire up. They lead
 * the palette because "which one makes a labelled box I can connect?" is the
 * question a blank canvas actually poses, and it used to be answerable only by
 * hovering sixty identical grey outlines.
 */
const NODES: ShapeDef[] = [
    def({
        id: "mind-root",
        name: "Central topic",
        category: "Nodes",
        keywords: ["root", "centre", "main idea", "node", "box", "container"],
        defaultSize: { w: 200, h: 76 },
        minSize: { w: 60, h: 32 },
        rounded: true,
        ports: ALL8,
        geometry: (w, h, r) => ({ path: roundedRect(w, h, r || Math.min(h / 2, 22)) }),
    }),
    def({
        id: "mind-branch",
        name: "Topic",
        category: "Nodes",
        keywords: ["branch", "node", "idea", "box", "container", "card", "label"],
        defaultSize: { w: 160, h: 56 },
        minSize: { w: 48, h: 26 },
        rounded: true,
        ports: ALL8,
        geometry: (w, h, r) => ({ path: roundedRect(w, h, r || 10) }),
    }),
    def({
        id: "mind-leaf",
        name: "Subtopic",
        category: "Nodes",
        keywords: ["leaf", "detail", "underline", "node"],
        defaultSize: { w: 140, h: 40 },
        minSize: { w: 40, h: 22 },
        ports: ["w", "e", "n", "s"],
        textBox: (w, h) => ({ x: 4, y: 2, w: Math.max(w - 8, 0), h: Math.max(h - 8, 0) }),
        geometry: (w, h) => ({
            path: "",
            decorations: [
                line([
                    [0, h],
                    [w, h],
                ]),
            ],
        }),
    }),
    def({
        id: "sticky",
        name: "Sticky note",
        category: "Nodes",
        keywords: ["post-it", "note", "memo", "node"],
        defaultSize: { w: 150, h: 150 },
        minSize: { w: 60, h: 60 },
        ports: ALL8,
        textBox: (w, h) => insetBox(w, h, 14),
        geometry: (w, h) => ({ path: roundedRect(w, h, 3) }),
    }),
];

/** Marks on the canvas rather than things in the diagram: they carry no text
 *  box worth connecting to, and auto-layout ignores them. */
const ANNOTATE: ShapeDef[] = [
    def({
        id: "text",
        name: "Text",
        category: "Annotate",
        keywords: ["label", "caption", "type"],
        defaultSize: { w: 180, h: 44 },
        minSize: { w: 24, h: 18 },
        chromeless: true,
        textBox: (w, h) => ({ x: 2, y: 2, w: Math.max(w - 4, 0), h: Math.max(h - 4, 0) }),
        geometry: () => ({ path: "" }),
    }),
    def({
        id: "image",
        name: "Image",
        category: "Annotate",
        holdsText: false,
        keywords: ["picture", "photo", "screenshot"],
        defaultSize: { w: 220, h: 160 },
        minSize: { w: 24, h: 24 },
        chromeless: true,
        ports: ALL8,
        geometry: (w, h, r) => ({ path: roundedRect(w, h, r || 0) }),
    }),
    def({
        id: "ink",
        name: "Ink",
        category: "Annotate",
        holdsText: false,
        keywords: ["pen", "draw", "freehand", "scribble"],
        defaultSize: { w: 160, h: 120 },
        minSize: { w: 4, h: 4 },
        chromeless: true,
        geometry: () => ({ path: "" }),
    }),
    def({
        id: "line",
        name: "Line",
        category: "Annotate",
        holdsText: false,
        keywords: ["rule", "divider", "separator"],
        defaultSize: { w: 200, h: 2 },
        minSize: { w: 8, h: 1 },
        chromeless: true,
        geometry: (w, h) => ({
            path: "",
            decorations: [
                line([
                    [0, h / 2],
                    [w, h / 2],
                ]),
            ],
        }),
    }),
];

const UML: ShapeDef[] = [
    def({
        id: "uml-class",
        name: "Class",
        category: "UML & ERD",
        keywords: ["uml", "object", "type"],
        defaultSize: { w: 190, h: 130 },
        minSize: { w: 80, h: 60 },
        textBox: (w, h) => ({
            x: TEXT_PAD,
            y: 4,
            w: Math.max(w - 16, 0),
            h: Math.min(h * 0.28, 32),
        }),
        geometry: (w, h) => {
            const head = Math.min(h * 0.28, 34);
            const mid = head + Math.max((h - head) * 0.45, 0);
            return {
                path: poly([
                    [0, 0],
                    [w, 0],
                    [w, h],
                    [0, h],
                ]),
                decorations: [
                    line([
                        [0, head],
                        [w, head],
                    ]),
                    line([
                        [0, mid],
                        [w, mid],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "uml-actor",
        name: "Actor",
        category: "UML & ERD",
        keywords: ["uml", "person", "user", "stick figure"],
        defaultSize: { w: 80, h: 130 },
        minSize: { w: 30, h: 50 },
        keepAspect: true,
        chromeless: true,
        textBox: (w, h) => ({ x: -20, y: h, w: w + 40, h: 24 }),
        geometry: (w, h) => {
            const headR = Math.min(w * 0.28, h * 0.16);
            const cx = w / 2;
            const headCy = headR;
            const bodyTop = headR * 2;
            const bodyBottom = h * 0.62;
            return {
                path: "",
                decorations: [
                    `M ${n(cx - headR)} ${n(headCy)} a ${n(headR)} ${n(headR)} 0 1 0 ${n(headR * 2)} 0 a ${n(headR)} ${n(headR)} 0 1 0 ${n(-headR * 2)} 0`,
                    line([
                        [cx, bodyTop],
                        [cx, bodyBottom],
                    ]),
                    line([
                        [0, h * 0.36],
                        [w, h * 0.36],
                    ]),
                    line([
                        [cx, bodyBottom],
                        [0, h],
                    ]),
                    line([
                        [cx, bodyBottom],
                        [w, h],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "uml-note",
        name: "Note",
        category: "UML & ERD",
        keywords: ["uml", "comment", "annotation", "fold"],
        defaultSize: { w: 170, h: 100 },
        minSize: { w: 50, h: 40 },
        textBox: (w, h) => ({
            x: TEXT_PAD,
            y: TEXT_PAD,
            w: Math.max(w - 24, 0),
            h: Math.max(h - 16, 0),
        }),
        geometry: (w, h) => {
            const k = Math.min(w * 0.16, h * 0.28, 24);
            return {
                path: poly([
                    [0, 0],
                    [w - k, 0],
                    [w, k],
                    [w, h],
                    [0, h],
                ]),
                decorations: [
                    line([
                        [w - k, 0],
                        [w - k, k],
                        [w, k],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "uml-package",
        name: "Package",
        category: "UML & ERD",
        keywords: ["uml", "namespace", "module", "folder"],
        defaultSize: { w: 180, h: 120 },
        minSize: { w: 60, h: 50 },
        container: true,
        textBox: (w, h) => ({ x: 6, y: 2, w: Math.min(w * 0.45, 120), h: Math.min(h * 0.2, 24) }),
        geometry: (w, h) => {
            const tabW = Math.min(w * 0.45, 110);
            const tabH = Math.min(h * 0.2, 26);
            return {
                path: `${poly([
                    [0, 0],
                    [tabW, 0],
                    [tabW, tabH],
                    [w, tabH],
                    [w, h],
                    [0, h],
                ])}`,
            };
        },
    }),
    def({
        id: "uml-component",
        name: "Component",
        category: "UML & ERD",
        keywords: ["uml", "module", "service"],
        defaultSize: { w: 180, h: 100 },
        minSize: { w: 60, h: 44 },
        textBox: (w, h) => ({ x: w * 0.14, y: TEXT_PAD, w: w * 0.8, h: Math.max(h - 16, 0) }),
        geometry: (w, h) => {
            const tw = Math.min(w * 0.16, 26);
            const th = Math.min(h * 0.18, 16);
            return {
                path: poly([
                    [0, 0],
                    [w, 0],
                    [w, h],
                    [0, h],
                ]),
                // The two tabs straddle the left edge; painting them behind the
                // body hides their inner halves without a second fill colour.
                backing: [
                    poly([
                        [-tw / 2, h * 0.24],
                        [tw / 2, h * 0.24],
                        [tw / 2, h * 0.24 + th],
                        [-tw / 2, h * 0.24 + th],
                    ]),
                    poly([
                        [-tw / 2, h * 0.6],
                        [tw / 2, h * 0.6],
                        [tw / 2, h * 0.6 + th],
                        [-tw / 2, h * 0.6 + th],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "uml-interface",
        name: "Interface",
        category: "UML & ERD",
        keywords: ["uml", "lollipop", "provided"],
        defaultSize: { w: 80, h: 80 },
        minSize: { w: 24, h: 24 },
        keepAspect: true,
        textBox: (w, h) => ({ x: -30, y: h, w: w + 60, h: 22 }),
        geometry: (w, h) => ({ path: ellipsePath(w, h) }),
    }),
    def({
        id: "erd-entity",
        name: "Entity",
        category: "UML & ERD",
        keywords: ["erd", "table", "database", "schema"],
        defaultSize: { w: 200, h: 140 },
        minSize: { w: 80, h: 60 },
        rounded: true,
        textBox: (w, h) => ({
            x: TEXT_PAD,
            y: 4,
            w: Math.max(w - 16, 0),
            h: Math.min(h * 0.26, 30),
        }),
        geometry: (w, h, r) => {
            const head = Math.min(h * 0.26, 32);
            return {
                path: roundedRect(w, h, r || 6),
                decorations: [
                    line([
                        [0, head],
                        [w, head],
                    ]),
                ],
            };
        },
    }),
];

const CONTAINERS: ShapeDef[] = [
    def({
        id: "group",
        name: "Group",
        category: "Containers",
        keywords: ["cluster", "bundle"],
        defaultSize: { w: 240, h: 160 },
        minSize: { w: 20, h: 20 },
        container: true,
        chromeless: true,
        geometry: (w, h) => ({
            path: poly([
                [0, 0],
                [w, 0],
                [w, h],
                [0, h],
            ]),
        }),
    }),
    def({
        id: "frame",
        name: "Frame",
        category: "Containers",
        keywords: ["board", "section", "area", "artboard"],
        defaultSize: { w: 420, h: 300 },
        minSize: { w: 60, h: 60 },
        container: true,
        rounded: true,
        textBox: w => ({ x: 0, y: -26, w, h: 22 }),
        geometry: (w, h, r) => ({ path: roundedRect(w, h, r || 8) }),
    }),
    def({
        id: "swimlane-h",
        name: "Swimlane (rows)",
        category: "Containers",
        keywords: ["pool", "lane", "process", "responsibility"],
        defaultSize: { w: 620, h: 260 },
        minSize: { w: 120, h: 80 },
        container: true,
        textBox: w => ({ x: 2, y: 2, w: Math.min(w, 160), h: 26 }),
        geometry: (w, h) => {
            const header = Math.min(h * 0.16, 34);
            return {
                path: poly([
                    [0, 0],
                    [w, 0],
                    [w, h],
                    [0, h],
                ]),
                decorations: [
                    line([
                        [0, header],
                        [w, header],
                    ]),
                ],
            };
        },
    }),
    def({
        id: "swimlane-v",
        name: "Swimlane (columns)",
        category: "Containers",
        keywords: ["pool", "lane", "kanban", "column"],
        defaultSize: { w: 280, h: 520 },
        minSize: { w: 80, h: 120 },
        container: true,
        textBox: w => ({ x: 2, y: 4, w, h: 26 }),
        geometry: (w, h) => {
            const header = Math.min(h * 0.08, 34);
            return {
                path: poly([
                    [0, 0],
                    [w, 0],
                    [w, h],
                    [0, h],
                ]),
                decorations: [
                    line([
                        [0, header],
                        [w, header],
                    ]),
                ],
            };
        },
    }),
];

export const SHAPES: readonly ShapeDef[] = [
    ...BASIC,
    ...ARROWS,
    ...FLOWCHART,
    ...NODES,
    ...ANNOTATE,
    ...UML,
    ...CONTAINERS,
];

export const SHAPE_BY_ID: Record<string, ShapeDef> = Object.fromEntries(SHAPES.map(s => [s.id, s]));

export const SHAPE_CATEGORIES: readonly ShapeCategory[] = [
    "Nodes",
    "Annotate",
    "Standard",
    "Arrows",
    "UML & ERD",
    "Containers",
];

/** Never throws: an unknown shape id degrades to a plain rectangle. */
export function shapeDef(id: string): ShapeDef {
    return SHAPE_BY_ID[id] ?? SHAPE_BY_ID.rectangle!;
}

export function shapeGeometry(id: string, w: number, h: number, radius = 0): ShapeGeometry {
    return shapeDef(id).geometry(Math.max(w, 0.01), Math.max(h, 0.01), radius);
}

/**
 * Does this shape carry a label? Drives whether placing one drops you straight
 * into its text editor, so a newly created box behaves like the container it
 * looks like instead of sitting there empty.
 */
export function shapeHoldsText(id: string): boolean {
    return shapeDef(id).holdsText !== false;
}

/** Local-space text area for a shape, honouring per-shape overrides. */
export function shapeTextBox(id: string, w: number, h: number): Rect {
    const d = shapeDef(id);
    return d.textBox ? d.textBox(w, h) : insetBox(w, h);
}

export function shapePorts(id: string): readonly Exclude<PortId, "auto">[] {
    return shapeDef(id).ports ?? DEFAULT_PORTS;
}

export function isContainer(id: string): boolean {
    return shapeDef(id).container === true;
}

/** Free-text search over name + keywords, used by the palette filter.
 *  Hidden duplicates never match: their keywords live on the offered tile. */
export function searchShapes(query: string): ShapeDef[] {
    const offered = SHAPES.filter(s => !s.paletteHidden);
    const q = query.trim().toLowerCase();
    if (!q) return offered;
    return offered.filter(
        s =>
            s.name.toLowerCase().includes(q) ||
            s.id.includes(q) ||
            s.keywords.some(k => k.includes(q))
    );
}
