/**
 * The editor store.
 *
 * A tiny external store (subscribe / getSnapshot) rather than React state,
 * because the canvas mutates on every pointer move: routing through React's
 * reducer would re-render the whole tree per frame, and refs alone would put
 * the document out of reach of the panels. Components subscribe with
 * `useSyncExternalStore` and select the slice they care about.
 *
 * History is snapshot-based. Documents are edited immutably, so an undo entry
 * is one object reference — pushing a snapshot costs nothing beyond the
 * structural sharing the edit already paid for.
 */

import { activePage, updatePage } from "./doc";
import { MAX_ZOOM, MIN_ZOOM, clamp } from "./geometry";
import type { SnapGuide } from "./snapping";
import type {
    DiagramPage,
    MindmapDoc,
    Rect,
    SelectionRef,
    ShapeId,
    ToolId,
    Viewport,
} from "./types";

// ---------------------------------------------------------------------------
// Transient interaction state
// ---------------------------------------------------------------------------

export type DragMode =
    | { kind: "none" }
    | { kind: "pan" }
    | { kind: "marquee"; origin: { x: number; y: number } }
    | { kind: "move"; ids: string[]; origin: { x: number; y: number } }
    | {
          kind: "resize";
          ids: string[];
          handle: ResizeHandle;
          origin: { x: number; y: number };
          startBounds: Rect;
      }
    | { kind: "rotate"; ids: string[]; centre: { x: number; y: number }; startAngle: number }
    | {
          kind: "connect";
          fromNodeId: string | null;
          fromPort: string | null;
          fromPoint: { x: number; y: number };
          to: { x: number; y: number };
          hoverNodeId: string | null;
          hoverPort: string | null;
          /** Set when re-dragging an existing edge's endpoint. */
          edgeId?: string;
          end?: "from" | "to";
      }
    | { kind: "waypoint"; edgeId: string; index: number }
    | { kind: "ink"; nodeId: string }
    | { kind: "insert"; shape: ShapeId; origin: { x: number; y: number } };

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface TextEditTarget {
    kind: "node" | "edge-label";
    id: string;
    /** Label index for `edge-label`. */
    index?: number;
}

export interface EditorState {
    doc: MindmapDoc;
    selection: SelectionRef[];
    viewport: Viewport;
    tool: ToolId;
    /** Shape armed for the `shape` tool. */
    pendingShape: ShapeId | null;
    editing: TextEditTarget | null;
    drag: DragMode;
    marquee: Rect | null;
    guides: SnapGuide[];
    hoverNodeId: string | null;
    hoverEdgeId: string | null;
    /** Ids matched by the on-canvas find box. */
    highlighted: string[];
    /** Bumped whenever the doc changes in a way the server hasn't seen. */
    dirty: boolean;
    /** Wall-clock of the last successful save, for the status chip. */
    savedAt: number | null;
    saving: boolean;
    /** Presentation mode hides every panel and fits the current page. */
    presenting: boolean;
    canUndo: boolean;
    canRedo: boolean;
}

export interface CommitOptions {
    /** Shown in the history menu. */
    label?: string;
    /**
     * Successive commits sharing a key inside `COALESCE_MS` collapse into one
     * undo entry — typing a label should not cost one entry per keystroke.
     */
    coalesceKey?: string;
    /** Skip the history stack entirely (viewport, hover, drag previews). */
    transient?: boolean;
}

const COALESCE_MS = 600;
const HISTORY_LIMIT = 200;

interface HistoryEntry {
    doc: MindmapDoc;
    selection: SelectionRef[];
    label: string;
    key?: string;
    at: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class EditorStore {
    private state: EditorState;
    private listeners = new Set<() => void>();
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    /** Snapshot captured at `beginInteraction`, pushed at `endInteraction`. */
    private interactionBase: HistoryEntry | null = null;

    constructor(doc: MindmapDoc) {
        this.state = {
            doc,
            selection: [],
            viewport: { x: -100, y: -100, zoom: 1 },
            tool: "select",
            pendingShape: null,
            editing: null,
            drag: { kind: "none" },
            marquee: null,
            guides: [],
            hoverNodeId: null,
            hoverEdgeId: null,
            highlighted: [],
            dirty: false,
            savedAt: null,
            saving: false,
            presenting: false,
            canUndo: false,
            canRedo: false,
        };
    }

    // -- subscription -------------------------------------------------------

    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };

    getState = (): EditorState => this.state;

    private emit(): void {
        for (const fn of this.listeners) fn();
    }

    private set(patch: Partial<EditorState>): void {
        this.state = { ...this.state, ...patch };
        this.emit();
    }

    // -- document -----------------------------------------------------------

    /**
     * Apply an immutable update to the document. Returning the same reference
     * (or `null`) is a no-op, so callers can bail out without an `if`.
     */
    update(fn: (doc: MindmapDoc) => MindmapDoc | null, options: CommitOptions = {}): void {
        const next = fn(this.state.doc);
        if (!next || next === this.state.doc) return;

        if (!options.transient) this.pushHistory(options);
        this.state = { ...this.state, doc: next, dirty: true };
        this.refreshHistoryFlags();
        this.emit();
    }

    /** Convenience: edit the active page. */
    updatePage(fn: (page: DiagramPage) => DiagramPage | null, options: CommitOptions = {}): void {
        this.update(doc => {
            const page = activePage(doc);
            const next = fn(page);
            if (!next || next === page) return null;
            return updatePage(doc, page.id, () => next);
        }, options);
    }

    /** Replace the whole document (open, import, revert to revision). */
    replaceDoc(doc: MindmapDoc, options: CommitOptions = {}): void {
        if (!options.transient) this.pushHistory({ label: options.label ?? "Replace document" });
        this.state = {
            ...this.state,
            doc,
            selection: [],
            editing: null,
            dirty: !options.transient,
        };
        this.refreshHistoryFlags();
        this.emit();
    }

    /** Mark the current document as persisted. */
    markSaved(at = Date.now()): void {
        this.set({ dirty: false, savedAt: at, saving: false });
    }

    setSaving(saving: boolean): void {
        this.set({ saving });
    }

    // -- history ------------------------------------------------------------

    private pushHistory(options: CommitOptions): void {
        const now = Date.now();
        const top = this.undoStack[this.undoStack.length - 1];
        if (
            options.coalesceKey &&
            top &&
            top.key === options.coalesceKey &&
            now - top.at < COALESCE_MS
        ) {
            top.at = now;
            this.redoStack = [];
            return;
        }
        this.undoStack.push({
            doc: this.state.doc,
            selection: this.state.selection,
            label: options.label ?? "Edit",
            key: options.coalesceKey,
            at: now,
        });
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = [];
    }

    private refreshHistoryFlags(): void {
        this.state = {
            ...this.state,
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0,
        };
    }

    /**
     * Snapshot the document before a multi-frame gesture. Pointer moves then
     * run `transient`, and `endInteraction` turns the whole gesture into one
     * undo entry.
     */
    beginInteraction(label: string): void {
        this.interactionBase = {
            doc: this.state.doc,
            selection: this.state.selection,
            label,
            at: Date.now(),
        };
    }

    endInteraction(): void {
        const base = this.interactionBase;
        this.interactionBase = null;
        if (!base) return;
        if (base.doc === this.state.doc) return; // gesture changed nothing
        this.undoStack.push(base);
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = [];
        this.refreshHistoryFlags();
        this.emit();
    }

    /** Abandon a gesture and restore the document as it was when it began. */
    cancelInteraction(): void {
        const base = this.interactionBase;
        this.interactionBase = null;
        if (!base) return;
        this.state = {
            ...this.state,
            doc: base.doc,
            selection: base.selection,
            drag: { kind: "none" },
            marquee: null,
            guides: [],
        };
        this.emit();
    }

    undo(): void {
        const entry = this.undoStack.pop();
        if (!entry) return;
        this.redoStack.push({
            doc: this.state.doc,
            selection: this.state.selection,
            label: entry.label,
            at: Date.now(),
        });
        this.state = {
            ...this.state,
            doc: entry.doc,
            selection: entry.selection,
            editing: null,
            dirty: true,
        };
        this.refreshHistoryFlags();
        this.emit();
    }

    redo(): void {
        const entry = this.redoStack.pop();
        if (!entry) return;
        this.undoStack.push({
            doc: this.state.doc,
            selection: this.state.selection,
            label: entry.label,
            at: Date.now(),
        });
        this.state = {
            ...this.state,
            doc: entry.doc,
            selection: entry.selection,
            editing: null,
            dirty: true,
        };
        this.refreshHistoryFlags();
        this.emit();
    }

    historyLabels(): { undo: string | null; redo: string | null } {
        return {
            undo: this.undoStack[this.undoStack.length - 1]?.label ?? null,
            redo: this.redoStack[this.redoStack.length - 1]?.label ?? null,
        };
    }

    // -- selection ----------------------------------------------------------

    setSelection(selection: SelectionRef[]): void {
        this.set({ selection });
    }

    selectNodes(ids: readonly string[]): void {
        this.set({ selection: ids.map(id => ({ kind: "node" as const, id })) });
    }

    addToSelection(ref: SelectionRef): void {
        if (this.state.selection.some(s => s.kind === ref.kind && s.id === ref.id)) return;
        this.set({ selection: [...this.state.selection, ref] });
    }

    toggleSelection(ref: SelectionRef): void {
        const has = this.state.selection.some(s => s.kind === ref.kind && s.id === ref.id);
        this.set({
            selection: has
                ? this.state.selection.filter(s => !(s.kind === ref.kind && s.id === ref.id))
                : [...this.state.selection, ref],
        });
    }

    clearSelection(): void {
        if (this.state.selection.length === 0) return;
        this.set({ selection: [] });
    }

    isSelected(kind: SelectionRef["kind"], id: string): boolean {
        return this.state.selection.some(s => s.kind === kind && s.id === id);
    }

    selectedNodeIds(): string[] {
        return this.state.selection.filter(s => s.kind === "node").map(s => s.id);
    }

    selectedEdgeIds(): string[] {
        return this.state.selection.filter(s => s.kind === "edge").map(s => s.id);
    }

    // -- viewport -----------------------------------------------------------

    setViewport(next: Partial<Viewport>): void {
        const viewport = { ...this.state.viewport, ...next };
        viewport.zoom = clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM);
        this.set({ viewport });
    }

    panBy(dx: number, dy: number): void {
        const { viewport } = this.state;
        this.setViewport({
            x: viewport.x + dx / viewport.zoom,
            y: viewport.y + dy / viewport.zoom,
        });
    }

    // -- tools & transient --------------------------------------------------

    setTool(tool: ToolId, pendingShape: ShapeId | null = null): void {
        this.set({ tool, pendingShape, editing: null });
    }

    setEditing(editing: TextEditTarget | null): void {
        this.set({ editing });
    }

    setDrag(drag: DragMode): void {
        this.set({ drag });
    }

    setMarquee(marquee: Rect | null): void {
        this.set({ marquee });
    }

    setGuides(guides: SnapGuide[]): void {
        if (guides.length === 0 && this.state.guides.length === 0) return;
        this.set({ guides });
    }

    setHover(nodeId: string | null, edgeId: string | null = null): void {
        if (this.state.hoverNodeId === nodeId && this.state.hoverEdgeId === edgeId) return;
        this.set({ hoverNodeId: nodeId, hoverEdgeId: edgeId });
    }

    setHighlighted(ids: string[]): void {
        this.set({ highlighted: ids });
    }

    setPresenting(presenting: boolean): void {
        this.set({ presenting, selection: presenting ? [] : this.state.selection });
    }
}
