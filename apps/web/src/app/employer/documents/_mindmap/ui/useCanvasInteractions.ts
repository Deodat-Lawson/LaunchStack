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
    isTopicShape,
    mapEdges,
    mapNodes,
    nodeById,
    visibleNodes,
    withDescendants,
    worksAsFlow,
} from "../model/doc";
import {
    docMode,
    edgesMovingWith,
    holdChartInPlace,
    insertEdge,
    insertShape,
    removeBend,
    scaleNodesToBounds,
    shiftEdge,
} from "../model/commands";
import { paintNewTopics } from "../model/topicStyle";
import { createEdge, createNode, createNodeAt } from "../model/factory";
import {
    MAX_ZOOM,
    MIN_ZOOM,
    clamp,
    nodeBounds,
    nodeRect,
    nodesBounds,
    normalizeRect,
    projectOntoPolyline,
    rectContains,
    rectContainsRect,
    rectsIntersect,
    screenToWorld,
    snap as snapValue,
    worldToScreen,
    zoomAt,
} from "../model/geometry";
import { isContainer, shapeDef, shapeHoldsText } from "../model/shapes";
import {
    dropStaleBends,
    isRedundantBend,
    routeEdge,
    routeOptionsFor,
    waypointInsertIndex,
} from "../model/routing";
import { angleFromCentre, resizeBounds, resizeNode, type ResizeHandle } from "../model/resize";
import { computeSnap, SNAP_THRESHOLD } from "../model/snapping";
import type { EditorStore } from "../model/store";
import { useIsActive } from "./EditorContext";
import { flowUiFor } from "../flow";
import {
    clickTarget,
    containerAt,
    FRAME_EDGE,
    onFrameBody,
    outermostGroup,
} from "../model/containers";
import { dressBox, edgeOptions, flowLookOf } from "../model/flowchart/look";
import type {
    DiagramEdge,
    DiagramNode,
    DiagramPage,
    Point,
    PortId,
    Rect,
    ShapeId,
} from "../model/types";

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
        | "label"
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
    /** Connectors whose bends and free ends travel with a move, as they began. */
    startEdges: DiagramEdge[];
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
    /**
     * Where a bend will go once the pointer actually drags the connector's
     * body. Nothing is added on press: a click (or the second click of the
     * double-click that labels a line) used to leave a bend behind.
     */
    bendAt: number | null;
    /** Which of the connector's labels a "label" gesture is sliding. */
    labelIndex: number;
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
    startEdges: [],
    startBounds: null,
    handle: null,
    moved: false,
    fromNodeId: null,
    fromPort: null,
    edgeId: null,
    endpoint: null,
    waypointIndex: -1,
    bendAt: null,
    labelIndex: -1,
    inkPoints: [],
    insertShape: null,
    startRotation: 0,
    startAngle: 0,
    additive: false,
};

/** Pointer travel (screen px) before a click becomes a drag. */
const DRAG_THRESHOLD = 3;
/** How close to straight (screen px) a dragged bend must land to be taken out. */
const BEND_STRAIGHT_TOLERANCE = 6;
/**
 * How far inside a shape's outline (screen px) a press still grabs one of its
 * connection dots. The dots sit on the outline with a generous hit circle, so
 * without this a click just inside a box's edge — to select it, or to drag
 * it — started a connector instead, and a plain click there made a new box.
 */
const PORT_INNER_GRACE = 4;
/** A connector dragged out of a dot shorter than this (screen px) was a slip. */
const MIN_CONNECT_DRAG = 40;

/**
 * What a pointer event is really over. While the canvas holds pointer capture
 * every event names the canvas itself as its target, whatever is under the
 * pointer; ask the document instead (pointer capture does not affect it).
 */
function hitTarget(
    target: Element | null,
    svg: SVGSVGElement | null,
    e: { clientX: number; clientY: number }
): Element | null {
    if (target !== svg || typeof document.elementFromPoint !== "function") return target;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    return under && svg?.contains(under) ? under : target;
}

/** The index of the connector label under `target`, if it is one. */
function labelIndexOf(target: Element | null): number | null {
    const raw = target?.closest("[data-edge-label]")?.getAttribute("data-edge-label");
    const index = raw === undefined || raw === null ? NaN : Number(raw);
    return Number.isInteger(index) ? index : null;
}

function insideBy(r: Rect, p: Point, by: number): boolean {
    return p.x > r.x + by && p.x < r.x + r.w - by && p.y > r.y + by && p.y < r.y + r.h - by;
}

/**
 * Contextmenu events this hook raised itself after a right-click released
 * without travelling. The handler lets these through the right-drag guard.
 */
const reopenedMenuEvents = new WeakSet<Event>();

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
    /** Bring the comments panel forward (a pin on the canvas was clicked). */
    onOpenComments?: () => void;
    /**
     * A gesture committed a change; `label` is the store's name for it
     * ("Move", "Resize", …). The shell uses it to end auto-arrange when a
     * shape was placed by hand.
     */
    onGestureEnd?: (label: string) => void;
}

export function useCanvasInteractions(
    store: EditorStore,
    svgRef: RefObject<SVGSVGElement | null>,
    callbacks: CanvasCallbacks
): CanvasInteractions {
    const gesture = useRef<Gesture>({ ...IDLE });
    const spaceHeld = useRef(false);
    // Space swaps to the hand tool on a window listener, so a canvas in a
    // background Studio tab has to be told it is not the one being typed at.
    const isActive = useIsActive();
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;
    /** A right-button drag pans; while it lasts the context menu is deferred. */
    const rightPan = useRef(false);
    /**
     * The browser's own `contextmenu` timing differs per platform (macOS fires
     * it at press, Windows at release), so after a right release the handler
     * ignores the native event for a beat — pointerup already decided.
     */
    const ignoreMenuUntil = useRef(0);
    /**
     * What the last pointerdown actually landed on.
     *
     * `dblclick` cannot be trusted to say: per the DOM spec it fires on the
     * *nearest common inclusive ancestor* of the two clicks' targets, and the
     * first click of a double-click selects the shape, which re-renders the
     * canvas and swaps the element under the cursor. The two targets then
     * differ and the browser reports their common ancestor — the `<svg>` —
     * so the handler concluded "empty canvas" and dropped a new topic on top
     * of the shape you were trying to rename. Pointer events have no such
     * rule, so the second pointerdown is the honest answer.
     */
    const lastHit = useRef<{
        nodeId: string | null;
        edgeId: string | null;
        /** A connector's bend handle, which a double-click removes. */
        bend: { edgeId: string; index: number } | null;
        /** Which label of `edgeId` was pressed, when one was. */
        label: number | null;
    }>({
        nodeId: null,
        edgeId: null,
        bend: null,
        label: null,
    });
    // Callbacks come from the editor shell and change identity every render;
    // routing them through a ref keeps every handler below stable.
    const cb = useRef(callbacks);
    cb.current = callbacks;

    // Space temporarily swaps to the hand tool, the way every canvas app does.
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (!isActiveRef.current()) return;
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

    // Escape during a drag abandons it — a connector half drawn, a box half
    // moved, a marquee — and puts everything back as it was. It used to do
    // nothing, and the release then made the connector anyway. Captured
    // first, so the editor's own Escape (clear the selection) does not also
    // run for the same key.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || !isActiveRef.current()) return;
            const g = gesture.current;
            if (g.kind === "none" || g.kind === "pan") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (frame.current !== null) {
                cancelAnimationFrame(frame.current);
                frame.current = null;
            }
            pending.current = [];
            store.cancelInteraction();
            store.setMarquee(null);
            store.setGuides([]);
            store.setDrag({ kind: "none" });
            gesture.current = { ...IDLE };
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [store]);

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

    const openMenuFor = useCallback(
        (clientX: number, clientY: number, target: Element | null) => {
            const nodeId = target?.closest("[data-node-id]")?.getAttribute("data-node-id");
            const edgeId = target?.closest("[data-edge-id]")?.getAttribute("data-edge-id");
            if (nodeId) {
                if (!store.isSelected("node", nodeId)) store.selectNodes([nodeId]);
                cb.current.onContextMenuAt(
                    { x: clientX, y: clientY },
                    { kind: "node", id: nodeId }
                );
                return;
            }
            if (edgeId) {
                if (!store.isSelected("edge", edgeId)) {
                    store.setSelection([{ kind: "edge", id: edgeId }]);
                }
                cb.current.onContextMenuAt(
                    { x: clientX, y: clientY },
                    { kind: "edge", id: edgeId }
                );
                return;
            }
            cb.current.onContextMenuAt({ x: clientX, y: clientY }, { kind: "canvas" });
        },
        [store]
    );

    const onPointerDown = useCallback(
        (e: ReactPointerEvent<SVGSVGElement>) => {
            const state = store.getState();
            if (state.presenting) return;
            // Measure the canvas afresh once per gesture. The cache is only
            // cleared by a resize or scroll, and a panel or menu can move the
            // canvas without either: the first box double-clicked onto a new
            // board landed 52px from the pointer.
            rectRef.current = null;

            const world = toWorld(e.clientX, e.clientY);
            const screen = toScreen(e.clientX, e.clientY);

            // The right button drags the canvas around, Lucid-style. The
            // context menu still exists — it opens from pointerup, and only
            // when the button never travelled (see `onContextMenu`).
            if (e.button === 2) {
                svgRef.current?.setPointerCapture(e.pointerId);
                store.setEditing(null);
                rightPan.current = true;
                gesture.current = {
                    ...IDLE,
                    kind: "pan",
                    origin: world,
                    originScreen: screen,
                };
                store.setDrag({ kind: "pan" });
                return;
            }
            const target = hitTarget(e.target as Element | null, svgRef.current, e);
            const additive = e.shiftKey || e.metaKey || e.ctrlKey;

            // Before any branch below can return early: a resize handle, a
            // port and a pan all end the gesture without reaching the general
            // hit test, and the double-click handler still needs to know what
            // was under the pointer.
            const bendEl = target?.closest("[data-waypoint]");
            const bendEdge = bendEl?.getAttribute("data-edge-id");
            const bendIndex = Number(bendEl?.getAttribute("data-waypoint"));
            lastHit.current = {
                nodeId: target?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null,
                edgeId: target?.closest("[data-edge-id]")?.getAttribute("data-edge-id") ?? null,
                bend:
                    bendEdge && Number.isInteger(bendIndex)
                        ? { edgeId: bendEdge, index: bendIndex }
                        : null,
                label: labelIndexOf(target),
            };

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
                    const edge = page.edges.find(ed => ed.id === edgeId);
                    gesture.current = {
                        ...base,
                        kind: "connect",
                        edgeId,
                        endpoint: end,
                        startEdges: edge ? [edge] : [],
                    };
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
                const owner = nodeId ? nodeById(page, nodeId) : undefined;
                // A press inside the box is a press on the box: select or
                // move it (below). Dots are grabbed on or outside the outline.
                const onBox =
                    owner !== undefined &&
                    insideBy(nodeBounds(owner), world, PORT_INNER_GRACE / state.viewport.zoom);
                if (nodeId && !onBox) {
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
                    mode: docMode(store),
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

            /**
             * Drag the whole selection, from wherever the press landed on it:
             * one of its boxes, one of its connectors, or the space between
             * them inside its frame. Bends and free ends of the connectors
             * that belong to it travel too.
             */
            const startMove = (): boolean => {
                const ids = store.selectedNodeIds().filter(id => !nodeById(page, id)?.locked);
                if (ids.length === 0) return false;
                const moving = withDescendants(page, ids);
                const startNodes = moving
                    .map(id => nodeById(page, id))
                    .filter((nd): nd is DiagramNode => nd !== undefined);
                const startEdges = edgesMovingWith(page, moving, store.selectedEdgeIds());
                store.beginInteraction("Move");
                gesture.current = { ...base, kind: "move", ids, startNodes, startEdges };
                store.setDrag({ kind: "move", ids, origin: world });
                return true;
            };

            // A connector's label: slide it along the line.
            const labelIndex = labelIndexOf(target);
            if (edgeId && !nodeId && labelIndex !== null && !additive) {
                const edge = page.edges.find(e => e.id === edgeId);
                if (edge && !edge.locked) {
                    if (!store.isSelected("edge", edgeId)) {
                        store.setSelection([{ kind: "edge", id: edgeId }]);
                    }
                    store.beginInteraction("Move label");
                    gesture.current = { ...base, kind: "label", edgeId, labelIndex };
                    return;
                }
            }

            if (edgeId && !nodeId) {
                const wasSelected = store.isSelected("edge", edgeId);
                // One connector of a bigger selection: the press moves all of
                // it, exactly as a press on one of its boxes would.
                if (wasSelected && !additive && store.selectedNodeIds().length > 0 && startMove()) {
                    return;
                }
                if (additive) store.toggleSelection({ kind: "edge", id: edgeId });
                else if (!wasSelected) store.setSelection([{ kind: "edge", id: edgeId }]);

                // Dragging the body of an already-selected connector adds a bend
                // there and drags it — the standard way to route a line by hand.
                // The bend is only made once the pointer moves (`bendAt`), so
                // clicking a selected line changes nothing.
                const edge = page.edges.find(e => e.id === edgeId);
                if (wasSelected && !additive && edge && !edge.locked) {
                    const routed = routeEdge(
                        edge,
                        id => nodeById(page, id),
                        visibleNodes(page),
                        page.edges,
                        routeOptionsFor(state.doc.settings)
                    );
                    const index = waypointInsertIndex(routed, edge.waypoints, world);
                    store.beginInteraction("Route connector");
                    gesture.current = {
                        ...base,
                        kind: "waypoint",
                        edgeId,
                        waypointIndex: -1,
                        bendAt: index,
                    };
                    store.setDrag({ kind: "waypoint", edgeId, index });
                    return;
                }
                gesture.current = { ...base, kind: "none" };
                return;
            }

            // A frame's empty inside is room to select in, as on the canvas:
            // a drag there is a marquee over the boxes it holds. The frame
            // itself moves by its title or its edge, or once it is selected.
            const pressed = nodeId ? nodeById(page, nodeId) : undefined;
            const inFrame =
                pressed !== undefined &&
                !additive &&
                !store.isSelected("node", pressed.id) &&
                onFrameBody(pressed, world, FRAME_EDGE / state.viewport.zoom);

            if (nodeId && !inFrame) {
                const node = nodeById(page, nodeId);
                if (node?.locked) {
                    gesture.current = { ...base, kind: "none" };
                    return;
                }
                // A box in a group is taken as its group, unless someone is
                // working inside the group already (double-click goes in).
                const target = clickTarget(page, nodeId, store.getState().selection);
                if (additive) {
                    store.toggleSelection({ kind: "node", id: target });
                } else if (!store.isSelected("node", target)) {
                    store.setSelection([{ kind: "node", id: target }]);
                }
                if (!startMove()) gesture.current = { ...base, kind: "none" };
                return;
            }

            // Empty space inside a multi-selection's frame is part of it, as
            // in Figma and FigJam: pressing there drags the lot rather than
            // throwing the selection away for a marquee.
            if (!additive) {
                const selected = store
                    .selectedNodeIds()
                    .map(id => nodeById(page, id))
                    .filter((nd): nd is DiagramNode => nd !== undefined);
                const frame = selected.length > 1 ? nodesBounds(selected) : null;
                if (frame && rectContains(frame, world) && startMove()) return;
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
                    const delta = { x: totalDx, y: totalDy };
                    store.updatePage(
                        p => {
                            const moved = mapNodes(p, movingIds, nd => {
                                const start = g.startNodes.find(s => s.id === nd.id);
                                if (!start) return nd;
                                return { ...nd, x: start.x + totalDx, y: start.y + totalDy };
                            });
                            if (g.startEdges.length === 0) return moved;
                            const startEdges = new Map(g.startEdges.map(ed => [ed.id, ed]));
                            return mapEdges(moved, [...startEdges.keys()], ed => {
                                const start = startEdges.get(ed.id);
                                return start ? shiftEdge(start, delta) : ed;
                            });
                        },
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
                    // The svg holds pointer capture for the drag, so every
                    // move's `target` IS the svg — it can never say what the
                    // pointer is over, and reading it here meant a drop on a
                    // shape never bound to it. Hit-test the point instead;
                    // the draft line and selection chrome are
                    // pointer-transparent, so the top element is the truth.
                    const under =
                        typeof document.elementFromPoint === "function"
                            ? document.elementFromPoint(e.clientX, e.clientY)
                            : e.target;
                    const hit =
                        under?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
                    const overPort =
                        under?.closest("[data-port]")?.getAttribute("data-port") ?? null;
                    // Near a shape counts as on it: its dots light up, and
                    // the end attaches there on release.
                    // The shape the line starts from is never its own target.
                    const overNode =
                        (hit !== g.fromNodeId ? hit : null) ??
                        snapTarget(activePage(state.doc), world, state.viewport.zoom, g.fromNodeId);
                    const port = overNode && hit === overNode ? overPort : null;
                    const drag = state.drag;
                    if (drag.kind === "connect") {
                        store.setDrag({
                            ...drag,
                            to: world,
                            hoverNodeId: overNode,
                            hoverPort: port,
                        });
                    }
                    // Re-dragging an end: the connector itself follows, so it
                    // reads as moving this line rather than drawing a new one.
                    const original = g.startEdges[0];
                    if (g.edgeId && g.endpoint && original) {
                        const end = g.endpoint;
                        const was = original[end];
                        const next = overNode
                            ? { nodeId: overNode, port: (port as PortId | null) ?? "auto" }
                            : { point: world };
                        store.updatePage(
                            p =>
                                mapEdges(p, [original.id], () => ({
                                    ...original,
                                    [end]: next,
                                    waypoints: overNode === was.nodeId ? original.waypoints : [],
                                })),
                            { transient: true }
                        );
                    }
                    return;
                }

                case "label": {
                    if (!g.edgeId) return;
                    const page = activePage(state.doc);
                    const edge = page.edges.find(e => e.id === g.edgeId);
                    if (!edge) return;
                    const routed = routeEdge(
                        edge,
                        id => nodeById(page, id),
                        visibleNodes(page),
                        page.edges,
                        routeOptionsFor(state.doc.settings)
                    );
                    // Labels ride on the line: only how far along it moves.
                    const t = Math.min(
                        Math.max(projectOntoPolyline(routed.points, world).t, 0.04),
                        0.96
                    );
                    const index = g.labelIndex;
                    store.updatePage(
                        p =>
                            mapEdges(p, [edge.id], ed => ({
                                ...ed,
                                labels: ed.labels.map((l, i) =>
                                    i === index ? { ...l, t, offset: 0 } : l
                                ),
                            })),
                        { transient: true }
                    );
                    return;
                }

                case "waypoint": {
                    if (!g.edgeId) return;
                    if (g.bendAt !== null) {
                        // The drag has started: make the bend it is dragging.
                        const at = g.bendAt;
                        g.bendAt = null;
                        g.waypointIndex = at;
                        store.updatePage(
                            p =>
                                mapEdges(p, [g.edgeId!], ed => {
                                    const waypoints = [...ed.waypoints];
                                    waypoints.splice(at, 0, world);
                                    return { ...ed, waypoints };
                                }),
                            { transient: true }
                        );
                    }
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

            // Released whatever the gesture was: a press that started nothing
            // (selecting a connector) used to keep the canvas capturing, so
            // the second press of a quick double-click reported the canvas as
            // its target and the double-click made a box instead of a label.
            const svg = svgRef.current;
            if (svg?.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);
            const g = gesture.current;
            if (g.kind === "none") return;
            const state = store.getState();
            const world = toWorld(e.clientX, e.clientY);

            switch (g.kind) {
                case "marquee": {
                    const rect = state.marquee;
                    store.setMarquee(null);
                    if (rect && g.moved) {
                        const page = activePage(state.doc);
                        const hits = [
                            ...new Set(
                                visibleNodes(page)
                                    .filter(
                                        nd =>
                                            !nd.locked &&
                                            nd.shape !== "group" &&
                                            // A frame is caught whole, never by
                                            // a marquee drawn inside it.
                                            (isContainer(nd.shape)
                                                ? rectContainsRect(rect, nodeBounds(nd))
                                                : rectsIntersect(rect, nodeBounds(nd)))
                                    )
                                    // Selecting a group member selects the group.
                                    .map(nd => outermostGroup(page, nd.id)?.id ?? nd.id)
                            ),
                        ];
                        // The connectors running between the boxes caught are
                        // part of what was lassoed, so they come too — and a
                        // drag then carries their bends with the boxes.
                        const caught = new Set(withDescendants(page, hits));
                        const edgeHits = page.edges.filter(
                            ed =>
                                !ed.locked &&
                                !ed.hidden &&
                                (ed.from.nodeId ? caught.has(ed.from.nodeId) : false) &&
                                (ed.to.nodeId ? caught.has(ed.to.nodeId) : false)
                        );
                        const refs = [
                            ...hits.map(id => ({ kind: "node" as const, id })),
                            ...edgeHits.map(ed => ({ kind: "edge" as const, id: ed.id })),
                        ];
                        store.setSelection(g.additive ? [...state.selection, ...refs] : refs);
                    }
                    break;
                }

                case "move": {
                    store.setGuides([]);
                    if (g.moved) {
                        reparentIntoContainers(store, g.ids);
                        // Bends that no longer make a clean path are already
                        // drawn without; take them out so their handles go too.
                        const moved = withDescendants(activePage(store.getState().doc), g.ids);
                        store.updatePage(p => dropStaleBends(p, moved), { transient: true });
                        // A box moved by hand on a chart that arranges itself:
                        // the chart stays where it is put from now on, and that
                        // is part of this move's undo step.
                        holdChartInPlace(store);
                    }
                    const settled = store.endInteraction();
                    if (settled) cb.current.onGestureEnd?.(settled);
                    break;
                }

                case "label": {
                    const settled = store.endInteraction();
                    if (settled) cb.current.onGestureEnd?.(settled);
                    break;
                }

                case "resize":
                case "rotate":
                case "waypoint":
                case "ink": {
                    store.setGuides([]);
                    if (g.kind === "waypoint" && g.moved && g.edgeId && g.waypointIndex >= 0) {
                        const now = store.getState();
                        const page = activePage(now.doc);
                        const edge = page.edges.find(ed => ed.id === g.edgeId);
                        const index = g.waypointIndex;
                        if (
                            edge &&
                            isRedundantBend(
                                edge,
                                index,
                                id => nodeById(page, id),
                                BEND_STRAIGHT_TOLERANCE / now.viewport.zoom,
                                visibleNodes(page),
                                page.edges,
                                routeOptionsFor(now.doc.settings)
                            )
                        ) {
                            store.updatePage(
                                p =>
                                    mapEdges(p, [edge.id], ed => ({
                                        ...ed,
                                        waypoints: ed.waypoints.filter((_, i) => i !== index),
                                    })),
                                { transient: true }
                            );
                        }
                    }
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
                    const settled = store.endInteraction();
                    if (settled) cb.current.onGestureEnd?.(settled);
                    break;
                }

                case "connect": {
                    const spawned = finishConnect(store, g, world, w =>
                        stagePoint(svgRef.current, store.getState().viewport, w)
                    );
                    if (spawned && shapeHoldsText(spawned.shape)) {
                        cb.current.onEditText({ kind: "node", id: spawned.id });
                    }
                    break;
                }

                case "insert": {
                    const rect = state.marquee;
                    store.setMarquee(null);
                    const shape = g.insertShape ?? "rectangle";
                    let insertedId: string;
                    if (g.moved && rect && rect.w > 8 && rect.h > 8) {
                        const drawn = createNode({
                            shape,
                            mode: docMode(store),
                            x: rect.x,
                            y: rect.y,
                            w: rect.w,
                            h: rect.h,
                            // Drawn inside a frame, it joins the frame.
                            parentId: isContainer(shape)
                                ? null
                                : (containerAt(activePage(state.doc), {
                                      x: rect.x + rect.w / 2,
                                      y: rect.y + rect.h / 2,
                                  })?.id ?? null),
                        });
                        const look = flowLookOf(store.getState().doc);
                        const node = look
                            ? dressBox(look, drawn, docMode(store), { keepSize: true })
                            : drawn;
                        store.updatePage(p => ({ ...p, nodes: [...p.nodes, node] }), {
                            transient: true,
                        });
                        store.selectNodes([node.id]);
                        store.endInteraction();
                        paintNewTopics(store, isTopicShape(shape) ? [node.id] : []);
                        insertedId = node.id;
                    } else {
                        store.cancelInteraction();
                        insertedId = insertShape(store, shape, g.origin);
                    }
                    // Disarm first: `setTool` clears `editing`, so opening the
                    // label above this line would silently undo it — which is
                    // why placing a text box or a sticky never did land you in
                    // the field the way double-clicking one does.
                    store.setTool("select");
                    // Drop into the label straight away. A box you have to
                    // discover is double-clickable does not read as a container
                    // you put words in; one with a caret in it does, and it
                    // saves the second gesture besides.
                    if (shapeHoldsText(shape)) {
                        cb.current.onEditText({ kind: "node", id: insertedId });
                    }
                    break;
                }

                case "pan":
                    if (rightPan.current) {
                        rightPan.current = false;
                        // Whatever the platform's contextmenu timing, the
                        // release has decided: swallow any trailing native
                        // event…
                        ignoreMenuUntil.current = performance.now() + 350;
                        if (!g.moved) {
                            // …and for a right *click*, raise a marked one of
                            // our own so the menu opens on release. Dispatch
                            // it on whatever is under the pointer (capture
                            // made `e.target` the svg), so a right-click on a
                            // shape selects and targets that shape.
                            const under =
                                (typeof document.elementFromPoint === "function"
                                    ? document.elementFromPoint(e.clientX, e.clientY)
                                    : null) ?? svgRef.current;
                            if (under) {
                                const reopened = new MouseEvent("contextmenu", {
                                    bubbles: true,
                                    cancelable: true,
                                    clientX: e.clientX,
                                    clientY: e.clientY,
                                });
                                reopenedMenuEvents.add(reopened);
                                under.dispatchEvent(reopened);
                            }
                        }
                    }
                    break;
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
            rectRef.current = null;

            // `lastHit` first, `e.target` only as a fallback: see the ref's
            // docblock for why the event's own target lies here. Reading the
            // event too covers the case where a double-click arrives without a
            // preceding pointerdown we saw (synthetic events, some a11y tools).
            const target = hitTarget(e.target as Element | null, svgRef.current, e);
            // A bend's handle: double-clicking it takes the bend out, the
            // draw.io convention — otherwise a bend, once made, could only be
            // cleared together with every other one ("Reset route").
            const bend = lastHit.current.bend;
            if (bend) {
                removeBend(store, bend.edgeId, bend.index);
                store.setSelection([{ kind: "edge", id: bend.edgeId }]);
                return;
            }
            const nodeId =
                lastHit.current.nodeId ??
                target?.closest("[data-node-id]")?.getAttribute("data-node-id") ??
                null;
            const world = toWorld(e.clientX, e.clientY);
            const page = activePage(state.doc);
            const hitNode = nodeId ? nodeById(page, nodeId) : undefined;
            // Inside a frame, below its title, a double-click is a double-click
            // on the board there — what it makes joins the frame. Its title is
            // renamed by double-clicking the title itself.
            const frame =
                hitNode && hitNode.shape === "frame" && world.y > hitNode.y ? hitNode : undefined;
            if (nodeId && hitNode && !frame) {
                if (hitNode.locked) return;
                // A box in a group: the first double-click goes inside the
                // group and selects it; the next one opens its label.
                const group = outermostGroup(page, nodeId);
                if (group && !store.isSelected("node", nodeId)) {
                    store.selectNodes([nodeId]);
                    return;
                }
                store.selectNodes([nodeId]);
                cb.current.onEditText({ kind: "node", id: nodeId });
                return;
            }
            const edgeId =
                lastHit.current.edgeId ??
                target?.closest("[data-edge-id]")?.getAttribute("data-edge-id") ??
                null;
            if (edgeId) {
                store.setSelection([{ kind: "edge", id: edgeId }]);
                // The label double-clicked, or the first (a connector carries
                // one label unless someone adds more).
                cb.current.onEditText({
                    kind: "edge-label",
                    id: edgeId,
                    index: lastHit.current.label ?? 0,
                });
                return;
            }
            // Empty canvas: on a flowchart, the "What goes here?" menu opens
            // there; on a mindmap, a topic is dropped where they clicked, and
            // typing starts.
            if (
                flowUiFor(store)?.onCanvasDoubleClick(store, {
                    world,
                    screen: stagePoint(svgRef.current, state.viewport, world),
                })
            ) {
                return;
            }
            const flow = worksAsFlow(state.doc.settings.kind);
            const look = flowLookOf(state.doc);
            const made = createNodeAt(
                look ? look.stepShape : flow ? "process" : "mind-branch",
                world,
                {
                    mode: docMode(store),
                    parentId: frame?.id ?? containerAt(page, world)?.id ?? null,
                }
            );
            const node = look ? dressBox(look, made, docMode(store)) : made;
            store.updatePage(p => ({ ...p, nodes: [...p.nodes, node] }), {
                label: flow ? "Add step" : "Add topic",
            });
            if (!flow) paintNewTopics(store, [node.id]);
            store.selectNodes([node.id]);
            cb.current.onEditText({ kind: "node", id: node.id });
        },
        [store, svgRef, toWorld]
    );

    const onContextMenu = useCallback(
        (e: ReactMouseEvent<SVGSVGElement>) => {
            // A right press is a pan until proven otherwise: swallow the
            // native event (preventDefault also stops the Radix trigger
            // above us, which skips a default-prevented event) and let
            // pointerup re-dispatch a marked one if the pointer never moved.
            if (
                !reopenedMenuEvents.has(e.nativeEvent) &&
                (rightPan.current || performance.now() < ignoreMenuUntil.current)
            ) {
                e.preventDefault();
                return;
            }
            // Fix the selection, then let the event bubble on unprevented —
            // the Radix trigger wrapping the canvas opens the menu from it.
            openMenuFor(e.clientX, e.clientY, e.target as Element | null);
        },
        [openMenuFor]
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

/**
 * Ends a connector gesture. Returns the box the drag made (so the caller can
 * drop the user into its label), null for every other outcome.
 *
 * Out of one of a shape's dots:
 * - onto another shape's body, or close enough to it (`snapTarget`): joined
 *   by the sides that face each other — the dot was a handle to start the
 *   drag, not a promise about where the line leaves (left pinned, a drag
 *   from a right-hand dot to a box on the left ran back through its own box);
 * - onto another shape's dot: pinned to both dots, the precise gesture;
 * - into empty space from a topic: the next topic (the mindmap gesture);
 * - into empty space from any other shape: the arrow, with a free end to
 *   re-drag onto the intended shape — a missed drop must not invent a box;
 * - a click, or a drag too short to mean anything: just selects the box. A
 *   plain click on a dot used to mint a new box, and the dots reach a few
 *   pixels into the shape, so clicking near an edge to select a box made one.
 *
 * Whatever is drawn ends up selected, so Delete takes it straight back.
 */
/**
 * Where a board point sits on the editor's stage (the element marked
 * `data-mindmap-stage`), in CSS px from its top-left — where a direction's
 * `StageOverlay` positions a menu. The canvas can sit below rulers, so the
 * <svg>'s own offset inside the stage is added.
 */
function stagePoint(
    svg: SVGSVGElement | null,
    viewport: { x: number; y: number; zoom: number },
    world: Point
): Point {
    const onSvg = worldToScreen(viewport, world);
    const stage = svg?.closest("[data-mindmap-stage]");
    if (!svg || !stage) return onSvg;
    const a = svg.getBoundingClientRect();
    const b = stage.getBoundingClientRect();
    return { x: onSvg.x + a.left - b.left, y: onSvg.y + a.top - b.top };
}

function finishConnect(
    store: EditorStore,
    g: Gesture,
    world: Point,
    toStage: (world: Point) => Point
): DiagramNode | null {
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
                    // A bend placed for the old end rarely suits the new one.
                    const reset = hoverNodeId !== (end === "from" ? ed.from : ed.to).nodeId;
                    return {
                        ...(end === "from" ? { ...ed, from: next } : { ...ed, to: next }),
                        waypoints: reset ? [] : ed.waypoints,
                    };
                }),
            { transient: true }
        );
        store.endInteraction();
        return null;
    }

    const page = activePage(state.doc);
    const fromNodeId = g.fromNodeId;
    const source = fromNodeId ? nodeById(page, fromNodeId) : undefined;
    const fromDot = source !== undefined && g.fromPort !== null && g.fromPort !== "auto";
    const travelled = Math.hypot(world.x - g.origin.x, world.y - g.origin.y) * state.viewport.zoom;

    let targetNodeId = hoverNodeId;
    let created: DiagramNode | null = null;
    // Released back on (or right beside) the box it came from: nothing. A
    // line from a box to a point inside itself is drawn under its fill,
    // invisible and unclickable; one to just outside it is a stub.
    const home = source ? nodeBounds(source) : null;
    const reach = SNAP_TO_SHAPE / state.viewport.zoom;
    const backHome =
        home !== null &&
        !targetNodeId &&
        world.x >= home.x - reach &&
        world.x <= home.x + home.w + reach &&
        world.y >= home.y - reach &&
        world.y <= home.y + home.h + reach;
    const flow = flowUiFor(store);
    if (!targetNodeId) {
        const click = !g.moved || (fromDot && travelled < MIN_CONNECT_DRAG);
        if (click || backHome) {
            store.cancelInteraction();
            if (fromDot && source) store.selectNodes([source.id]);
            return null;
        }
        if (fromNodeId && flow) {
            // An arrow let go over empty space on a flowchart: the "What goes
            // here?" menu opens there. The drag is undone first, so whatever
            // it makes is its own undo step; dismissing it leaves nothing.
            store.cancelInteraction();
            const handled = flow.onConnectDropInSpace(store, {
                sourceId: fromNodeId,
                port: g.fromPort,
                world,
                screen: toStage(world),
            });
            if (!handled) {
                const look = flowLookOf(store.getState().doc);
                insertEdge(
                    store,
                    createEdge({
                        from: { nodeId: fromNodeId, port: "auto" },
                        to: { point: world },
                        kind: state.doc.settings.defaultEdgeKind,
                        ...(look ? edgeOptions(look, docMode(store)) : {}),
                    })
                );
            }
            return null;
        }
        if (fromDot && source?.shape.startsWith("mind-")) {
            created = nextTopicLike(store, source, world);
            targetNodeId = created.id;
        }
    }

    if (fromNodeId && targetNodeId === fromNodeId && !created) {
        store.cancelInteraction();
        if (fromDot && source) store.selectNodes([source.id]);
        return null;
    }

    // The target end is pinned when it was dropped on a dot; the start never
    // is (pinned too, a drop on the near dot of a box behind it made the line
    // leave by the far side and U-turn round its own box).
    const pinned = targetNodeId !== null && created === null && hoverPort !== null;
    const look = flowLookOf(state.doc);
    const edge = createEdge({
        from: fromNodeId ? { nodeId: fromNodeId, port: "auto" } : { point: g.origin },
        to: targetNodeId
            ? { nodeId: targetNodeId, port: pinned ? (hoverPort as PortId) : "auto" }
            : { point: world },
        kind: state.doc.settings.defaultEdgeKind,
        ...(look ? edgeOptions(look, docMode(store)) : {}),
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
    if (created) {
        // A topic pulled out of a topic joins that branch: its colour and its
        // connector's come from where it now sits, like one added with Tab.
        if (isTopicShape(created.shape)) paintNewTopics(store, [created.id]);
        store.selectNodes([created.id]);
        return created;
    }
    // The line just drawn is what the next key acts on: Delete takes it back,
    // a double-click labels it.
    store.setSelection([{ kind: "edge", id: edge.id }]);
    return null;
}

/** The topic a connector dragged out of a topic into empty space makes. */
function nextTopicLike(store: EditorStore, source: DiagramNode, at: Point): DiagramNode {
    // The new topic inherits its parent's look unless the parent is the
    // root, whose filled-pill styling would swamp a child.
    return createNodeAt("mind-branch", at, {
        mode: docMode(store),
        w: source.shape !== "mind-root" ? source.w : 160,
        h: source.shape !== "mind-root" ? source.h : 54,
    });
}

/** How near (screen px) a dropped connector end must be to a shape to attach to it. */
const SNAP_TO_SHAPE = 24;

/**
 * The shape a connector end being dragged at `world` would attach to: the
 * one under the pointer, else the nearest within `SNAP_TO_SHAPE` of its
 * outline. A line released a few pixels short of a box used to be left
 * dangling beside it.
 */
function snapTarget(
    page: DiagramPage,
    world: Point,
    zoom: number,
    exclude: string | null
): string | null {
    const reach = SNAP_TO_SHAPE / zoom;
    let best: { id: string; d: number } | null = null;
    for (const nd of visibleNodes(page)) {
        if (nd.id === exclude || nd.locked || isContainer(nd.shape) || nd.shape === "ink") continue;
        const r = nodeBounds(nd);
        const dx = Math.max(r.x - world.x, 0, world.x - (r.x + r.w));
        const dy = Math.max(r.y - world.y, 0, world.y - (r.y + r.h));
        const d = Math.hypot(dx, dy);
        if (d <= reach && (!best || d < best.d)) best = { id: nd.id, d };
    }
    return best?.id ?? null;
}
