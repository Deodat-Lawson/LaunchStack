/**
 * Mindmap document model.
 *
 * One `MindmapDoc` is the whole file: an ordered list of pages, each holding
 * nodes (shapes) and edges (connectors). Everything is plain JSON so a doc
 * round-trips through `jsonb` without a custom serializer, and the pure
 * geometry/layout/routing modules can be unit-tested with no DOM.
 *
 * Z-order is array order: `page.nodes[0]` paints first (back), the last entry
 * paints last (front). Edges paint in their own band between the two — see
 * `Canvas`.
 *
 * Colors are stored as CSS color strings. New documents are seeded with OKLCH
 * literals from `palette.ts` (never hex — see apps/web/README.md), but a doc
 * imported from elsewhere may legitimately carry any CSS color.
 */

export const DOC_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    w: number;
    h: number;
}

export interface Rect extends Point, Size {}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export type StrokeStyle = "solid" | "dashed" | "dotted";

export interface NodeStyle {
    /** CSS color, or `"none"` for an unfilled shape. */
    fill: string;
    stroke: string;
    strokeWidth: number;
    strokeStyle: StrokeStyle;
    /** 0–1. Applies to the whole node including its text. */
    opacity: number;
    /** Corner radius in px; only honoured by shapes that declare `rounded`. */
    radius: number;
    shadow: boolean;
}

export type FontFamily = "sans" | "serif" | "mono";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export interface TextStyle {
    color: string;
    size: number;
    family: FontFamily;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    align: HAlign;
    valign: VAlign;
    /** Multiplier on font size. */
    lineHeight: number;
    /** Rendered above the shape instead of inside it (mindmap leaf labels). */
    outside?: boolean;
}

export interface EdgeStyle {
    stroke: string;
    strokeWidth: number;
    strokeStyle: StrokeStyle;
    opacity: number;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * Anchor position on a node's bounding box, expressed as unit fractions so a
 * port survives resizing. Named ports resolve through `PORT_PRESETS`.
 */
export type PortId = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw" | "c" | "auto";

export interface NodeData {
    /** `image` shapes: object URL or data URI. */
    src?: string;
    /** `image` shapes: alt text. */
    alt?: string;
    /** Any shape: click-through link. */
    href?: string;
    /** `swimlane` shapes: header band thickness in px. */
    laneHeader?: number;
    /** Freehand ink: stroke points in node-local space (0–1 of w/h). */
    points?: Point[];
    /** Mindmap nodes: depth from the root, drives auto-styling and layout. */
    depth?: number;
    /** Emoji/icon badge rendered in the corner of the shape. */
    badge?: string;
    /** Progress 0–1, rendered as a bar under the label (task nodes). */
    progress?: number;
}

export interface DiagramNode {
    id: string;
    shape: ShapeId;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Degrees, clockwise, about the node centre. */
    rotation: number;
    text: string;
    style: NodeStyle;
    textStyle: TextStyle;
    /** Group or container this node belongs to. Groups nest arbitrarily. */
    parentId: string | null;
    locked: boolean;
    hidden: boolean;
    /** Mindmap/tree: hide the subtree hanging off this node. */
    collapsed?: boolean;
    data?: NodeData;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export type EdgeKind = "straight" | "elbow" | "curved";

export type ArrowId =
    | "none"
    | "arrow"
    | "arrow-open"
    | "triangle-hollow"
    | "diamond"
    | "diamond-hollow"
    | "circle"
    | "circle-hollow"
    | "bar"
    | "crowfoot-one"
    | "crowfoot-many"
    | "crowfoot-one-many"
    | "crowfoot-zero-one"
    | "crowfoot-zero-many";

export interface Endpoint {
    /** Attached endpoint — follows the node as it moves. */
    nodeId?: string;
    /** Which anchor on that node; `auto` picks the nearest sensible side. */
    port?: PortId;
    /** Free endpoint, in world coordinates. Used when `nodeId` is absent. */
    point?: Point;
}

export interface EdgeLabel {
    text: string;
    /** Position along the routed path, 0 (start) → 1 (end). */
    t: number;
    /** Perpendicular offset from the path in px. */
    offset: number;
}

export interface DiagramEdge {
    id: string;
    from: Endpoint;
    to: Endpoint;
    kind: EdgeKind;
    /** User-dragged intermediate points, in world coordinates. */
    waypoints: Point[];
    style: EdgeStyle;
    startArrow: ArrowId;
    endArrow: ArrowId;
    labels: EdgeLabel[];
    textStyle: TextStyle;
    locked: boolean;
    hidden: boolean;
}

// ---------------------------------------------------------------------------
// Pages + document
// ---------------------------------------------------------------------------

export type BackgroundPattern = "plain" | "grid" | "dots" | "lines";

export interface PageBackground {
    color: string;
    pattern: BackgroundPattern;
    /** Grid/dot spacing in world px. */
    spacing: number;
}

export interface DiagramPage {
    id: string;
    name: string;
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    background: PageBackground;
}

export interface DocComment {
    id: string;
    /** Node the thread is pinned to, or null for a canvas-pinned thread. */
    nodeId: string | null;
    pageId: string;
    /** World coordinates for canvas-pinned threads. */
    x: number;
    y: number;
    author: string;
    body: string;
    resolved: boolean;
    createdAt: string;
    replies: DocCommentReply[];
}

export interface DocCommentReply {
    id: string;
    author: string;
    body: string;
    createdAt: string;
}

export interface MindmapDoc {
    /** Bumped when the on-disk shape changes; `migrateDoc` upgrades old docs. */
    schemaVersion: number;
    title: string;
    pages: DiagramPage[];
    activePageId: string;
    comments: DocComment[];
    /** Editor preferences that belong to the file, not the user. */
    settings: DocSettings;
}

export interface DocSettings {
    snapToGrid: boolean;
    snapToObjects: boolean;
    gridSize: number;
    showGrid: boolean;
    showRulers: boolean;
    /** Default connector kind for newly drawn edges. */
    defaultEdgeKind: EdgeKind;
    /** Theme applied to freshly inserted shapes. */
    paletteId: string;
}

// ---------------------------------------------------------------------------
// Shape ids
// ---------------------------------------------------------------------------

/**
 * Every shape the palette can insert. Keep in sync with `SHAPES` in
 * `shapes.ts` — `assertShapeRegistryComplete` fails the unit suite otherwise.
 */
export type ShapeId =
    // Basic
    | "rectangle"
    | "rounded-rectangle"
    | "ellipse"
    | "circle"
    | "diamond"
    | "triangle"
    | "right-triangle"
    | "pentagon"
    | "hexagon"
    | "octagon"
    | "trapezoid"
    | "parallelogram"
    | "star"
    | "cross"
    | "cylinder"
    | "cloud"
    | "callout"
    | "chevron"
    | "arrow-right"
    | "arrow-left"
    | "arrow-up"
    | "arrow-down"
    | "arrow-double"
    | "bracket-pair"
    // Flowchart
    | "process"
    | "decision"
    | "terminator"
    | "data"
    | "document"
    | "multi-document"
    | "predefined-process"
    | "internal-storage"
    | "manual-input"
    | "manual-operation"
    | "preparation"
    | "off-page-connector"
    | "connector-dot"
    | "database"
    | "direct-data"
    | "stored-data"
    | "display"
    | "delay"
    | "merge"
    | "extract"
    | "or-junction"
    | "summing-junction"
    | "sort"
    | "collate"
    | "loop-limit"
    // Mindmap / whiteboard
    | "mind-root"
    | "mind-branch"
    | "mind-leaf"
    | "sticky"
    | "text"
    | "image"
    | "ink"
    | "line"
    // UML / ERD
    | "uml-class"
    | "uml-actor"
    | "uml-note"
    | "uml-package"
    | "uml-component"
    | "uml-interface"
    | "erd-entity"
    // Containers
    | "group"
    | "frame"
    | "swimlane-h"
    | "swimlane-v";

export type ShapeCategory =
    | "Basic"
    | "Flowchart"
    | "Mindmap"
    | "UML & ERD"
    | "Containers"
    | "Arrows";

// ---------------------------------------------------------------------------
// Selection + tools (editor-side, not persisted)
// ---------------------------------------------------------------------------

export type ToolId =
    | "select"
    | "hand"
    | "connector"
    | "text"
    | "sticky"
    | "frame"
    | "ink"
    | "eraser"
    | "shape";

export interface Viewport {
    /** World coordinate rendered at the canvas origin. */
    x: number;
    y: number;
    zoom: number;
}

export type SelectionKind = "node" | "edge";

export interface SelectionRef {
    kind: SelectionKind;
    id: string;
}
