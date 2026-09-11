"use client";

import React, { memo, useMemo, useRef } from "react";

import { toggleCollapse } from "../model/commands";
import { graphIndex, nodeById, nodeLookup, visibleEdges, visibleNodes } from "../model/doc";
import { nodeBounds, nodesBounds } from "../model/geometry";
import { routeEdgeCached, type RoutedEdge } from "../model/routing";
import { isDarkSurface } from "../model/palette";
import { shapeDef } from "../model/shapes";
import type { EditorState } from "../model/store";
import type { DiagramEdge, DiagramNode, Point, Rect } from "../model/types";
import { EdgeView, HIT_WIDTH } from "./EdgeView";
import { useEditor, useStore } from "./EditorContext";
import { RemoteCursors, RemoteSelections } from "./PresenceLayer";
import { Rulers } from "./Rulers";
import type { PresencePeer } from "./usePresence";
import { NodePorts, SelectionOverlay } from "./SelectionOverlay";
import { CanvasDefs, ShapeView } from "./ShapeView";
import { useCanvasInteractions, type CanvasCallbacks } from "./useCanvasInteractions";
import { useElementSize } from "./useElementSize";
import styles from "./Canvas.module.css";

/**
 * The drawing surface.
 *
 * One `<svg>` whose `viewBox` *is* the viewport — panning and zooming change
 * four numbers and the browser does the rest, which keeps text crisp at every
 * zoom level and makes the SVG export a straight clone of what is on screen.
 *
 * Paint order is deliberate: background, connectors, shapes, then chrome.
 * Connectors under shapes is what makes a line entering a box look like it
 * stops at the border rather than crossing it.
 */

interface CanvasProps {
    callbacks: CanvasCallbacks;
    /** Other people currently in this document. */
    peers?: PresencePeer[];
    /** Reports this client's pointer in world coordinates, for presence. */
    onCursorMove?: (point: Point | null) => void;
    /** Rendered above the SVG (text editor, comment composer). */
    children?: React.ReactNode;
}

const selectDoc = (s: EditorState) => s.doc;
const selectSelection = (s: EditorState) => s.selection;

const selectRenderState = (s: EditorState) => ({
    viewport: s.viewport,
    tool: s.tool,
    drag: s.drag,
    marquee: s.marquee,
    guides: s.guides,
    hoverNodeId: s.hoverNodeId,
    hoverEdgeId: s.hoverEdgeId,
    editing: s.editing,
    highlighted: s.highlighted,
    presenting: s.presenting,
});

export function Canvas({ callbacks, peers, onCursorMove, children }: CanvasProps) {
    const store = useStore();
    const svgRef = useRef<SVGSVGElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const size = useElementSize(wrapRef);

    const doc = useEditor(selectDoc);
    const selection = useEditor(selectSelection);
    const render = useEditor(selectRenderState, shallowEqualRenderState);
    const interactions = useCanvasInteractions(store, svgRef, callbacks);

    const page = useMemo(
        () => doc.pages.find(p => p.id === doc.activePageId) ?? doc.pages[0]!,
        [doc]
    );

    const nodes = useMemo(() => visibleNodes(page), [page]);
    const edges = useMemo(() => visibleEdges(page), [page]);
    const lookup = useMemo(() => nodeLookup(page), [page]);
    // `routeEdgeCached` returns the previous `RoutedEdge` object for any edge
    // whose own inputs did not change, so this Map is rebuilt each frame but
    // its *values* stay identical — which is what lets `EdgeView`'s memo hit.
    const routed = useMemo(() => {
        const map = new Map<string, RoutedEdge>();
        for (const e of edges) map.set(e.id, routeEdgeCached(e, lookup));
        return map;
    }, [edges, lookup]);

    const childCounts = useMemo(() => {
        const idx = graphIndex(page);
        const counts = new Map<string, number>();
        for (const nd of page.nodes) {
            const kids = idx.out.get(nd.id);
            if (kids && kids.length > 0) counts.set(nd.id, kids.length);
        }
        return counts;
    }, [page]);

    const selectedNodeIds = useMemo(
        () => new Set(selection.filter(s => s.kind === "node").map(s => s.id)),
        [selection]
    );
    const selectedEdgeIds = useMemo(
        () => new Set(selection.filter(s => s.kind === "edge").map(s => s.id)),
        [selection]
    );
    const selectedNodes = useMemo(
        () => nodes.filter(nd => selectedNodeIds.has(nd.id)),
        [nodes, selectedNodeIds]
    );

    const { viewport } = render;
    const viewBox = `${viewport.x} ${viewport.y} ${Math.max(size.w, 1) / viewport.zoom} ${
        Math.max(size.h, 1) / viewport.zoom
    }`;

    const interacting = render.drag.kind !== "none";
    const highlighted = useMemo(() => new Set(render.highlighted), [render.highlighted]);

    // Ports appear for the hovered shape and for a lone selected shape; showing
    // them for a whole multi-selection turns the canvas into confetti.
    const portNodes = useMemo(() => {
        if (render.presenting || interacting) {
            return render.drag.kind === "connect" ? nodes.filter(nd => !nd.locked) : [];
        }
        const ids = new Set<string>();
        if (render.hoverNodeId) ids.add(render.hoverNodeId);
        if (selectedNodes.length === 1 && selectedNodes[0]) ids.add(selectedNodes[0].id);
        return nodes.filter(nd => ids.has(nd.id));
    }, [
        interacting,
        nodes,
        render.drag.kind,
        render.hoverNodeId,
        render.presenting,
        selectedNodes,
    ]);

    const comments = useMemo(
        () => doc.comments.filter(c => c.pageId === page.id && !c.resolved),
        [doc.comments, page.id]
    );

    const nodeBoundsById = useMemo(() => {
        const map = new Map<string, Rect>();
        for (const nd of nodes) map.set(nd.id, nodeBounds(nd));
        return map;
    }, [nodes]);

    const darkPaper = useMemo(() => isDarkSurface(page.background.color), [page.background.color]);
    const showRulers = doc.settings.showRulers && !render.presenting;
    const selectionRect = useMemo(
        () => (selectedNodes.length > 0 ? nodesBounds(selectedNodes) : null),
        [selectedNodes]
    );

    return (
        <div
            ref={wrapRef}
            style={{
                position: "relative",
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
                background: page.background.color,
            }}
        >
            <svg
                ref={svgRef}
                className={styles.paper}
                // Canvas chrome is bound to the paper, not to the app theme —
                // read from the background's own lightness so a custom colour
                // works as well as a named theme.
                data-paper={darkPaper ? "dark" : "light"}
                width="100%"
                height="100%"
                viewBox={viewBox}
                style={{
                    // Absolute, so the canvas can only ever *read* its size and
                    // never set it. An in-flow `<svg>` with a viewBox is
                    // intrinsically sized: put one in a parent whose own height
                    // is content-derived and the two size each other in a loop
                    // that settles at whatever the viewBox aspect ratio asks
                    // for. Taking it out of flow makes that unrepresentable —
                    // the wrapper's `flex: 1` is then the only thing with a say.
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    touchAction: "none",
                    cursor: cursorFor(render.tool, interactions.isPanning(), render.drag.kind),
                }}
                onPointerDown={interactions.onPointerDown}
                onPointerMove={e => {
                    interactions.onPointerMove(e);
                    onCursorMove?.(interactions.toWorld(e.clientX, e.clientY));
                }}
                onPointerLeave={() => onCursorMove?.(null)}
                onPointerUp={interactions.onPointerUp}
                onPointerCancel={interactions.onPointerUp}
                onWheel={interactions.onWheel}
                onDoubleClick={interactions.onDoubleClick}
                onContextMenu={interactions.onContextMenu}
            >
                <CanvasDefs />
                <BackgroundGrid
                    pattern={doc.settings.showGrid ? page.background.pattern : "plain"}
                    spacing={page.background.spacing}
                    viewport={viewport}
                    size={size}
                />

                {/* Connectors */}
                <g>
                    {edges.map(edge => {
                        const r = routed.get(edge.id);
                        if (!r) return null;
                        return (
                            <g key={edge.id} data-edge-id={edge.id}>
                                <path
                                    d={r.path}
                                    fill="none"
                                    stroke="transparent"
                                    strokeWidth={HIT_WIDTH / viewport.zoom}
                                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                                />
                                <EdgeView
                                    edge={edge}
                                    routed={r}
                                    selected={selectedEdgeIds.has(edge.id)}
                                    hovered={render.hoverEdgeId === edge.id}
                                    editingLabelIndex={
                                        render.editing?.kind === "edge-label" &&
                                        render.editing.id === edge.id
                                            ? (render.editing.index ?? 0)
                                            : undefined
                                    }
                                />
                            </g>
                        );
                    })}
                </g>

                {/* Shapes */}
                <g>
                    {nodes.map(node => (
                        <NodeHit
                            key={node.id}
                            node={node}
                            hideText={
                                render.editing?.kind === "node" && render.editing.id === node.id
                            }
                            highlighted={highlighted.has(node.id)}
                            zoom={viewport.zoom}
                        />
                    ))}
                </g>

                {/* Chrome. `data-export="omit"` keeps all of it out of exports. */}
                {!render.presenting && (
                    <g data-export="omit">
                        <g>
                            {[...childCounts.entries()].map(([nodeId, count]) => {
                                const node = nodeById(page, nodeId);
                                if (!node) return null;
                                return (
                                    <CollapseToggle
                                        key={nodeId}
                                        node={node}
                                        count={count}
                                        zoom={viewport.zoom}
                                        onToggle={() => toggleCollapse(store, nodeId)}
                                    />
                                );
                            })}
                        </g>

                        <SelectionOverlay
                            nodes={selectedNodes}
                            zoom={viewport.zoom}
                            interacting={interacting}
                        />

                        <g>
                            {portNodes.map(nd => (
                                <NodePorts
                                    key={nd.id}
                                    node={nd}
                                    zoom={viewport.zoom}
                                    activePort={
                                        render.drag.kind === "connect" &&
                                        render.drag.hoverNodeId === nd.id
                                            ? render.drag.hoverPort
                                            : null
                                    }
                                />
                            ))}
                        </g>

                        <EdgeHandles
                            edges={edges.filter(e => selectedEdgeIds.has(e.id))}
                            routed={routed}
                            zoom={viewport.zoom}
                        />

                        {render.drag.kind === "connect" && (
                            <ConnectDraft drag={render.drag} zoom={viewport.zoom} />
                        )}

                        {render.marquee && (
                            <rect
                                x={render.marquee.x}
                                y={render.marquee.y}
                                width={render.marquee.w}
                                height={render.marquee.h}
                                fill="var(--accent)"
                                fillOpacity={0.08}
                                stroke="var(--accent)"
                                strokeWidth={1 / viewport.zoom}
                                style={{ pointerEvents: "none" }}
                            />
                        )}

                        <Guides guides={render.guides} zoom={viewport.zoom} />

                        {peers && peers.length > 0 && (
                            <>
                                <RemoteSelections
                                    peers={peers}
                                    pageId={page.id}
                                    bounds={id => nodeBoundsById.get(id) ?? null}
                                    zoom={viewport.zoom}
                                />
                                <RemoteCursors
                                    peers={peers}
                                    pageId={page.id}
                                    zoom={viewport.zoom}
                                />
                            </>
                        )}

                        <g>
                            {comments.map(c => {
                                const anchor = c.nodeId ? nodeById(page, c.nodeId) : null;
                                const at: Point = anchor
                                    ? { x: anchor.x + anchor.w, y: anchor.y }
                                    : { x: c.x, y: c.y };
                                return (
                                    <CommentPin
                                        key={c.id}
                                        at={at}
                                        zoom={viewport.zoom}
                                        replies={c.replies.length}
                                        onOpen={() => {
                                            if (c.nodeId) store.selectNodes([c.nodeId]);
                                            callbacks.onOpenComments?.();
                                        }}
                                    />
                                );
                            })}
                        </g>
                    </g>
                )}
            </svg>
            {showRulers && <Rulers viewport={viewport} size={size} selection={selectionRect} />}
            {children}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * A shape plus its click target. Chromeless shapes (text, ink, brackets) have
 * no fill to hit, so they get an invisible rect — otherwise a text label would
 * only be selectable by its glyphs.
 */
const NodeHit = memo(function NodeHit({
    node,
    hideText,
    highlighted,
    zoom,
}: {
    node: DiagramNode;
    hideText: boolean;
    highlighted: boolean;
    zoom: number;
}) {
    const def = shapeDef(node.shape);
    const transform = node.rotation
        ? `translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.w / 2} ${node.h / 2})`
        : `translate(${node.x} ${node.y})`;

    return (
        <g data-node-id={node.id} style={{ pointerEvents: node.locked ? "none" : "all" }}>
            {highlighted && (
                <rect
                    x={node.x - 6}
                    y={node.y - 6}
                    width={node.w + 12}
                    height={node.h + 12}
                    rx={8}
                    fill="var(--warn)"
                    fillOpacity={0.22}
                    stroke="var(--warn)"
                    strokeWidth={1.5 / zoom}
                    style={{ pointerEvents: "none" }}
                />
            )}
            {(def.chromeless === true || node.style.fill === "none") && (
                <g transform={transform}>
                    <rect width={node.w} height={node.h} fill="transparent" />
                </g>
            )}
            <ShapeView node={node} hideText={hideText} />
            {node.locked && <LockBadge node={node} zoom={zoom} />}
        </g>
    );
});

/**
 * Icons on the canvas are hand-drawn paths rather than lucide components: a
 * nested `<svg>` inside the canvas would not inherit the world transform, and
 * these have to scale with zoom like every other piece of chrome.
 */
function LockBadge({ node, zoom }: { node: DiagramNode; zoom: number }) {
    const px = (v: number) => v / zoom;
    const x = node.x + node.w - px(14);
    const y = node.y + px(4);
    return (
        <g transform={`translate(${x} ${y})`} style={{ pointerEvents: "none" }}>
            <rect
                x={0}
                y={px(4)}
                width={px(10)}
                height={px(7)}
                rx={px(1.5)}
                fill="var(--ink-3)"
                fillOpacity={0.75}
            />
            <path
                d={`M ${px(2.5)} ${px(4)} v ${px(-1.5)} a ${px(2.5)} ${px(2.5)} 0 0 1 ${px(5)} 0 v ${px(1.5)}`}
                fill="none"
                stroke="var(--ink-3)"
                strokeWidth={px(1.4)}
            />
        </g>
    );
}

function CollapseToggle({
    node,
    count,
    zoom,
    onToggle,
}: {
    node: DiagramNode;
    count: number;
    zoom: number;
    onToggle: () => void;
}) {
    const px = (v: number) => v / zoom;
    const cx = node.x + node.w + px(11);
    const cy = node.y + node.h / 2;
    // A plus when collapsed (there is more to see), a minus when expanded.
    const glyph = node.collapsed
        ? `M ${cx - px(4)} ${cy} h ${px(8)} M ${cx} ${cy - px(4)} v ${px(8)}`
        : `M ${cx - px(4)} ${cy} h ${px(8)}`;

    return (
        <g
            style={{ pointerEvents: "all", cursor: "pointer" }}
            onPointerDown={e => {
                e.stopPropagation();
                onToggle();
            }}
        >
            <circle
                cx={cx}
                cy={cy}
                r={px(9)}
                fill="var(--panel)"
                stroke="var(--line)"
                strokeWidth={px(1)}
            />
            <path
                d={glyph}
                stroke="var(--ink-2)"
                strokeWidth={px(1.6)}
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
            />
            {node.collapsed && (
                <text
                    x={cx + px(14)}
                    y={cy + px(4)}
                    fontSize={px(11)}
                    fill="var(--ink-3)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                >
                    {count}
                </text>
            )}
        </g>
    );
}

function EdgeHandles({
    edges,
    routed,
    zoom,
}: {
    edges: DiagramEdge[];
    routed: Map<string, RoutedEdge>;
    zoom: number;
}) {
    const px = (v: number) => v / zoom;
    return (
        <g>
            {edges.map(edge => {
                const r = routed.get(edge.id);
                if (!r) return null;
                return (
                    <g key={edge.id}>
                        <circle
                            data-edge-id={edge.id}
                            data-endpoint="from"
                            cx={r.start.x}
                            cy={r.start.y}
                            r={px(5)}
                            fill="var(--panel)"
                            stroke="var(--accent)"
                            strokeWidth={px(1.6)}
                            style={{ pointerEvents: "all", cursor: "crosshair" }}
                        />
                        <circle
                            data-edge-id={edge.id}
                            data-endpoint="to"
                            cx={r.end.x}
                            cy={r.end.y}
                            r={px(5)}
                            fill="var(--panel)"
                            stroke="var(--accent)"
                            strokeWidth={px(1.6)}
                            style={{ pointerEvents: "all", cursor: "crosshair" }}
                        />
                        {edge.waypoints.map((wp, i) => (
                            <rect
                                key={i}
                                data-edge-id={edge.id}
                                data-waypoint={i}
                                x={wp.x - px(4)}
                                y={wp.y - px(4)}
                                width={px(8)}
                                height={px(8)}
                                rx={px(2)}
                                fill="var(--accent)"
                                style={{ pointerEvents: "all", cursor: "move" }}
                            />
                        ))}
                    </g>
                );
            })}
        </g>
    );
}

function ConnectDraft({
    drag,
    zoom,
}: {
    drag: Extract<EditorState["drag"], { kind: "connect" }>;
    zoom: number;
}) {
    const px = (v: number) => v / zoom;
    return (
        <g style={{ pointerEvents: "none" }}>
            <line
                x1={drag.fromPoint.x}
                y1={drag.fromPoint.y}
                x2={drag.to.x}
                y2={drag.to.y}
                stroke="var(--accent)"
                strokeWidth={px(2)}
                strokeDasharray={`${px(6)} ${px(4)}`}
            />
            <circle cx={drag.to.x} cy={drag.to.y} r={px(4)} fill="var(--accent)" />
        </g>
    );
}

function Guides({ guides, zoom }: { guides: EditorState["guides"]; zoom: number }) {
    if (guides.length === 0) return null;
    const px = (v: number) => v / zoom;
    return (
        <g style={{ pointerEvents: "none" }}>
            {guides.map((g, i) =>
                g.axis === "v" ? (
                    <line
                        key={i}
                        x1={g.pos}
                        y1={g.from}
                        x2={g.pos}
                        y2={g.to}
                        stroke={g.kind === "spacing" ? "var(--warn)" : "var(--hue-magenta)"}
                        strokeWidth={px(1)}
                        strokeDasharray={g.kind === "spacing" ? `${px(4)} ${px(3)}` : undefined}
                    />
                ) : (
                    <line
                        key={i}
                        x1={g.from}
                        y1={g.pos}
                        x2={g.to}
                        y2={g.pos}
                        stroke={g.kind === "spacing" ? "var(--warn)" : "var(--hue-magenta)"}
                        strokeWidth={px(1)}
                        strokeDasharray={g.kind === "spacing" ? `${px(4)} ${px(3)}` : undefined}
                    />
                )
            )}
        </g>
    );
}

function CommentPin({
    at,
    zoom,
    replies,
    onOpen,
}: {
    at: Point;
    zoom: number;
    replies: number;
    onOpen: () => void;
}) {
    const px = (v: number) => v / zoom;
    return (
        <g
            transform={`translate(${at.x} ${at.y})`}
            style={{ pointerEvents: "all", cursor: "pointer" }}
            onPointerDown={e => {
                // A pin is a doorway to its thread, not part of the canvas —
                // don't let the click start a marquee or clear the selection.
                e.stopPropagation();
                onOpen();
            }}
        >
            <circle r={px(11)} fill="var(--warn)" stroke="var(--panel)" strokeWidth={px(2)} />
            <path
                d={`M ${-px(5)} ${-px(4)} h ${px(10)} v ${px(6)} h ${-px(6)} l ${-px(3)} ${px(3)} v ${-px(3)} h ${-px(1)} Z`}
                fill="var(--panel)"
            />
            {replies > 0 && (
                <text
                    x={px(14)}
                    y={px(4)}
                    fontSize={px(10)}
                    fill="var(--ink-3)"
                    style={{ userSelect: "none" }}
                >
                    {replies}
                </text>
            )}
        </g>
    );
}

function BackgroundGrid({
    pattern,
    spacing,
    viewport,
    size,
}: {
    pattern: "plain" | "grid" | "dots" | "lines";
    spacing: number;
    viewport: { x: number; y: number; zoom: number };
    size: { w: number; h: number };
}) {
    if (pattern === "plain") return null;
    // Below ~4 screen px a grid becomes visual noise, so it fades out instead
    // of turning the canvas into a solid block of dots.
    const screenSpacing = spacing * viewport.zoom;
    if (screenSpacing < 4) return null;
    const step = screenSpacing < 9 ? spacing * 5 : spacing;

    const world: Rect = {
        x: viewport.x,
        y: viewport.y,
        w: Math.max(size.w, 1) / viewport.zoom,
        h: Math.max(size.h, 1) / viewport.zoom,
    };
    const id = `lswmm-bg-${pattern}-${step}`;

    return (
        <>
            <defs>
                <pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse">
                    {pattern === "dots" && (
                        <circle
                            cx={step / 2}
                            cy={step / 2}
                            r={Math.max(0.6, 1 / viewport.zoom)}
                            fill="var(--line-dot)"
                            fillOpacity={0.7}
                        />
                    )}
                    {pattern === "grid" && (
                        <path
                            d={`M ${step} 0 L 0 0 0 ${step}`}
                            fill="none"
                            stroke="var(--line)"
                            strokeWidth={Math.max(0.5, 0.8 / viewport.zoom)}
                        />
                    )}
                    {pattern === "lines" && (
                        <path
                            d={`M 0 ${step} L ${step} ${step}`}
                            fill="none"
                            stroke="var(--line)"
                            strokeWidth={Math.max(0.5, 0.8 / viewport.zoom)}
                        />
                    )}
                </pattern>
            </defs>
            {/* The grid is an editing aid, not part of the drawing. */}
            <rect
                data-export="omit"
                x={world.x - step}
                y={world.y - step}
                width={world.w + step * 2}
                height={world.h + step * 2}
                fill={`url(#${id})`}
                style={{ pointerEvents: "none" }}
            />
        </>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cursorFor(
    tool: EditorState["tool"],
    spaceHeld: boolean,
    dragKind: EditorState["drag"]["kind"]
): string {
    if (dragKind === "pan") return "grabbing";
    if (spaceHeld || tool === "hand") return "grab";
    if (tool === "connector") return "crosshair";
    if (tool === "text" || tool === "sticky" || tool === "frame" || tool === "shape") {
        return "crosshair";
    }
    if (tool === "ink") return "crosshair";
    if (tool === "eraser") return "cell";
    return "default";
}

type RenderState = ReturnType<typeof selectRenderState>;

function shallowEqualRenderState(a: RenderState, b: RenderState): boolean {
    return (
        a.viewport === b.viewport &&
        a.tool === b.tool &&
        a.drag === b.drag &&
        a.marquee === b.marquee &&
        a.guides === b.guides &&
        a.hoverNodeId === b.hoverNodeId &&
        a.hoverEdgeId === b.hoverEdgeId &&
        a.editing === b.editing &&
        a.highlighted === b.highlighted &&
        a.presenting === b.presenting
    );
}
