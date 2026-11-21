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

import type { ThemeMode } from "../palette";
import type { DiagramPage, Point } from "../types";
import { flowchartLook } from "./look";
import { serializeSteps } from "./reconcile";
import { applySteps } from "./steps";
import { parseSteps, type StepNote } from "./syntax";

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
    opts: { order?: readonly string[]; origin?: Point } = {}
): { page: DiagramPage; ids: string[]; notes: StepNote[] } {
    const parse = parseSteps(text);
    const result = applySteps(page, parse, {
        look: flowchartLook,
        mode,
        ...(opts.order ? { order: opts.order } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
    });
    return { page: result.page, ids: result.ids, notes: parse.notes };
}
