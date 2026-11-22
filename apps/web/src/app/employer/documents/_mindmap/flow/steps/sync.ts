/**
 * The Steps panel — keeping the lines and the chart in step.
 *
 * Text to chart: every edit in the panel is drawn a moment later (at most
 * `PREVIEW_MAX_WAIT` after the first unsynced keystroke, or `PREVIEW_DELAY`
 * after the last). Those drawings are transient — no undo entry each — and
 * when the typing stops (`BURST_IDLE`, or the panel loses focus) the burst
 * lands as one entry: rolled back to where it started and committed once,
 * the same trick `commitNodeText` uses for a label's growth previews.
 *
 * Chart to text: when the page changes and it was not this controller's
 * doing, it catches up once the label or gesture in flight is finished.
 * A page it has written before (undo, redo) brings back the text it was
 * written from, blank lines and all. Anything else is an edit on the canvas,
 * and the canvas wins: `reconcileSteps` writes it into the lines when they
 * can say it, else the chart is written out afresh (`serializeSteps`). The
 * chart is never redrawn into a different one from a canvas edit — the keys
 * and the menu draw things (a branch under a fresh question) the old lines
 * could not hold.
 *
 * No React here: the panel subscribes to it, and the tests drive it with a
 * store alone.
 */

import { arrangesItself } from "../../model/commands";
import { activePage } from "../../model/doc";
import { tidyChart } from "../../model/flowchart/arrange";
import { boardMode, flowchartLook } from "../../model/flowchart/look";
import { reconcileSteps, serializeSteps, type StepsBinding } from "../../model/flowchart/reconcile";
import { applySteps, samePage, structureOf, type ApplyResult } from "../../model/flowchart/steps";
import { parseSteps, type StepsParse } from "../../model/flowchart/syntax";
import type { EditorStore } from "../../model/store";
import type { DiagramPage, MindmapDoc, Point, SelectionRef } from "../../model/types";

export const PREVIEW_DELAY = 180;
export const PREVIEW_MAX_WAIT = 300;
export const BURST_IDLE = 1200;
/** History labels are stored in English, like every other command's. */
export const BURST_LABEL = "Edit steps";

export interface StepsSnapshot {
    /** The text in the panel, as typed. */
    text: string;
    /** What it says (notes, the glyph beside each line). */
    parse: StepsParse;
    /** The lines as last drawn and the box behind each step: caret ↔ selection. */
    bound: StepsBinding;
}

export interface StepsSyncOptions {
    /** Where a first step goes on an empty board (the top of the view). */
    origin?: () => Point | undefined;
    /** Defer the catch-up past the edit in flight. Tests may run it inline. */
    defer?: (fn: () => void) => void;
}

function bindingFor(text: string, ids: Array<string | null>): StepsBinding {
    return { text, parse: parseSteps(text), ids };
}

export class StepsSync {
    private snapshot: StepsSnapshot;
    private readonly listeners = new Set<() => void>();
    /** The lines each page was drawn from, so undo and redo bring them back exactly. */
    private readonly written = new WeakMap<DiagramPage, StepsBinding>();
    /** The last lines settled for each page id. */
    private readonly settled = new Map<string, StepsBinding>();
    private seen: DiagramPage;
    private pending: string | null = null;
    private pendingSince = 0;
    private previewTimer: ReturnType<typeof setTimeout> | null = null;
    private burst: { doc: MindmapDoc; selection: SelectionRef[] } | null = null;
    private burstTimer: ReturnType<typeof setTimeout> | null = null;
    /** Set while this controller writes to the store, so it does not catch up with itself. */
    private writing = false;
    private queued = false;
    private unsubscribe: (() => void) | null = null;

    constructor(
        private readonly store: EditorStore,
        private options: StepsSyncOptions = {}
    ) {
        const page = activePage(store.getState().doc);
        const out = serializeSteps(page);
        const bound = bindingFor(out.text, out.ids);
        this.seen = page;
        this.written.set(page, bound);
        this.settled.set(page.id, bound);
        this.snapshot = { text: bound.text, parse: bound.parse, bound };
    }

    // -- subscription -------------------------------------------------------

    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };

    getSnapshot = (): StepsSnapshot => this.snapshot;

    private emit(): void {
        for (const fn of this.listeners) fn();
    }

    /** Start following the store. Safe to call again after `stop`. */
    start(): void {
        if (this.unsubscribe) return;
        this.unsubscribe = this.store.subscribe(this.onStore);
        this.onStore();
    }

    /** Draw what is pending, close the burst, stop following. */
    stop(): void {
        this.flush();
        this.endBurst();
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    /** Where a first step goes on an empty board; the panel knows the view. */
    setOrigin(origin: () => Point | undefined): void {
        this.options.origin = origin;
    }

    // -- text → chart --------------------------------------------------------

    /** The panel's text changed. */
    edit(text: string): void {
        if (text === this.snapshot.text) return;
        this.snapshot = { ...this.snapshot, text, parse: parseSteps(text) };
        this.emit();
        const now = Date.now();
        if (this.pending === null) this.pendingSince = now;
        this.pending = text;
        if (this.previewTimer) clearTimeout(this.previewTimer);
        const wait = Math.max(
            0,
            Math.min(PREVIEW_DELAY, this.pendingSince + PREVIEW_MAX_WAIT - now)
        );
        this.previewTimer = setTimeout(() => this.flush(), wait);
    }

    /** Draw the pending text now. */
    flush(): void {
        if (this.previewTimer) clearTimeout(this.previewTimer);
        this.previewTimer = null;
        const text = this.pending;
        this.pending = null;
        if (text !== null) this.draw(text);
    }

    /** Replace every line (Use an example) as one undo entry. */
    replace(text: string, label = BURST_LABEL): void {
        this.flush();
        this.endBurst();
        this.edit(text);
        this.flush();
        this.endBurst(label);
    }

    private draw(text: string): void {
        const state = this.store.getState();
        const page = activePage(state.doc);
        const prev = this.written.get(page) ?? this.settled.get(page.id);
        const parse = parseSteps(text);
        const result = this.placed(
            page,
            applySteps(page, parse, {
                look: flowchartLook,
                mode: boardMode(state.doc),
                order: prev?.ids.filter((id): id is string => !!id),
                origin: this.options.origin?.(),
                keepPlaced: !arrangesItself(state.doc),
            })
        );
        if (result.page !== page) {
            this.burst ??= { doc: state.doc, selection: state.selection };
            this.write(() => this.store.updatePage(() => result.page, { transient: true }));
            this.pruneSelection();
            if (this.burstTimer) clearTimeout(this.burstTimer);
            this.burstTimer = setTimeout(() => this.endBurst(), BURST_IDLE);
        }
        this.settle(activePage(this.store.getState().doc), {
            text,
            parse,
            ids: result.ids,
        });
    }

    /**
     * Land the typing since the burst began as one undo entry: back to where
     * it started, then forward to where it is, in one notification.
     */
    endBurst(label = BURST_LABEL): void {
        if (this.burstTimer) clearTimeout(this.burstTimer);
        this.burstTimer = null;
        const base = this.burst;
        this.burst = null;
        if (!base) return;
        const state = this.store.getState();
        const latest = state.doc;
        if (latest === base.doc) return;
        const selection = state.selection;
        this.write(() =>
            this.store.batch(() => {
                this.store.update(() => base.doc, { transient: true });
                this.store.setSelection(base.selection);
                this.store.update(() => latest, { label });
                this.store.setSelection(selection);
            })
        );
    }

    // -- chart → text --------------------------------------------------------

    private onStore = (): void => {
        if (this.writing || this.queued) return;
        if (activePage(this.store.getState().doc) === this.seen) return;
        this.queued = true;
        (this.options.defer ?? queueMicrotask)(() => {
            this.queued = false;
            this.catchUp();
        });
    };

    /** Bring the lines up to date with the page, if it changed under them. */
    catchUp(): void {
        const state = this.store.getState();
        const page = activePage(state.doc);
        if (page === this.seen) return;
        // A label being typed or a box being dragged is not finished yet; the
        // store notifies again when it is.
        if (state.editing || state.drag.kind !== "none") return;

        const known = this.written.get(page);
        if (known) {
            // Undo, redo, or back to a page: the lines it was drawn from.
            this.cancelPending();
            this.burst = null;
            this.settle(page, known, true);
            return;
        }
        const base = this.settled.get(page.id);
        if (!base) {
            this.cancelPending();
            const out = serializeSteps(page);
            this.settle(page, bindingFor(out.text, out.ids), true);
            return;
        }
        if (this.pending !== null) {
            // Typing raced an edit elsewhere; the typing is drawn over it.
            this.flush();
            return;
        }
        this.endBurst();

        // An edit made on the canvas stays as it was made; the lines follow.
        // They are edited where they stand (keeping their spacing and order)
        // when that says the same chart, else written out afresh — the keys
        // and the menu draw things the old lines could not hold, like a
        // branch under a question they never had. Redrawing from the lines
        // may lay the chart out, and put back an arrow the lines imply (a
        // step flows on to the next line), but never takes away or changes a
        // box or an arrow the canvas has.
        const draw = (written: { text: string; ids: Array<string | null> }) => {
            const parse = parseSteps(written.text);
            const result = this.placed(
                page,
                applySteps(page, parse, {
                    look: flowchartLook,
                    mode: boardMode(state.doc),
                    ids: written.ids,
                    order: base.ids.filter((id): id is string => !!id),
                    origin: this.options.origin?.(),
                    keepPlaced: !arrangesItself(state.doc),
                })
            );
            return { out: written, parse, result, fit: fitOf(page, result.page) };
        };
        const tries = [
            ...(base.text.trim() === "" ? [] : [draw(reconcileSteps(base, page))]),
            draw(serializeSteps(page)),
        ];
        const drawn =
            tries.find(t => t.fit === "same") ??
            tries.find(t => t.fit === "adds") ??
            tries[tries.length - 1]!;
        const { out, parse, result } = drawn;
        if (result.page !== page && drawn.fit !== "loses") {
            this.write(() => this.store.updatePage(() => result.page, { transient: true }));
            this.pruneSelection();
        }
        this.settle(
            activePage(this.store.getState().doc),
            { text: out.text, parse, ids: result.ids },
            true
        );
    }

    /**
     * Where the redrawn steps go. `applySteps` lays them out from scratch, or
     * — on a hand-placed chart (`keepPlaced`) — puts back everything already
     * placed and places only new boxes. A chart that arranges itself is then
     * laid out the way Tab lays it out (`tidyChart`), so the panel and the
     * keys agree on one arrangement.
     */
    private placed(page: DiagramPage, result: ApplyResult): ApplyResult {
        if (result.page === page) return result;
        const next = arrangesItself(this.store.getState().doc)
            ? tidyChart(result.page, result.ids)
            : result.page;
        // Laid out again to where it already was: nothing to commit.
        if (samePage(page, next)) return { ...result, page };
        return next === result.page ? result : { ...result, page: next };
    }

    // -- housekeeping ------------------------------------------------------------

    private settle(page: DiagramPage, bound: StepsBinding, withText = false): void {
        this.seen = page;
        this.written.set(page, bound);
        this.settled.set(page.id, bound);
        this.snapshot = withText
            ? { text: bound.text, parse: bound.parse, bound }
            : { ...this.snapshot, bound };
        this.emit();
    }

    private cancelPending(): void {
        if (this.previewTimer) clearTimeout(this.previewTimer);
        this.previewTimer = null;
        this.pending = null;
    }

    private write(fn: () => void): void {
        this.writing = true;
        try {
            fn();
        } finally {
            this.writing = false;
        }
    }

    /** Drop selected boxes and arrows the redraw removed. */
    private pruneSelection(): void {
        const { doc, selection } = this.store.getState();
        const page = activePage(doc);
        const nodes = new Set(page.nodes.map(nd => nd.id));
        const edges = new Set(page.edges.map(e => e.id));
        const kept = selection.filter(s =>
            s.kind === "node" ? nodes.has(s.id) : s.kind === "edge" ? edges.has(s.id) : true
        );
        if (kept.length !== selection.length) this.write(() => this.store.setSelection(kept));
    }

    // -- lines ↔ boxes -----------------------------------------------------------

    /** The box drawn for the step on `line` (or the step a bare arrow leaves from). */
    nodeOnLine(line: number): string | null {
        const { parse, ids } = this.snapshot.bound;
        const l = parse.lines[line];
        if (!l) return null;
        const step = l.step ?? l.source;
        return step !== null ? (ids[step] ?? null) : null;
    }

    /** The line a box is written on. */
    lineOfNode(id: string): number | null {
        const { parse, ids } = this.snapshot.bound;
        const step = ids.indexOf(id);
        return step >= 0 ? (parse.steps[step]?.line ?? null) : null;
    }
}

/**
 * How a chart redrawn from the lines compares with the page: the same boxes
 * and arrows (`same`), the same boxes with every arrow kept and some added
 * (`adds` — an arrow the lines imply), or something taken away or changed.
 */
function fitOf(page: DiagramPage, drawn: DiagramPage): "same" | "adds" | "loses" {
    const now = structureOf(page);
    const then = structureOf(drawn);
    if (now === then) return "same";
    const [boxesNow = "", arrowsNow = ""] = now.split("#");
    const [boxesThen = "", arrowsThen = ""] = then.split("#");
    if (boxesNow !== boxesThen) return "loses";
    const left = arrowsThen ? arrowsThen.split("|") : [];
    for (const arrow of arrowsNow ? arrowsNow.split("|") : []) {
        const at = left.indexOf(arrow);
        if (at < 0) return "loses";
        left.splice(at, 1);
    }
    return "adds";
}

const controllers = new WeakMap<EditorStore, StepsSync>();

/**
 * The one controller for an editor's store. The panel starts and stops it as
 * it mounts (presenting unmounts it), and the canvas's empty-board prompt
 * reaches the same one, so the lines survive both.
 */
export function stepsSyncFor(store: EditorStore): StepsSync {
    let sync = controllers.get(store);
    if (!sync) {
        sync = new StepsSync(store);
        controllers.set(store, sync);
    }
    return sync;
}
