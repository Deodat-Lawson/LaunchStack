/**
 * D · Write it, see it — the step language.
 *
 * A process is written the way people write one down, one step to a line:
 *
 * ```
 * Start
 * Receive the order
 * In stock?
 *   Yes: Pick and pack
 *   No: Reorder from supplier -> Receive the order
 * Ship it
 * End
 * ```
 *
 * - every line is a step, and consecutive top-level lines are joined in order;
 * - a line ending in `?` (or `？`) is a decision;
 * - lines indented under a decision (two spaces or a tab) are its branches,
 *   `Label: step`, the label going on the arrow. A branch flows on into the
 *   next top-level line unless it ends in `-> Step` (an arrow to the step with
 *   those words) or is a bare `Label: -> Step`; a bare `Label:` is a labelled
 *   arrow straight to the next top-level line;
 * - `Step -> Other` on a top-level line, or a bare `-> Other` under it, sends
 *   that step somewhere other than the next line;
 * - a line that is exactly `Start` or `End` (any case; `开始`, `结束`) is a
 *   rounded pill, and `End` goes nowhere;
 * - blank lines are ignored.
 *
 * Pure, and it never throws: what it cannot read it reads as a plain step, and
 * an arrow to words no step has becomes a note rather than an error, so a
 * half-typed line never breaks the chart.
 */

export type StepKind = "step" | "decision" | "start" | "end";

export interface Step {
    /** The 0-based line it is written on. */
    line: number;
    kind: StepKind;
    /** The words in its box. */
    label: string;
    /** The decision it is a branch of (an index into `steps`), or null at the top level. */
    branchOf: number | null;
}

/**
 * Why an arrow exists, which decides how an edit on the canvas is written
 * back: `flow` is implied by line order, `branch` joins a decision to a branch
 * line, `jump` is written out with `->`.
 */
export type LinkVia = "flow" | "branch" | "jump";

export interface StepLink {
    from: number;
    to: number;
    /** Words on the arrow: a branch's `Yes`. */
    label: string | null;
    /** The line that drew it. */
    line: number;
    via: LinkVia;
}

export interface StepLine {
    /** The line as written. */
    text: string;
    blank: boolean;
    /** A branch line: indented under a decision. */
    branch: boolean;
    /** The step drawn on this line, or null (blank, or a bare arrow). */
    step: number | null;
    /** For a bare arrow (`-> X`, `Yes: -> X`, `Yes:`), the step it leaves from. */
    source: number | null;
    /** `Yes` in `Yes: Pack`: the words on a branch's arrow. */
    branchLabel: string | null;
    /** [start, end) of `branchLabel` in `text`. */
    branchLabelRange: [number, number] | null;
    /** [start, end) of the step's words in `text`. */
    labelRange: [number, number] | null;
    /** The words after `->`, as written. */
    target: string | null;
    /** [start, end) of `target` in `text`. */
    targetRange: [number, number] | null;
    /** [start, end) of the whole ` -> target`, from the end of the words before it. */
    arrowRange: [number, number] | null;
    /** The step the arrow lands on; null when no step has those words. */
    targetStep: number | null;
}

export type StepNoteKind = "missingTarget" | "notUnderQuestion" | "arrowWithoutStep";

export interface StepNote {
    /** 0-based line. */
    line: number;
    kind: StepNoteKind;
    /** For `missingTarget`: the words the arrow points at. */
    target?: string;
}

export interface StepsParse {
    lines: StepLine[];
    steps: Step[];
    links: StepLink[];
    notes: StepNote[];
}

/** An arrow: `->` (any number of dashes) or `→`. The last one on a line wins. */
const ARROW = /-+>|→/g;
const START_END = /^(start|end|开始|结束)$/i;
const QUESTION = /[?？]$/;
/** A branch label longer than this is not a label: `Note: call them first` is a step. */
const MAX_BRANCH_LABEL = 32;

/** What kind of box a label asks for. */
export function stepKindOf(label: string): StepKind {
    const words = label.trim();
    const pill = START_END.exec(words);
    if (pill) {
        const w = pill[1]!.toLowerCase();
        return w === "start" || w === "开始" ? "start" : "end";
    }
    return QUESTION.test(words) ? "decision" : "step";
}

/**
 * How labels are compared: an arrow to `in stock` finds `In stock?`. Case,
 * runs of spaces and closing punctuation do not count.
 */
export function normalizeLabel(label: string): string {
    return label
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[?？.。!！:：]+$/u, "")
        .trim()
        .toLowerCase();
}

/** A box's words as one line of text: line breaks become spaces. */
export function oneLine(text: string): string {
    return text.replace(/\s*\n\s*/g, " ").trim();
}

/** Indented: a tab, or at least two spaces. One stray space is not an indent. */
export function isIndented(lead: string): boolean {
    return lead.includes("\t") || lead.length >= 2;
}

function trimRange(raw: string, start: number, end: number): [number, number] {
    let a = start;
    let b = end;
    while (a < b && /\s/.test(raw[a]!)) a += 1;
    while (b > a && /\s/.test(raw[b - 1]!)) b -= 1;
    return [a, b];
}

interface Split {
    /** The words before the arrow (or the whole line), trimmed. */
    head: [number, number];
    target: string | null;
    targetRange: [number, number] | null;
    arrowRange: [number, number] | null;
}

/** Split `words -> target` at the last arrow. Ranges index the raw line. */
function splitArrow(raw: string, start: number, end: number): Split {
    let match: RegExpExecArray | null = null;
    const re = new RegExp(ARROW.source, "g");
    re.lastIndex = start;
    for (let m = re.exec(raw); m && m.index < end; m = re.exec(raw)) match = m;
    const none = (head: [number, number]): Split => ({
        head,
        target: null,
        targetRange: null,
        arrowRange: null,
    });
    if (!match) return none(trimRange(raw, start, end));
    const head = trimRange(raw, start, match.index);
    const after = trimRange(raw, match.index + match[0].length, end);
    // `Pack ->` with nothing after it yet: no arrow, the words are the step.
    if (after[0] === after[1]) return none(head);
    return {
        head,
        target: raw.slice(after[0], after[1]),
        targetRange: after,
        arrowRange: [head[1], after[1]],
    };
}

/** `Yes: Pack` → label `Yes`, step `Pack`. Ranges index the raw line. */
function splitBranch(
    raw: string,
    head: [number, number]
): { label: string | null; labelRange: [number, number] | null; rest: [number, number] } {
    const text = raw.slice(head[0], head[1]);
    const colon = text.search(/[:：]/);
    if (colon < 0) return { label: null, labelRange: null, rest: head };
    const labelRange = trimRange(raw, head[0], head[0] + colon);
    const label = raw.slice(labelRange[0], labelRange[1]);
    if (label.length > MAX_BRANCH_LABEL) return { label: null, labelRange: null, rest: head };
    const rest = trimRange(raw, head[0] + colon + 1, head[1]);
    return { label: label || null, labelRange: label ? labelRange : null, rest };
}

function emptyLine(text: string): StepLine {
    return {
        text,
        blank: true,
        branch: false,
        step: null,
        source: null,
        branchLabel: null,
        branchLabelRange: null,
        labelRange: null,
        target: null,
        targetRange: null,
        arrowRange: null,
        targetStep: null,
    };
}

interface Jump {
    from: number;
    line: number;
    target: string;
    label: string | null;
    via: LinkVia;
}

interface Onward {
    decision: number;
    from: number;
    label: string | null;
    line: number;
}

/** Read the steps. Never throws. */
export function parseSteps(text: string): StepsParse {
    const raws = text.replace(/\r\n?/g, "\n").split("\n");
    const lines: StepLine[] = [];
    const steps: Step[] = [];
    const links: StepLink[] = [];
    const notes: StepNote[] = [];
    const jumps: Jump[] = [];
    /** Arrows from a branch, or a bare `Yes:`, to the top-level step after the block. */
    const onward: Onward[] = [];
    /** Top-level steps, in order. */
    const top: number[] = [];
    /** Steps that leave by an arrow written out, so do not flow on. */
    const leaves = new Set<number>();
    /** Decisions with at least one branch. */
    const branched = new Set<number>();
    let current: number | null = null;

    const addStep = (line: number, label: string, branchOf: number | null): number => {
        steps.push({ line, kind: stepKindOf(label), label, branchOf });
        return steps.length - 1;
    };

    raws.forEach((raw, i) => {
        const line = emptyLine(raw);
        lines.push(line);
        const lead = /^[ \t]*/.exec(raw)![0];
        const end = raw.trimEnd().length;
        if (end <= lead.length) return;
        line.blank = false;

        const split = splitArrow(raw, lead.length, end);
        line.target = split.target;
        line.targetRange = split.targetRange;
        line.arrowRange = split.arrowRange;

        const decision = current !== null && steps[current]!.kind === "decision" ? current : null;
        if (isIndented(lead) && decision !== null) {
            line.branch = true;
            const b = splitBranch(raw, split.head);
            line.branchLabel = b.label;
            line.branchLabelRange = b.labelRange;
            const words = raw.slice(b.rest[0], b.rest[1]);
            if (words) {
                const s = addStep(i, words, decision);
                line.step = s;
                line.labelRange = b.rest;
                branched.add(decision);
                links.push({ from: decision, to: s, label: b.label, line: i, via: "branch" });
                if (split.target) {
                    leaves.add(s);
                    jumps.push({
                        from: s,
                        line: i,
                        target: split.target,
                        label: null,
                        via: "jump",
                    });
                } else if (steps[s]!.kind !== "end") {
                    onward.push({ decision, from: s, label: null, line: i });
                }
            } else if (split.target) {
                // `No: -> Receive the order`: an arrow from the decision itself.
                line.source = decision;
                branched.add(decision);
                jumps.push({
                    from: decision,
                    line: i,
                    target: split.target,
                    label: b.label,
                    via: "branch",
                });
            } else if (b.label) {
                // `Yes:` on its own: a labelled arrow to the next top-level step.
                line.source = decision;
                branched.add(decision);
                onward.push({ decision, from: decision, label: b.label, line: i });
            } else {
                line.blank = true;
                line.branch = false;
            }
            return;
        }

        // Top level, or indented where there is no decision to branch from.
        if (isIndented(lead)) notes.push({ line: i, kind: "notUnderQuestion" });
        const words = raw.slice(split.head[0], split.head[1]);
        if (words) {
            const s = addStep(i, words, null);
            line.step = s;
            line.labelRange = split.head;
            top.push(s);
            current = s;
            if (split.target) {
                leaves.add(s);
                jumps.push({ from: s, line: i, target: split.target, label: null, via: "jump" });
            }
            return;
        }
        if (!split.target) {
            line.blank = true;
            return;
        }
        if (current === null) {
            notes.push({ line: i, kind: "arrowWithoutStep" });
            return;
        }
        // A bare `-> X` under a step: another arrow out of it. Under a
        // decision it is a branch with no label.
        line.source = current;
        const isDecision = steps[current]!.kind === "decision";
        if (isDecision) branched.add(current);
        else leaves.add(current);
        jumps.push({
            from: current,
            line: i,
            target: split.target,
            label: null,
            via: isDecision ? "branch" : "jump",
        });
    });

    // -- joining --------------------------------------------------------------
    const nextTop = new Map<number, number>();
    top.forEach((s, k) => {
        const next = top[k + 1];
        if (next !== undefined) nextTop.set(s, next);
    });

    for (const s of top) {
        const step = steps[s]!;
        const next = nextTop.get(s);
        if (next === undefined || step.kind === "end" || leaves.has(s)) continue;
        if (step.kind === "decision" && branched.has(s)) continue;
        links.push({ from: s, to: next, label: null, line: step.line, via: "flow" });
    }
    for (const o of onward) {
        const next = nextTop.get(o.decision);
        if (next === undefined) continue;
        links.push({
            from: o.from,
            to: next,
            label: o.label,
            line: o.line,
            via: o.from === o.decision ? "branch" : "flow",
        });
    }

    const byLabel = new Map<string, number>();
    steps.forEach((s, i) => {
        const key = normalizeLabel(s.label);
        if (key && !byLabel.has(key)) byLabel.set(key, i);
    });
    for (const j of jumps) {
        const to = byLabel.get(normalizeLabel(j.target));
        if (to === undefined) {
            notes.push({ line: j.line, kind: "missingTarget", target: j.target });
            continue;
        }
        lines[j.line]!.targetStep = to;
        links.push({ from: j.from, to, label: j.label, line: j.line, via: j.via });
    }

    notes.sort((a, b) => a.line - b.line);
    return { lines, steps, links: dedupe(links), notes };
}

/** One arrow per (from, to, label): writing the same jump twice draws it once. */
function dedupe(all: readonly StepLink[]): StepLink[] {
    const seen = new Set<string>();
    const out: StepLink[] = [];
    for (const l of all) {
        const key = `${l.from}>${l.to}>${l.label ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(l);
    }
    return out;
}

/** The line a step or a bare arrow sits on, for the caret ↔ selection link. */
export function lineOfStep(parse: StepsParse, step: number): number | null {
    return parse.steps[step]?.line ?? null;
}

/** The step a line draws, or for a bare arrow, the step it leaves from. */
export function stepOnLine(parse: StepsParse, line: number): number | null {
    const l = parse.lines[line];
    if (!l) return null;
    return l.step ?? l.source;
}
