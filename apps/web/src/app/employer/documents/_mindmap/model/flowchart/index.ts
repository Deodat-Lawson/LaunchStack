/**
 * Flowcharts as text: the step language people type in the Steps panel and
 * agents read and write (Ask, MCP, the published text). One line per step,
 * joined in order; a line ending in "?" is a decision; indented
 * `Label: step` lines are its branches; `-> Step` jumps to a step; a line
 * that is exactly Start or End is a pill. See `./syntax.ts` for the grammar.
 *
 * Pure: no store, no React. The editor (Steps panel), the agent tools on the
 * server and the publish route all go through these two functions, so the
 * text a person writes, the text an agent writes and the text that is
 * indexed are the same language.
 */

import { isMindmapPage } from "../doc";
import { createEdge, createNode } from "../factory";
import type { ThemeMode } from "../palette";
import type { DiagramEdge, DiagramKind, DiagramNode, DiagramPage, Point, ShapeId } from "../types";
import { flowchartLook } from "./look";
import { serializeSteps, type WrittenSteps } from "./reconcile";
import { applySteps, baseSize, edgeLabel, isStepNode, stepSize } from "./steps";
import { oneLine, parseSteps, type StepNote } from "./syntax";

export { flowchartLook, KINDS, kindColours, TEXT_SIZE } from "./look";
export type { BoxLook, EdgeLook, FlowLook } from "./lookTypes";
export { parseSteps, stepKindOf } from "./syntax";
export type { Step, StepKind, StepLine, StepNote, StepsParse } from "./syntax";
export { applySteps, isStepNode } from "./steps";
export { reconcileSteps, serializeSteps } from "./reconcile";
export type { StepsBinding, WrittenSteps } from "./reconcile";
export { tidyChart } from "./arrange";

/**
 * A page's flowchart as step text, with the box behind each step (aligned
 * with `parseSteps(text).steps`, null where a step has no box). Boxes that are
 * not steps (notes, text marks, frames) are left out.
 */
export function flowchartToSteps(page: DiagramPage): { text: string; ids: Array<string | null> } {
    return serializeSteps(page);
}

/**
 * Redraw a page's flowchart from step text in the product's look. Boxes whose
 * words match a step keep their id (and so their comments and links); new
 * steps get new boxes; boxes whose steps are gone are removed. Notes, text
 * marks and frames are untouched. `notes` lists what in the text could not
 * be used (an arrow to a step that does not exist, a branch with no question
 * above it) — the rest still applies.
 */
export function stepsToFlowchart(
    page: DiagramPage,
    text: string,
    mode: ThemeMode,
    opts: { order?: readonly string[]; origin?: Point; keepPlaced?: boolean } = {}
): { page: DiagramPage; ids: string[]; notes: StepNote[] } {
    const parse = parseSteps(text);
    const result = applySteps(page, parse, {
        look: flowchartLook,
        mode,
        ...(opts.order ? { order: opts.order } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
        // A hand-placed chart keeps its places; only new steps are placed.
        ...(opts.keepPlaced ? { keepPlaced: true } : {}),
    });
    return { page: result.page, ids: result.ids, notes: parse.notes };
}

// ---------------------------------------------------------------------------
// For agents: which pages read as steps, what the text leaves out, and new
// boxes and arrows in the product's look.
// ---------------------------------------------------------------------------

/**
 * Flowchart symbols, and the plain boxes the look treats as steps. A page
 * whose steps are all one of these is a process; an ERD table, a UML class or
 * an architecture drawing's clouds and cylinders make it a graph, which the
 * step language would say badly.
 */
const FLOW_SYMBOLS: ReadonlySet<ShapeId> = new Set<ShapeId>([
    "process",
    "decision",
    "terminator",
    "data",
    "parallelogram",
    "document",
    "multi-document",
    "database",
    "stored-data",
    "direct-data",
    "internal-storage",
    "predefined-process",
    "manual-input",
    "manual-operation",
    "preparation",
    "delay",
    "display",
    "off-page-connector",
    "loop-limit",
    "merge",
    "extract",
    "sort",
    "collate",
    "summing-junction",
    "or-junction",
    "rectangle",
    "rounded-rectangle",
    "ellipse",
    "circle",
    "diamond",
    "mind-root",
    "mind-branch",
    "mind-leaf",
]);

/** The page's step boxes that have words, in page order. */
export function stepBoxes(page: DiagramPage): DiagramNode[] {
    return page.nodes.filter(nd => isStepNode(nd) && oneLine(nd.text) !== "");
}

/** What the step text says differently from the page it was written from. */
export interface StepsGap {
    /** Arrows on the page the text does not draw: to or from something that is not a step, or between steps the text leaves unjoined. */
    unshown: DiagramEdge[];
    /** Arrows the text draws between the same boxes, with other words on them (only a branch carries words). */
    relabelled: Array<{ edge: DiagramEdge; label: string | null }>;
    /** Arrows the text implies that the page does not have (two steps on consecutive lines that are not joined). */
    implied: Array<{ from: string; to: string; label: string | null }>;
}

/**
 * Compare a page with the step text written from it: what a reader of the
 * text would not learn, and what drawing the text again would change.
 */
export function stepsGap(page: DiagramPage, written: WrittenSteps): StepsGap {
    const parse = parseSteps(written.text);
    const used = new Set<string>();
    const relabelled: StepsGap["relabelled"] = [];
    const implied: StepsGap["implied"] = [];
    const words = (s: string | null | undefined) => (s ?? "").trim();
    for (const link of parse.links) {
        const from = written.ids[link.from];
        const to = written.ids[link.to];
        if (!from || !to) continue;
        const between = page.edges.filter(
            e => !used.has(e.id) && e.from.nodeId === from && e.to.nodeId === to
        );
        const same = between.find(e => words(edgeLabel(e)) === words(link.label));
        if (same) {
            used.add(same.id);
            continue;
        }
        const other = between[0];
        if (other) {
            used.add(other.id);
            relabelled.push({ edge: other, label: link.label });
            continue;
        }
        implied.push({ from, to, label: link.label });
    }
    return { unshown: page.edges.filter(e => !used.has(e.id)), relabelled, implied };
}

/**
 * Whether agents read and write this page as step text. Not a page of
 * topics (a mind map keeps its outline); every step box a flowchart symbol;
 * and either the document is a flowchart, or the step text says the page's
 * arrows exactly — a drawing that is a flowchart in all but name.
 */
export function readsAsSteps(page: DiagramPage, kind: DiagramKind): boolean {
    if (isMindmapPage(page)) return false;
    const steps = stepBoxes(page);
    if (steps.length === 0) return kind === "flowchart";
    if (!steps.every(nd => FLOW_SYMBOLS.has(nd.shape))) return false;
    if (kind === "flowchart") return true;
    const ids = new Set(steps.map(nd => nd.id));
    const joined = page.edges.some(e => ids.has(e.from.nodeId ?? "") && ids.has(e.to.nodeId ?? ""));
    if (!joined) return false;
    const gap = stepsGap(page, serializeSteps(page));
    return gap.unshown.length === 0 && gap.relabelled.length === 0 && gap.implied.length === 0;
}

/**
 * What the parser could not use, said to the model that wrote it: the line
 * (1-based), what is wrong and how to write it instead.
 */
export function describeStepNotes(text: string, notes: readonly StepNote[]): string[] {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    return notes.map(note => {
        const at = `Line ${note.line + 1} ("${(lines[note.line] ?? "").trim()}")`;
        switch (note.kind) {
            case "missingTarget":
                return `${at}: "-> ${note.target ?? ""}" points at no step. Use the exact words of a step written on its own line.`;
            case "notUnderQuestion":
                return `${at} is indented, but the step above it is not a question. Only a line ending in "?" takes indented "Label: step" branches; unindent it, or end the line above with "?".`;
            case "arrowWithoutStep":
                return `${at}: an arrow with no step above it to leave from.`;
        }
        return `${at}: could not be read.`;
    });
}

/**
 * A new box in the product's flowchart look — coloured by its kind, no
 * outline, 15px regular — sized for its words, its top-left at `at`.
 */
export function newStepBox(
    shape: ShapeId,
    text: string,
    mode: ThemeMode,
    at: Point = { x: 0, y: 0 }
): DiagramNode {
    const box = flowchartLook.boxLook(shape, mode);
    const node = createNode({
        shape,
        x: at.x,
        y: at.y,
        text,
        style: box.style,
        textStyle: box.text,
        mode,
    });
    const size = stepSize(shape, text, node.textStyle, baseSize(flowchartLook, shape, mode));
    return { ...node, w: size.w, h: size.h };
}

/** A new arrow in the product's flowchart look: right-angled, soft ink, an arrowhead. */
export function newStepEdge(
    from: string,
    to: string,
    mode: ThemeMode,
    label?: string
): DiagramEdge {
    const look = flowchartLook.edgeLook(mode);
    return createEdge({
        from: { nodeId: from, port: "auto" },
        to: { nodeId: to, port: "auto" },
        kind: look.kind,
        style: look.style,
        ...(look.startArrow ? { startArrow: look.startArrow } : {}),
        ...(look.endArrow ? { endArrow: look.endArrow } : {}),
        ...(look.text ? { textStyle: look.text } : {}),
        ...(label ? { label } : {}),
    });
}
