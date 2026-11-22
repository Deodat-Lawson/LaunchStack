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
 * and a canvas edit only ever rewrites the text: `reconcileSteps` writes it
 * into the lines when they can say it, else the chart is written out afresh
 * (`serializeSteps`). The chart is never redrawn from the lines after a
 * canvas edit — not to put back an arrow someone deleted, not to join a box
 * someone dropped on its own (the lines keep those apart with a blank line).
 * Only typing in the panel draws the chart.
 *
 * No React here: the panel subscribes to it, and the tests drive it with a
 * store alone.
 */

import { arrangesItself } from "../../model/commands";
import { activePage } from "../../model/doc";
import { adoptFollowers, tidyCharts } from "../../model/flowchart/arrange";
import { boardMode, flowchartLook } from "../../model/flowchart/look";
import {
    reconcileSteps,
    serializeSteps,
    withoutWordless,
    type StepsBinding,
} from "../../model/flowchart/reconcile";
import {
    applySteps,
    isStepNode,
    samePage,
    structureOf,
    type ApplyResult,
} from "../../model/flowchart/steps";
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
        const out = serializeSteps(withoutWordless(page));
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
        // Boxes already on the page keep their places — on a chart that
        // arranges itself too, so a chart the lines did not touch (a box
        // dropped on its own) stays where it was put; the charts the lines
        // hold are then arranged (`placed`). A first line on a board with no
        // steps yet goes to the top of the view.
        const hasSteps = page.nodes.some(isStepNode);
        // A pill there was before this typing began keeps its kind whatever
        // its line now says; one the typing made follows the words.
        const pills = new Set(
            activePage((this.burst ?? state).doc)
                .nodes.filter(nd => nd.shape === "terminator")
                .map(nd => nd.id)
        );
        const result = this.placed(
            page,
            applySteps(page, parse, {
                look: flowchartLook,
                mode: boardMode(state.doc),
                order: prev?.ids.filter((id): id is string => !!id),
                origin: this.options.origin?.(),
                keepPlaced: hasSteps || !arrangesItself(state.doc),
                keepsPill: id => pills.has(id),
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
            const out = serializeSteps(withoutWordless(page));
            this.settle(page, bindingFor(out.text, out.ids), true);
            return;
        }
        if (this.pending !== null) {
            // Typing raced an edit elsewhere; the typing is drawn over it.
            this.flush();
            return;
        }
        this.endBurst();

        // An edit made on the canvas stays as it was made; only the lines
        // follow. They are edited where they stand (keeping their spacing and
        // order) when that says the chart, else written out afresh — the keys
        // and the menu draw things the old lines could not hold, like a
        // branch under a question they never had. Whichever text says the
        // canvas most nearly wins (exactly, almost always); nothing is drawn.
        // A box with no words yet has no line: the arrows through it read as
        // one (`withoutWordless`).
        const view = withoutWordless(page);
        const want = structureOf(view);
        const tries = [
            ...(base.text.trim() === "" ? [] : [reconcileSteps(base, view)]),
            serializeSteps(view),
        ].map(written => {
            const parse = parseSteps(written.text);
            const drawn = applySteps(view, parse, {
                look: flowchartLook,
                mode: boardMode(state.doc),
                ids: written.ids,
                keepPlaced: true,
            });
            return { written, parse, off: distance(want, structureOf(drawn.page)) };
        });
        const best = tries.reduce((a, b) => (b.off < a.off ? b : a));
        this.settle(
            page,
            { text: best.written.text, parse: best.parse, ids: best.written.ids },
            true
        );
    }

    /**
     * Where the redrawn steps go. `applySteps` puts back everything already
     * placed and places only new boxes (`keepPlaced`; on an empty board it
     * lays them out from the top of the view). On a chart that arranges
     * itself, each chart the lines hold is then laid out the way Tab lays it
     * out (`tidyCharts`), so the panel and the keys agree on one arrangement;
     * a box on its own is left where it is.
     */
    private placed(page: DiagramPage, result: ApplyResult): ApplyResult {
        if (result.page === page) return result;
        const next = arrangesItself(this.store.getState().doc)
            ? tidyCharts(adoptFollowers(page, result.page), result.ids)
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
 * How far a chart drawn from some lines is from the page, by what it says
 * (`structureOf`: boxes with their kind and words, arrows with theirs): the
 * boxes and arrows one has that the other lacks. 0 is the same chart.
 */
function distance(page: string, drawn: string): number {
    const parts = (sig: string) => {
        const [boxes = "", arrows = ""] = sig.split("#");
        return [
            ...(boxes ? boxes.split("|") : []),
            ...(arrows ? arrows.split("|").map(a => `>${a}`) : []),
        ];
    };
    const left = parts(drawn);
    let off = 0;
    for (const item of parts(page)) {
        const at = left.indexOf(item);
        if (at < 0) off += 1;
        else left.splice(at, 1);
    }
    return off + left.length;
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
