"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    RefObject,
    WheelEvent as ReactWheelEvent,
} from "react";

import {
    activePage,
    mapEdges,
    mapNodes,
    nodeById,
    visibleNodes,
    withDescendants,
} from "../model/doc";
import { insertShape, scaleNodesToBounds } from "../model/commands";
import { createEdge, createNode, createNodeAt } from "../model/factory";
import {
    MAX_ZOOM,
    MIN_ZOOM,
    clamp,
    nodeBounds,
    nodeRect,
    nodesBounds,
    normalizeRect,
    rectContains,
    rectsIntersect,
    screenToWorld,
    snap as snapValue,
    zoomAt,
} from "../model/geometry";
import { isContainer, shapeDef } from "../model/shapes";
import { routeEdge, waypointInsertIndex } from "../model/routing";
import { angleFromCentre, resizeBounds, resizeNode, type ResizeHandle } from "../model/resize";
import { computeSnap, SNAP_THRESHOLD } from "../model/snapping";
import type { EditorStore } from "../model/store";
import type { DiagramNode, Point, PortId, Rect, ShapeId } from "../model/types";

/**
 * The parts of a pointer move the handler actually reads.
 *
 * Coalescing means the handler runs after the event that produced it has been
 * and gone, so it cannot hold the event itself — it holds this instead.
 */
interface MoveSample {
    clientX: number;
    clientY: number;
    target: Element | null;
    shiftKey: boolean;
    altKey: boolean;
}

/** A frame is scheduled but its id is not known yet. Never a real frame id. */
const PENDING_FRAME = -1;

/**
 * All pointer behaviour for the canvas.
 *
 * Hit testing goes through the DOM — every rendered shape carries
 * `data-node-id`, every connector `data-edge-id`, every handle `data-handle` —
 * rather than re-deriving geometry on each event. The browser already knows
 * what is on top, what is rotated, and what the user actually clicked, and
 * duplicating that in JS is how a canvas ends up selecting the wrong shape.
 *
 * Gesture-local scratch state lives in a ref: it changes on every pointer move
 * and nothing renders from it directly, so putting it in the store would cost a
 * re-render per frame for no benefit.
 */

interface Gesture {
    kind:
        | "none"
        | "pan"
        | "marquee"
        | "move"
        | "resize"
        | "rotate"
        | "connect"
        | "waypoint"
        | "ink"
        | "insert";
    /** World point where the pointer went down. */
    origin: Point;
    /** Screen point where the pointer went down, for pan deltas. */
    originScreen: Point;
    /** Node ids under manipulation. */
    ids: string[];
    /** Snapshot of the nodes when the gesture began. */
    startNodes: DiagramNode[];
    startBounds: Rect | null;
    handle: ResizeHandle | null;
    /** True once the pointer travelled far enough to count as a drag. */
    moved: boolean;
    /** Connector drafting. */
    fromNodeId: string | null;
    fromPort: PortId | null;
    edgeId: string | null;
    endpoint: "from" | "to" | null;
    waypointIndex: number;
    /** Ink stroke points, world space. */
    inkPoints: Point[];
    /** Insert-with-drag. */
    insertShape: ShapeId | null;
    startRotation: number;
    startAngle: number;
    additive: boolean;
}

const IDLE: Gesture = {
    kind: "none",
    origin: { x: 0, y: 0 },
    originScreen: { x: 0, y: 0 },
    ids: [],
    startNodes: [],
    startBounds: null,
    handle: null,
    moved: false,
    fromNodeId: null,
    fromPort: null,
    edgeId: null,
    endpoint: null,
    waypointIndex: -1,
    inkPoints: [],
    insertShape: null,
    startRotation: 0,
    startAngle: 0,
    additive: false,
};

/** Pointer travel (screen px) before a click becomes a drag. */
const DRAG_THRESHOLD = 3;

export interface CanvasInteractions {
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onWheel: (e: ReactWheelEvent<SVGSVGElement>) => void;
    onDoubleClick: (e: ReactMouseEvent<SVGSVGElement>) => void;
    onContextMenu: (e: ReactMouseEvent<SVGSVGElement>) => void;
    /** Screen → world for the current viewport. */
    toWorld: (clientX: number, clientY: number) => Point;
    /** True while the space bar is held (temporary hand tool). */
    isPanning: () => boolean;
}

export interface CanvasCallbacks {
    /** Open the context menu at a screen position. */
    onContextMenuAt: (
        screen: Point,
        target: { kind: "node" | "edge" | "canvas"; id?: string }
    ) => void;
    /** Begin editing a node's or edge label's text. */
    onEditText: (target: { kind: "node" | "edge-label"; id: string; index?: number }) => void;
}

export function useCanvasInteractions(
    store: EditorStore,
    svgRef: RefObject<SVGSVGElement | null>,
    callbacks: CanvasCallbacks
): CanvasInteractions {
    const gesture = useRef<Gesture>({ ...IDLE });
    const spaceHeld = useRef(false);
    // Callbacks come from the editor shell and change identity every render;
    // routing them through a ref keeps every handler below stable.
    const cb = useRef(callbacks);
    cb.current = callbacks;

    // Space temporarily swaps to the hand tool, the way every canvas app does.
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code !== "Space") return;
            const target = e.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
            if (target?.isContentEditable) return;
            spaceHeld.current = true;
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === "Space") spaceHeld.current = false;
        };
        const blur = () => {
            spaceHeld.current = false;
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", blur);
        };
    }, []);

    /**
     * Cached bounding rect of the canvas element.
     *
     * `getBoundingClientRect` forces a synchronous layout. One pointer move used
     * to cost three of them — `toWorld`, `toScreen`, and a third from the
     * presence wrapper — each interleaved with React renders that dirty layout
     * again. That is the textbook layout-thrash pattern, and it is pure waste:
     * the canvas cannot move under the pointer mid-gesture without one of the
     * invalidating events below firing.
     */
    const rectRef = useRef<DOMRect | null>(null);

    const invalidateRect = useCallback(() => {
        rectRef.current = null;
    }, []);

    const canvasRect = useCallback((): DOMRect | null => {
        const el = svgRef.current;
        if (!el) return null;
        const cached = rectRef.current;
        if (cached) return cached;
        const rect = el.getBoundingClientRect();
        rectRef.current = rect;
        return rect;
    }, [svgRef]);

    useEffect(() => {
        const el = svgRef.current;
        window.addEventListener("resize", invalidateRect);
        // Capture phase: a scrolling *ancestor* moves the canvas too, and those
        // scroll events never reach window in the bubble phase.
        window.addEventListener("scroll", invalidateRect, true);

        const observer =
            typeof ResizeObserver === "undefined" ? null : new ResizeObserver(invalidateRect);
        if (el && observer) observer.observe(el);

        return () => {
            window.removeEventListener("resize", invalidateRect);
            window.removeEventListener("scroll", invalidateRect, true);
            observer?.disconnect();
        };
    }, [invalidateRect, svgRef]);

    const toWorld = useCallback(
        (clientX: number, clientY: number): Point => {
            const viewport = store.getState().viewport;
            const rect = canvasRect();
            if (!rect) return screenToWorld(viewport, { x: clientX, y: clientY });
            return screenToWorld(viewport, { x: clientX - rect.left, y: clientY - rect.top });
        },
        [canvasRect, store]
    );

    const toScreen = useCallback(
        (clientX: number, clientY: number): Point => {
            const rect = canvasRect();
            if (!rect) return { x: clientX, y: clientY };
            return { x: clientX - rect.left, y: clientY - rect.top };
        },
        [canvasRect]
    );

    // -----------------------------------------------------------------------
    // Pointer down
    // -----------------------------------------------------------------------

    const onPointerDown = useCallback(
        (e: ReactPointerEvent<SVGSVGElement>) => {
            if (e.button === 2) return; // handled by onContextMenu
            const state = store.getState();
            if (state.presenting) return;

            const world = toWorld(e.clientX, e.clientY);
            const screen = toScreen(e.clientX, e.clientY);
            const target = e.target as Element | null;
            const additive = e.shiftKey || e.metaKey || e.ctrlKey;

            svgRef.current?.setPointerCapture(e.pointerId);
            store.setEditing(null);

            const base: Gesture = {
                ...IDLE,
                origin: world,
                originScreen: screen,
                additive,
            };

            // -- panning ----------------------------------------------------
            if (e.button === 1 || spaceHeld.current || state.tool === "hand") {
                gesture.current = { ...base, kind: "pan" };
                store.setDrag({ kind: "pan" });
                return;
            }

            const page = activePage(state.doc);

            // -- handles ----------------------------------------------------
            const handleEl = target?.closest("[data-handle]");
            const handleName = handleEl?.getAttribute("data-handle");
            if (handleName) {
                const ids = store.selectedNodeIds();
                const startNodes = ids
                    .map(id => nodeById(page, id))
                    .filter((nd): nd is DiagramNode => nd !== undefined);
                if (handleName === "rotate") {
                    const bounds = nodesBounds(startNodes);
                    if (!bounds) return;
                    const centre = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
                    store.beginInteraction("Rotate");
                    gesture.current = {
                        ...base,
                        kind: "rotate",
                        ids,
                        startNodes,
                        startBounds: bounds,
                        startRotation: startNodes[0]?.rotation ?? 0,
                        startAngle: angleFromCentre(centre, world),
                    };
                    store.setDrag({ kind: "rotate", ids, centre, startAngle: 0 });
                    return;
                }
                const bounds = nodesBounds(startNodes);
                if (!bounds) return;
                store.beginInteraction("Resize");
                gesture.current = {
                    ...base,
                    kind: "resize",
                    ids,
                    startNodes,
                    startBounds: bounds,
                    handle: handleName as ResizeHandle,
                };
                store.setDrag({
                    kind: "resize",
                    ids,
                    handle: handleName as ResizeHandle,
                    origin: world,
                    startBounds: bounds,
                });
                return;
            }

            // -- connector endpoint / waypoint handles -----------------------
            const endpointEl = target?.closest("[data-endpoint]");
            if (endpointEl) {
                const edgeId = endpointEl.getAttribute("data-edge-id");
                const end = endpointEl.getAttribute("data-endpoint");
                if (edgeId && (end === "from" || end === "to")) {
                    store.beginInteraction("Reconnect");
                    gesture.current = { ...base, kind: "connect", edgeId, endpoint: end };
                    store.setDrag({
                        kind: "connect",
                        fromNodeId: null,
                        fromPort: null,
                        fromPoint: world,
                        to: world,
                        hoverNodeId: null,
                        hoverPort: null,
                        edgeId,
                        end,
                    });
                    return;
                }
            }

            const waypointEl = target?.closest("[data-waypoint]");
            if (waypointEl) {
                const edgeId = waypointEl.getAttribute("data-edge-id");
                const index = Number(waypointEl.getAttribute("data-waypoint"));
                if (edgeId && Number.isInteger(index)) {
                    store.beginInteraction("Route connector");
                    gesture.current = { ...base, kind: "waypoint", edgeId, waypointIndex: index };
                    store.setDrag({ kind: "waypoint", edgeId, index });
                    return;
                }
            }

            // -- ports (start a connector) -----------------------------------
            const portEl = target?.closest("[data-port]");
            if (portEl) {
                const nodeId = portEl.getAttribute("data-node-id");
                const port = portEl.getAttribute("data-port") as PortId | null;
                if (nodeId) {
                    store.beginInteraction("Connect");
                    gesture.current = {
                        ...base,
                        kind: "connect",
                        fromNodeId: nodeId,
                        fromPort: port,
                    };
                    store.setDrag({
                        kind: "connect",
                        fromNodeId: nodeId,
                        fromPort: port,
                        fromPoint: world,
                        to: world,
                        hoverNodeId: null,
                        hoverPort: null,
                    });
                    return;
                }
            }

            const nodeEl = target?.closest("[data-node-id]");
            const nodeId = nodeEl?.getAttribute("data-node-id") ?? null;
            const edgeEl = target?.closest("[data-edge-id]");
            const edgeId = edgeEl?.getAttribute("data-edge-id") ?? null;

            // -- tool-specific creation --------------------------------------
            if (state.tool === "connector") {
                store.beginInteraction("Connect");
                gesture.current = {
                    ...base,
                    kind: "connect",
                    fromNodeId: nodeId,
                    fromPort: nodeId ? "auto" : null,
                };
                store.setDrag({
                    kind: "connect",
                    fromNodeId: nodeId,
                    fromPort: nodeId ? "auto" : null,
                    fromPoint: world,
                    to: world,
                    hoverNodeId: null,
                    hoverPort: null,
                });
                return;
            }

            if (state.tool === "ink") {
                const node = createNode({
                    shape: "ink",
                    x: world.x,
                    y: world.y,
                    w: 1,
                    h: 1,
                    data: { points: [{ x: 0, y: 0 }] },
                });
                store.beginInteraction("Draw");
                store.updatePage(p => ({ ...p, nodes: [...p.nodes, node] }), { transient: true });
                gesture.current = { ...base, kind: "ink", ids: [node.id], inkPoints: [world] };
                store.setDrag({ kind: "ink", nodeId: node.id });
                return;
            }

            if (state.tool === "eraser") {
                if (nodeId || edgeId) {
                    store.updatePage(
                        p => ({
                            ...p,
                            nodes: nodeId ? p.nodes.filter(nd => nd.id !== nodeId) : p.nodes,
                            edges: p.edges.filter(
                                ed =>
                                    ed.id !== edgeId &&
                                    ed.from.nodeId !== nodeId &&
                                    ed.to.nodeId !== nodeId
                            ),
                        }),
                        { label: "Erase" }
                    );
                }
                gesture.current = { ...base, kind: "none" };
                return;
            }

            if (
                state.tool === "shape" ||
                state.tool === "text" ||
                state.tool === "sticky" ||
                state.tool === "frame"
            ) {
                const shape: ShapeId =
                    state.tool === "shape"
                        ? (state.pendingShape ?? "rectangle")
                        : state.tool === "text"
                          ? "text"
                          : state.tool === "sticky"
                            ? "sticky"
                            : "frame";
                store.beginInteraction("Insert");
                gesture.current = { ...base, kind: "insert", insertShape: shape };
                store.setDrag({ kind: "insert", shape, origin: world });
                return;
            }

            // -- select tool --------------------------------------------------
            if (edgeId && !nodeId) {
                const wasSelected = store.isSelected("edge", edgeId);
                if (additive) store.toggleSelection({ kind: "edge", id: edgeId });
                else if (!wasSelected) store.setSelection([{ kind: "edge", id: edgeId }]);

                // Dragging the body of an already-selected connector adds a bend
                // there and drags it — the standard way to route a line by hand.
                const edge = page.edges.find(e => e.id === edgeId);
                if (wasSelected && !additive && edge && !edge.locked) {
                    const routed = routeEdge(edge, id => nodeById(page, id));
                    const index = waypointInsertIndex(routed, edge.waypoints, world);
                    store.beginInteraction("Route connector");
                    store.updatePage(
                        p =>
                            mapEdges(p, [edgeId], ed => {
                                const waypoints = [...ed.waypoints];
                                waypoints.splice(index, 0, world);
                                return { ...ed, waypoints };
                            }),
                        { transient: true }
                    );
                    gesture.current = { ...base, kind: "waypoint", edgeId, waypointIndex: index };
                    store.setDrag({ kind: "waypoint", edgeId, index });
                    return;
                }
                gesture.current = { ...base, kind: "none" };
                return;
            }

            if (nodeId) {
                const node = nodeById(page, nodeId);
                if (node?.locked) {
                    gesture.current = { ...base, kind: "none" };
                    return;
                }
                if (additive) {
                    store.toggleSelection({ kind: "node", id: nodeId });
                } else if (!store.isSelected("node", nodeId)) {
                    store.setSelection([{ kind: "node", id: nodeId }]);
                }
                const ids = store.selectedNodeIds().filter(id => !nodeById(page, id)?.locked);
                const startNodes = withDescendants(page, ids)
                    .map(id => nodeById(page, id))
                    .filter((nd): nd is DiagramNode => nd !== undefined);
                store.beginInteraction("Move");
                gesture.current = { ...base, kind: "move", ids, startNodes };
                store.setDrag({ kind: "move", ids, origin: world });
                return;
            }

            // -- empty canvas: marquee ---------------------------------------
            if (!additive) store.clearSelection();
            gesture.current = { ...base, kind: "marquee" };
            store.setDrag({ kind: "marquee", origin: world });
        },
        [store, svgRef, toScreen, toWorld]
    );

    // -----------------------------------------------------------------------
    // Pointer move
    // -----------------------------------------------------------------------

    const handleMove = useCallback(
        (e: MoveSample) => {
            const g = gesture.current;
            const state = store.getState();
            const world = toWorld(e.clientX, e.clientY);
            const screen = toScreen(e.clientX, e.clientY);

            if (g.kind === "none") {
                // Idle hover — drives the port dots and connector highlight.
                const target = e.target;
                const nodeId = target?.closest("[data-node-id]")?.getAttribute("data-node-id");
                const edgeId = target?.closest("[data-edge-id]")?.getAttribute("data-edge-id");
                store.setHover(nodeId ?? null, edgeId ?? null);
                return;
            }

            if (
                !g.moved &&
                Math.hypot(screen.x - g.originScreen.x, screen.y - g.originScreen.y) <
                    DRAG_THRESHOLD
            ) {
                return;
            }
            g.moved = true;

            switch (g.kind) {
                case "pan": {
                    const dx = screen.x - g.originScreen.x;
                    const dy = screen.y - g.originScreen.y;
                    g.originScreen = screen;
                    store.panBy(-dx, -dy);
                    return;
                }

                case "marquee": {
                    store.setMarquee(normalizeRect(g.origin, world));
                    return;
                }

                case "move": {
                    const page = activePage(state.doc);
                    const movingIds = withDescendants(page, g.ids);
                    const movingSet = new Set(movingIds);
                    const startBounds = nodesBounds(
                        g.startNodes.filter(nd => movingSet.has(nd.id))
                    );
                    if (!startBounds) return;

                    let dx = world.x - g.origin.x;
                    let dy = world.y - g.origin.y;
                    if (e.shiftKey) {
                        // Constrain to the dominant axis.
                        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
                        else dx = 0;
                    }

                    const proposed = {
                        x: startBounds.x + dx,
                        y: startBounds.y + dy,
                        w: startBounds.w,
                        h: startBounds.h,
                    };
                    const others = visibleNodes(page)
                        .filter(nd => !movingSet.has(nd.id))
                        .map(nodeBounds);
                    const snapped = e.altKey
                        ? { dx: 0, dy: 0, guides: [] }
                        : computeSnap({
                              moving: proposed,
                              others,
                              gridSize: state.doc.settings.gridSize,
                              snapToGrid: state.doc.settings.snapToGrid,
                              snapToObjects: state.doc.settings.snapToObjects,
                              threshold: SNAP_THRESHOLD / state.viewport.zoom,
                          });
                    store.setGuides(snapped.guides);

                    const totalDx = dx + snapped.dx;
                    const totalDy = dy + snapped.dy;

                    // Rebuild from the gesture's starting snapshot each frame so
                    // rounding never accumulates across a long drag.
                    store.updatePage(
                        p =>
                            mapNodes(p, movingIds, nd => {
                                const start = g.startNodes.find(s => s.id === nd.id);
                                if (!start) return nd;
                                return { ...nd, x: start.x + totalDx, y: start.y + totalDy };
                            }),
                        { transient: true }
                    );
                    return;
                }

                case "resize": {
                    if (!g.handle || !g.startBounds) return;
                    const keepAspect =
                        e.shiftKey ||
                        (g.startNodes.length === 1 &&
                            g.startNodes[0] !== undefined &&
                            isAspectLocked(g.startNodes[0]));
                    const options = {
                        keepAspect,
                        fromCentre: e.altKey,
                        snap: state.doc.settings.snapToGrid
                            ? (v: number) => snapValue(v, state.doc.settings.gridSize)
                            : undefined,
                    };

                    if (g.startNodes.length === 1) {
                        const start = g.startNodes[0]!;
                        const next = resizeNode(start, g.handle, world, options);
                        store.updatePage(
                            p =>
                                mapNodes(p, [start.id], nd => ({
                                    ...nd,
                                    x: next.x,
                                    y: next.y,
                                    w: next.w,
                                    h: next.h,
                                })),
                            { transient: true }
                        );
                        return;
                    }

                    const target = resizeBounds(g.startBounds, g.handle, world, options);
                    const startBounds = g.startBounds;
                    const ids = g.ids;
                    const startNodes = g.startNodes;
                    store.updatePage(
                        p => {
                            // Restore the pre-gesture geometry first so each
                            // frame scales from the original, not the last frame.
                            const restored = mapNodes(
                                p,
                                startNodes.map(nd => nd.id),
                                nd => {
                                    const start = startNodes.find(s => s.id === nd.id);
                                    return start
                                        ? { ...nd, x: start.x, y: start.y, w: start.w, h: start.h }
                                        : nd;
                                }
                            );
                            return scaleNodesToBounds(restored, ids, startBounds, target);
                        },
                        { transient: true }
                    );
                    return;
                }

                case "rotate": {
                    if (!g.startBounds) return;
                    const centre = {
                        x: g.startBounds.x + g.startBounds.w / 2,
                        y: g.startBounds.y + g.startBounds.h / 2,
                    };
                    const angle = angleFromCentre(centre, world);
                    let delta = angle - g.startAngle;
                    if (e.shiftKey) delta = Math.round(delta / 15) * 15;
                    store.updatePage(
                        p =>
                            mapNodes(p, g.ids, nd => {
                                const start = g.startNodes.find(s => s.id === nd.id);
                                if (!start) return nd;
                                return { ...nd, rotation: (start.rotation + delta) % 360 };
                            }),
                        { transient: true }
                    );
                    return;
                }

                case "connect": {
                    const target = e.target;
                    const overNode =
                        target?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
                    const overPort =
                        target?.closest("[data-port]")?.getAttribute("data-port") ?? null;
                    const drag = state.drag;
                    if (drag.kind === "connect") {
                        store.setDrag({
                            ...drag,
                            to: world,
                            hoverNodeId: overNode,
                            hoverPort: overPort,
                        });
                    }
                    return;
                }

                case "waypoint": {
                    if (!g.edgeId) return;
                    const index = g.waypointIndex;
                    const snapped = state.doc.settings.snapToGrid
                        ? {
                              x: snapValue(world.x, state.doc.settings.gridSize),
                              y: snapValue(world.y, state.doc.settings.gridSize),
                          }
                        : world;
                    store.updatePage(
                        p =>
                            mapEdges(p, [g.edgeId!], ed => {
                                const waypoints = [...ed.waypoints];
                                if (index < 0 || index >= waypoints.length) return ed;
                                waypoints[index] = snapped;
                                return { ...ed, waypoints };
                            }),
                        { transient: true }
                    );
                    return;
                }

                case "ink": {
                    const nodeId = g.ids[0];
                    if (!nodeId) return;
                    g.inkPoints.push(world);
                    const pts = g.inkPoints;
                    const minX = Math.min(...pts.map(p => p.x));
                    const minY = Math.min(...pts.map(p => p.y));
                    const maxX = Math.max(...pts.map(p => p.x));
                    const maxY = Math.max(...pts.map(p => p.y));
                    const w = Math.max(maxX - minX, 1);
                    const h = Math.max(maxY - minY, 1);
                    store.updatePage(
                        p =>
                            mapNodes(p, [nodeId], nd => ({
                                ...nd,
                                x: minX,
                                y: minY,
                                w,
                                h,
                                data: {
                                    ...nd.data,
                                    points: pts.map(pt => ({
                                        x: (pt.x - minX) / w,
                                        y: (pt.y - minY) / h,
                                    })),
                                },
                            })),
                        { transient: true }
                    );
                    return;
                }

                case "insert": {
                    const rect = normalizeRect(g.origin, world);
                    store.setMarquee(rect);
                    return;
                }
            }
        },
        [store, toScreen, toWorld]
    );

    // -----------------------------------------------------------------------
    // Coalescing
    // -----------------------------------------------------------------------

    /**
     * Pointer moves arrive faster than the screen refreshes — a 120 Hz trackpad
     * delivers two or three per frame, and each one used to do the full round of
     * hit testing, snapping and routing for a picture nobody would ever see.
     * Samples are collected and processed once per animation frame instead.
     */
    const pending = useRef<MoveSample[]>([]);
    const frame = useRef<number | null>(null);

    const flushMoves = useCallback(() => {
        frame.current = null;
        const samples = pending.current;
        if (samples.length === 0) return;
        pending.current = [];

        store.batch(() => {
            // Ink wants every sample: a freehand stroke built from one point per
            // frame is visibly polygonal. Every other gesture is either absolute
            // or accumulates from an origin it stores itself, so for those only
            // the newest sample can matter.
            if (gesture.current.kind === "ink") {
                for (const sample of samples) handleMove(sample);
            } else {
                handleMove(samples[samples.length - 1]!);
            }
        });
    }, [handleMove, store]);

    const onPointerMove = useCallback(
        (e: ReactPointerEvent<SVGSVGElement>) => {
            pending.current.push({
                clientX: e.clientX,
                clientY: e.clientY,
                target: e.target as Element | null,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
            });
            if (frame.current !== null) return;

            // Claim the slot before scheduling. A `requestAnimationFrame` that
            // runs its callback synchronously — jsdom stubs, some polyfills —
            // would otherwise have `flushMoves` clear the slot and then be
            // overwritten by the id returned here, leaving it permanently
            // "scheduled" and dropping every later move.
            frame.current = PENDING_FRAME;
            const id = requestAnimationFrame(flushMoves);
            if (frame.current === PENDING_FRAME) frame.current = id;
        },
        [flushMoves]
    );

    // A queued frame after unmount would touch a dead store.
    useEffect(
        () => () => {
            if (frame.current !== null) cancelAnimationFrame(frame.current);
        },
        []
    );

    // -----------------------------------------------------------------------
    // Pointer up
    // -----------------------------------------------------------------------

    const onPointerUp = useCallback(
        (e: ReactPointerEvent<SVGSVGElement>) => {
            // Land the last queued sample before ending the gesture, or the
            // shape settles one frame behind where the pointer actually was.
            if (frame.current !== null) {
                cancelAnimationFrame(frame.current);
                frame.current = null;
            }
            flushMoves();

            const g = gesture.current;
            if (g.kind === "none") return;
            const state = store.getState();
            const world = toWorld(e.clientX, e.clientY);
            svgRef.current?.releasePointerCapture(e.pointerId);

            switch (g.kind) {
                case "marquee": {
                    const rect = state.marquee;
                    store.setMarquee(null);
                    if (rect && g.moved) {
                        const page = activePage(state.doc);
                        const hits = visibleNodes(page)
                            .filter(nd => !nd.locked && rectsIntersect(rect, nodeBounds(nd)))
                            // Selecting a group member selects the group.
                            .map(nd => nd.id);
                        const refs = hits.map(id => ({ kind: "node" as const, id }));
                        store.setSelection(g.additive ? [...state.selection, ...refs] : refs);
                    }
                    break;
                }

                case "move": {
                    store.setGuides([]);
                    if (g.moved) reparentIntoContainers(store, g.ids);
                    store.endInteraction();
                    break;
                }

                case "resize":
                case "rotate":
                case "waypoint":
                case "ink": {
                    store.setGuides([]);
                    if (g.kind === "ink" && !g.moved && g.ids[0]) {
                        // A tap with the pen leaves nothing behind.
                        const id = g.ids[0];
                        store.updatePage(
                            p => ({ ...p, nodes: p.nodes.filter(nd => nd.id !== id) }),
                            {
                                transient: true,
                            }
                        );
                        store.cancelInteraction();
                        break;
                    }
                    store.endInteraction();
                    break;
                }

                case "connect": {
                    finishConnect(store, g, world);
                    break;
                }

                case "insert": {
                    const rect = state.marquee;
                    store.setMarquee(null);
                    const shape = g.insertShape ?? "rectangle";
                    if (g.moved && rect && rect.w > 8 && rect.h > 8) {
                        const node = createNode({
                            shape,
                            x: rect.x,
                            y: rect.y,
                            w: rect.w,
                            h: rect.h,
                        });
                        store.updatePage(p => ({ ...p, nodes: [...p.nodes, node] }), {
                            transient: true,
                        });
                        store.selectNodes([node.id]);
                        store.endInteraction();
                        if (shape === "text" || shape === "sticky") {
                            cb.current.onEditText({ kind: "node", id: node.id });
                        }
                    } else {
                        store.cancelInteraction();
                        const id = insertShape(store, shape, g.origin);
                        if (shape === "text" || shape === "sticky") {
                            cb.current.onEditText({ kind: "node", id });
                        }
                    }
                    store.setTool("select");
                    break;
                }

                case "pan":
                default:
                    break;
            }

            gesture.current = { ...IDLE };
            store.setDrag({ kind: "none" });
        },
        [flushMoves, store, svgRef, toWorld]
    );

    // -----------------------------------------------------------------------
    // Wheel, double click, context menu
    // -----------------------------------------------------------------------

    const onWheel = useCallback(
        (e: ReactWheelEvent<SVGSVGElement>) => {
            const state = store.getState();
            const screen = toScreen(e.clientX, e.clientY);
            if (e.ctrlKey || e.metaKey) {
                // Pinch-zoom and ⌘-wheel both arrive here with ctrlKey set.
                const factor = Math.exp(-e.deltaY * 0.0022);
                const next = clamp(state.viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
                store.setViewport(zoomAt(state.viewport, next, screen));
                return;
            }
            const dx = e.shiftKey ? e.deltaY : e.deltaX;
            const dy = e.shiftKey ? 0 : e.deltaY;
            store.panBy(dx, dy);
        },
        [store, toScreen]
    );

    const onDoubleClick = useCallback(
        (e: ReactMouseEvent<SVGSVGElement>) => {
            const state = store.getState();
            if (state.presenting) return;
            const target = e.target as Element | null;
            const nodeId = target?.closest("[data-node-id]")?.getAttribute("data-node-id");
            if (nodeId) {
                const page = activePage(state.doc);
                const node = nodeById(page, nodeId);
                if (node?.locked) return;
                store.selectNodes([nodeId]);
                cb.current.onEditText({ kind: "node", id: nodeId });
                return;
            }
            const edgeId = target?.closest("[data-edge-id]")?.getAttribute("data-edge-id");
            if (edgeId) {
                store.setSelection([{ kind: "edge", id: edgeId }]);
                cb.current.onEditText({ kind: "edge-label", id: edgeId, index: 0 });
                return;
            }
            // Empty canvas: drop a topic where they clicked and start typing.
            const world = toWorld(e.clientX, e.clientY);
            const node = createNodeAt("mind-branch", world);
            store.updatePage(p => ({ ...p, nodes: [...p.nodes, node] }), { label: "Add topic" });
            store.selectNodes([node.id]);
            cb.current.onEditText({ kind: "node", id: node.id });
        },
        [store, toWorld]
    );

    const onContextMenu = useCallback(
        (e: ReactMouseEvent<SVGSVGElement>) => {
            e.preventDefault();
            const target = e.target as Element | null;
            const nodeId = target?.closest("[data-node-id]")?.getAttribute("data-node-id");
            const edgeId = target?.closest("[data-edge-id]")?.getAttribute("data-edge-id");
            if (nodeId) {
                if (!store.isSelected("node", nodeId)) store.selectNodes([nodeId]);
                cb.current.onContextMenuAt(
                    { x: e.clientX, y: e.clientY },
                    { kind: "node", id: nodeId }
                );
                return;
            }
            if (edgeId) {
                if (!store.isSelected("edge", edgeId)) {
                    store.setSelection([{ kind: "edge", id: edgeId }]);
                }
                cb.current.onContextMenuAt(
                    { x: e.clientX, y: e.clientY },
                    { kind: "edge", id: edgeId }
                );
                return;
            }
            cb.current.onContextMenuAt({ x: e.clientX, y: e.clientY }, { kind: "canvas" });
        },
        [store]
    );

    const isPanning = useCallback(() => spaceHeld.current, []);

    /**
     * One input event is one logical change, however many writes it takes to
     * express. A pointer-down can set the editing target, the selection and the
     * drag mode; a pointer-move writes the guides and then the positions.
     * Batching at the handler boundary — rather than inside each branch — means
     * a new gesture cannot forget to do it.
     */
    const batched = useCallback(
        <E>(handler: (event: E) => void) =>
            (event: E): void => {
                store.batch(() => handler(event));
            },
        [store]
    );

    return {
        onPointerDown: batched(onPointerDown),
        // Not `batched`: this one only queues a sample. The writes happen in
        // `flushMoves`, which does its own batching around the whole frame.
        onPointerMove,
        onPointerUp: batched(onPointerUp),
        onWheel: batched(onWheel),
        onDoubleClick: batched(onDoubleClick),
        onContextMenu: batched(onContextMenu),
        toWorld,
        isPanning,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAspectLocked(node: DiagramNode): boolean {
    return shapeDef(node.shape).keepAspect === true;
}

/**
 * After a drag, adopt each moved shape into the frame or swimlane it now sits
 * inside — and release it when it has been dragged out. Membership is decided
 * by the shape's centre, not by overlap: half-in shapes are common while
 * arranging, and flickering parentage as they cross an edge is worse than a
 * rule the user can predict.
 *
 * Groups are excluded: their membership is explicit (⌘G), not positional.
 */
function reparentIntoContainers(store: EditorStore, movedIds: readonly string[]): void {
    const page = activePage(store.getState().doc);
    const moved = new Set(withDescendants(page, movedIds));

    const containers = page.nodes.filter(nd => isContainer(nd.shape) && nd.shape !== "group");
    const changes = new Map<string, string | null>();

    for (const id of movedIds) {
        const node = nodeById(page, id);
        if (!node || isContainer(node.shape)) continue;

        const centre = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
        // Innermost wins, so a shape dropped in a lane inside a pool joins the
        // lane. Area is the proxy for depth.
        const hit = containers
            .filter(c => !moved.has(c.id) && rectContains(nodeRect(c), centre))
            .sort((a, b) => a.w * a.h - b.w * b.h)[0];

        const next = hit?.id ?? null;
        const currentParent = node.parentId;
        // Only touch shapes whose current parent is positional in the first
        // place — never yank a shape out of a group the user made by hand.
        const inGroup = currentParent !== null && nodeById(page, currentParent)?.shape === "group";
        if (inGroup || currentParent === next) continue;
        changes.set(id, next);
    }

    if (changes.size === 0) return;
    store.updatePage(
        p =>
            mapNodes(p, [...changes.keys()], nd => ({
                ...nd,
                parentId: changes.get(nd.id) ?? null,
            })),
        { transient: true }
    );
}

function finishConnect(store: EditorStore, g: Gesture, world: Point): void {
    const state = store.getState();
    const drag = state.drag;
    const hoverNodeId = drag.kind === "connect" ? drag.hoverNodeId : null;
    const hoverPort = drag.kind === "connect" ? drag.hoverPort : null;

    // Re-dragging one end of an existing connector.
    if (g.edgeId && g.endpoint) {
        const end = g.endpoint;
        store.updatePage(
            p =>
                mapEdges(p, [g.edgeId!], ed => {
                    const next = hoverNodeId
                        ? { nodeId: hoverNodeId, port: (hoverPort as PortId) ?? "auto" }
                        : { point: world };
                    return end === "from" ? { ...ed, from: next } : { ...ed, to: next };
                }),
            { transient: true }
        );
        store.endInteraction();
        return;
    }

    const page = activePage(state.doc);
    const fromNodeId = g.fromNodeId;

    // Dragging out of a port into empty space creates the target topic — the
    // single most-used gesture in a mindmap, so it must not require a second
    // click on the shape palette.
    let targetNodeId = hoverNodeId;
    let created: DiagramNode | null = null;
    if (!targetNodeId) {
        if (!g.moved) {
            store.cancelInteraction();
            return;
        }
        const source = fromNodeId ? nodeById(page, fromNodeId) : undefined;
        // The new topic inherits its parent's look unless the parent is the
        // root, whose filled-pill styling would swamp a child.
        created = createNodeAt("mind-branch", world, {
            w: source && source.shape !== "mind-root" ? source.w : 160,
            h: source && source.shape !== "mind-root" ? source.h : 54,
        });
        targetNodeId = created.id;
    }

    if (fromNodeId && targetNodeId === fromNodeId && !created) {
        store.cancelInteraction();
        return;
    }

    const edge = createEdge({
        from: fromNodeId ? { nodeId: fromNodeId, port: g.fromPort ?? "auto" } : { point: g.origin },
        to: { nodeId: targetNodeId, port: (hoverPort ?? "auto") as PortId },
        kind: state.doc.settings.defaultEdgeKind,
    });

    store.updatePage(
        p => ({
            ...p,
            nodes: created ? [...p.nodes, created] : p.nodes,
            edges: [...p.edges, edge],
        }),
        { transient: true }
    );
    store.endInteraction();
    if (created) store.selectNodes([created.id]);
}
