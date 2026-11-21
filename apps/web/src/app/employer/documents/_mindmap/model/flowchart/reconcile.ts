/**
 * D · Write it, see it — the chart written back as text.
 *
 * Two ways back from the page to the lines:
 *
 * - `serializeSteps` writes a page out from scratch, for a page the panel has
 *   never seen (a template, a page added elsewhere). Best effort: a graph the
 *   step language cannot say (a plain box with two arrows into the same next
 *   step, say) comes out as near as it can.
 * - `reconcileSteps` takes the lines as they were and the page after an edit
 *   on the canvas, and changes only the lines that edit touched: a renamed box
 *   rewrites its line (and every `-> old words` that pointed at it), a deleted
 *   box takes its line, a box added with Tab gets a line after the one it
 *   follows, a connector drawn between two steps becomes a `-> Step`. Lines
 *   the edit did not touch keep their spacing, blank lines and all.
 *
 * Both return the box id behind each step of the text they produce, so the
 * chart drawn from it keeps every box (`applySteps`'s `ids`).
 */

import type { DiagramEdge, DiagramNode, DiagramPage } from "../types";
import { edgeLabel, isStepNode } from "./steps";
import { oneLine, parseSteps, type StepLine, type StepsParse } from "./syntax";

/** Lines and the boxes they were drawn as. */
export interface StepsBinding {
    text: string;
    parse: StepsParse;
    /** The box behind each step, aligned with `parse.steps`; null if not drawn. */
    ids: Array<string | null>;
}

export interface WrittenSteps {
    text: string;
    /** The box behind each step of `text`, aligned with `parseSteps(text).steps`. */
    ids: Array<string | null>;
}

const INDENT = "  ";

/** A step box's words as a line; a diamond always reads as a question. */
function wordsOf(nd: DiagramNode): string {
    const words = oneLine(nd.text);
    if (nd.shape === "decision" && words && !/[?？]$/.test(words)) return `${words}?`;
    return words;
}

/** Align ids by line with the steps `text` parses into. */
function idsForText(text: string, byLine: ReadonlyArray<string | null>): WrittenSteps {
    const parse = parseSteps(text);
    return { text, ids: parse.steps.map(s => byLine[s.line] ?? null) };
}

// ---------------------------------------------------------------------------
// From scratch
// ---------------------------------------------------------------------------

/**
 * Step boxes in text order: `order` first (the order they were last written),
 * then any others right after the step that leads into them, else at the end.
 */
function textOrder(page: DiagramPage, order: readonly string[]): DiagramNode[] {
    const steps = page.nodes.filter(nd => isStepNode(nd) && oneLine(nd.text) !== "");
    const byId = new Map(steps.map(nd => [nd.id, nd]));
    const out: DiagramNode[] = [];
    const placed = new Set<string>();
    for (const id of order) {
        const nd = byId.get(id);
        if (nd && !placed.has(id)) {
            out.push(nd);
            placed.add(id);
        }
    }
    for (const nd of steps) {
        if (placed.has(nd.id)) continue;
        const from = page.edges.find(e => e.to.nodeId === nd.id && placed.has(e.from.nodeId ?? ""));
        const at = from ? out.findIndex(o => o.id === from.from.nodeId) : -1;
        if (at >= 0) out.splice(at + 1, 0, nd);
        else out.push(nd);
        placed.add(nd.id);
    }
    return out;
}

/** Write a page's steps as lines. */
export function serializeSteps(page: DiagramPage, order: readonly string[] = []): WrittenSteps {
    const steps = textOrder(page, order);
    const index = new Map(steps.map((nd, i) => [nd.id, i]));
    const out = new Map<string, DiagramEdge[]>();
    for (const e of page.edges) {
        const a = e.from.nodeId;
        const b = e.to.nodeId;
        if (!a || !b || a === b || !index.has(a) || !index.has(b)) continue;
        out.set(a, [...(out.get(a) ?? []), e]);
    }

    const lines: string[] = [];
    const byLine: Array<string | null> = [];
    const push = (text: string, id: string | null) => {
        lines.push(text);
        byLine.push(id);
    };
    const consumed = new Set<number>();
    const nextFree = (after: number) => {
        for (let k = after + 1; k < steps.length; k++) if (!consumed.has(k)) return k;
        return -1;
    };

    steps.forEach((nd, i) => {
        if (consumed.has(i)) return;
        consumed.add(i);
        const edges = out.get(nd.id) ?? [];
        if (nd.shape === "decision") {
            // Its branches: the boxes straight after it that it points at.
            const block: number[] = [];
            for (let k = i + 1; k < steps.length; k++) {
                const b = steps[k]!;
                if (b.shape === "decision" || !edges.some(e => e.to.nodeId === b.id)) break;
                block.push(k);
                consumed.add(k);
            }
            const next = nextFree(i);
            const nextId = next >= 0 ? steps[next]!.id : null;
            push(wordsOf(nd), nd.id);
            const plainOnward =
                block.length === 0 &&
                edges.length === 1 &&
                edges[0]!.to.nodeId === nextId &&
                edgeLabel(edges[0]!) === "";
            if (plainOnward) return;
            for (const k of block) {
                const b = steps[k]!;
                const via = edges.find(e => e.to.nodeId === b.id)!;
                const label = edgeLabel(via);
                const onward = (out.get(b.id) ?? []).filter(e => e.to.nodeId !== nextId);
                const jump = onward[0]
                    ? ` -> ${wordsOf(steps[index.get(onward[0].to.nodeId!)!]!)}`
                    : "";
                push(`${INDENT}${label ? `${label}: ` : ""}${wordsOf(b)}${jump}`, b.id);
            }
            for (const e of edges) {
                if (block.some(k => steps[k]!.id === e.to.nodeId)) continue;
                const label = edgeLabel(e);
                const target = wordsOf(steps[index.get(e.to.nodeId!)!]!);
                push(`${INDENT}${label ? `${label}: ` : ""}-> ${target}`, null);
            }
            return;
        }
        const next = nextFree(i);
        const nextId = next >= 0 ? steps[next]!.id : null;
        const targets = edges.map(e => steps[index.get(e.to.nodeId!)!]!);
        const implied =
            targets.length === 0 ||
            (targets.length === 1 && targets[0]!.id === nextId && edgeLabel(edges[0]!) === "");
        if (implied) {
            push(wordsOf(nd), nd.id);
            return;
        }
        push(`${wordsOf(nd)} -> ${wordsOf(targets[0]!)}`, nd.id);
        for (const t of targets.slice(1)) push(`-> ${wordsOf(t)}`, null);
    });

    return idsForText(lines.join("\n"), byLine);
}

// ---------------------------------------------------------------------------
// Patch
// ---------------------------------------------------------------------------

/** A line taken apart, so an edit can change one part and put it back together. */
interface Parts {
    lead: string;
    branchLabel: string | null;
    label: string;
    target: string | null;
    colon: string;
    arrow: string;
}

interface Row {
    raw: string;
    parts: Parts;
    /** The step box on this line. */
    id: string | null;
    dirty: boolean;
    removed: boolean;
    /** Lines inserted after this one. */
    after: Row[];
}

function partsOf(line: StepLine): Parts {
    const raw = line.text;
    return {
        lead: /^[ \t]*/.exec(raw)![0],
        branchLabel: line.branchLabel,
        label: line.labelRange ? raw.slice(line.labelRange[0], line.labelRange[1]) : "",
        target: line.target,
        colon: raw.includes("：") ? "：" : ":",
        arrow: raw.includes("→") ? "→" : "->",
    };
}

function render(row: Row): string {
    if (!row.dirty) return row.raw;
    const p = row.parts;
    const head =
        `${p.branchLabel !== null ? `${p.branchLabel}${p.colon} ` : ""}${p.label}`.trimEnd();
    const arrow = p.target ? `${head ? " " : ""}${p.arrow} ${p.target}` : "";
    return `${p.lead}${head}${arrow}`.trimEnd();
}

function newRow(parts: Partial<Parts> & { label: string }, id: string | null): Row {
    const full: Parts = {
        lead: "",
        branchLabel: null,
        target: null,
        colon: ":",
        arrow: "->",
        ...parts,
    };
    return { raw: "", parts: full, id, dirty: true, removed: false, after: [] };
}

/**
 * The lines after an edit on the canvas. `base` is the text and the boxes it
 * was drawn as; `page` is the page now.
 */
export function reconcileSteps(base: StepsBinding, page: DiagramPage): WrittenSteps {
    const { parse, ids } = base;
    const nodes = new Map(page.nodes.map(nd => [nd.id, nd]));
    const live = (id: string | null | undefined): id is string => {
        const nd = id ? nodes.get(id) : undefined;
        return !!nd && isStepNode(nd);
    };
    const rows: Row[] = parse.lines.map(l => ({
        raw: l.text,
        parts: partsOf(l),
        id: l.step !== null ? (ids[l.step] ?? null) : null,
        dirty: false,
        removed: false,
        after: [],
    }));
    const edit = (line: number, change: (p: Parts) => void) => {
        const row = rows[line]!;
        change(row.parts);
        row.dirty = true;
    };

    // The lines of a decision's block, and the top-level step after it.
    const blockOf = (d: number): number[] =>
        parse.lines.flatMap((l, li) =>
            l.branch && ((l.step !== null && parse.steps[l.step]!.branchOf === d) || l.source === d)
                ? [li]
                : []
        );
    const nextTopOf = (s: number): number | null => {
        const line = parse.steps[s]!.line;
        const k = parse.steps.findIndex(o => o.branchOf === null && o.line > line);
        return k >= 0 ? k : null;
    };
    const stepOfId = new Map<string, number>();
    ids.forEach((id, i) => {
        if (id) stepOfId.set(id, i);
    });

    // -- renamed and deleted boxes --------------------------------------------
    const renamed = new Map<number, string>();
    const deleted = new Set<number>();
    parse.steps.forEach((s, i) => {
        const id = ids[i];
        if (!id) return;
        if (!live(id)) {
            deleted.add(i);
            return;
        }
        const words = oneLine(nodes.get(id)!.text);
        if (!words) deleted.add(i);
        else if (words !== s.label) {
            renamed.set(i, words);
            edit(s.line, p => (p.label = words));
        }
    });
    // An arrow to the old words follows the box to its new ones.
    parse.lines.forEach((l, li) => {
        const to = l.targetStep;
        if (to !== null && renamed.has(to)) edit(li, p => (p.target = renamed.get(to)!));
    });
    const labelOf = (s: number) => renamed.get(s) ?? parse.steps[s]!.label;

    for (const i of deleted) {
        const s = parse.steps[i]!;
        rows[s.line]!.removed = true;
        if (s.branchOf === null && s.kind === "decision") {
            // Its branches outlive it, as plain steps in its place.
            for (const li of blockOf(i)) {
                const l = parse.lines[li]!;
                if (l.step !== null && !deleted.has(l.step)) {
                    edit(li, p => {
                        p.lead = "";
                        p.branchLabel = null;
                    });
                } else rows[li]!.removed = true;
            }
        }
        // Bare arrows written under it leave with it.
        parse.lines.forEach((l, li) => {
            if (!l.branch && l.step === null && l.source === i) rows[li]!.removed = true;
        });
    }

    // -- arrows removed or relabelled on the canvas ---------------------------
    const edgeBetween = (a: string, b: string) =>
        page.edges.find(e => e.from.nodeId === a && e.to.nodeId === b);
    const writtenPairs = new Set<string>();
    for (const link of parse.links) {
        const a = ids[link.from];
        const b = ids[link.to];
        if (!a || !b) continue;
        writtenPairs.add(`${a}>${b}`);
        if (!live(a) || !live(b) || deleted.has(link.from) || deleted.has(link.to)) continue;
        const line = parse.lines[link.line]!;
        const e = edgeBetween(a, b);
        if (!e) {
            // Only an arrow that was written out can be taken out.
            if (line.step === null && line.target) rows[link.line]!.removed = true;
            else if (link.via === "jump" && line.target) edit(link.line, p => (p.target = null));
            continue;
        }
        if (link.via === "branch" && edgeLabel(e) !== (link.label ?? "")) {
            const words = edgeLabel(e);
            edit(link.line, p => (p.branchLabel = words || null));
        }
    }

    // -- boxes added on the canvas (Tab, the toolbar's +, a drop) -------------
    const insertedRow = new Map<string, Row>();
    const bound = new Set(ids.filter((id): id is string => !!id));
    for (const nd of page.nodes) {
        if (!isStepNode(nd) || bound.has(nd.id)) continue;
        const words = oneLine(nd.text);
        if (!words) continue;
        const incoming = page.edges.filter(e => e.to.nodeId === nd.id && e.from.nodeId !== nd.id);
        const fromRow = incoming
            .map(e => insertedRow.get(e.from.nodeId ?? ""))
            .find((r): r is Row => !!r);
        const fromStep = incoming
            .map(e => stepOfId.get(e.from.nodeId ?? ""))
            .find((s): s is number => s !== undefined && !deleted.has(s));
        const row = newRow({ label: words }, nd.id);
        bound.add(nd.id);
        insertedRow.set(nd.id, row);

        if (fromRow) {
            fromRow.after.unshift(row);
            continue;
        }
        if (fromStep === undefined) {
            rows[rows.length - 1]!.after.push(row);
            continue;
        }
        const s = parse.steps[fromStep]!;
        const sourceRow = rows[s.line]!;
        // A step that hands its arrows on to the new one (Tab) hands on its
        // written-out `->`s too; the section above already took them off it.
        const passOn = () => {
            const handed = parse.links.filter(l => {
                const toId = ids[l.to];
                return (
                    l.from === fromStep &&
                    l.via === "jump" &&
                    !!toId &&
                    live(toId) &&
                    !!edgeBetween(nd.id, toId) &&
                    !edgeBetween(ids[fromStep]!, toId)
                );
            });
            handed.forEach((l, k) => {
                if (k === 0) row.parts.target = labelOf(l.to);
                else row.after.push(newRow({ label: "", target: labelOf(l.to) }, null));
            });
        };
        if (s.kind === "decision" && s.branchOf === null) {
            const block = blockOf(fromStep);
            const via = edgeBetween(ids[fromStep]!, nd.id);
            const firstLead = block.length ? rows[block[0]!]!.parts.lead : INDENT;
            row.parts.lead = firstLead || INDENT;
            row.parts.branchLabel = via && edgeLabel(via) ? edgeLabel(via) : null;
            rows[block.length ? block[block.length - 1]! : s.line]!.after.push(row);
        } else if (s.branchOf !== null) {
            // After a branch: a new top-level line after the block. The other
            // branches that flowed on into the old next line still go there.
            const d = s.branchOf;
            const block = blockOf(d);
            const next = nextTopOf(d);
            passOn();
            if (next !== null) {
                for (const li of block) {
                    const l = parse.lines[li]!;
                    if (l.target || li === s.line) continue;
                    if (l.step !== null && parse.steps[l.step]!.kind === "end") continue;
                    if (l.step === null && !l.branchLabel) continue;
                    edit(li, p => (p.target = labelOf(next)));
                }
            }
            rows[block[block.length - 1] ?? s.line]!.after.push(row);
        } else {
            passOn();
            sourceRow.after.unshift(row);
        }
    }

    // -- arrows drawn between steps on the canvas -----------------------------
    for (const e of page.edges) {
        const a = e.from.nodeId;
        const b = e.to.nodeId;
        if (!a || !b || a === b || writtenPairs.has(`${a}>${b}`)) continue;
        const from = stepOfId.get(a);
        const to = stepOfId.get(b);
        if (from === undefined || to === undefined || deleted.has(from) || deleted.has(to))
            continue;
        if (!live(a) || !live(b)) continue;
        const s = parse.steps[from]!;
        const target = labelOf(to);
        if (s.kind === "decision" && s.branchOf === null) {
            const block = blockOf(from);
            const lead = block.length ? rows[block[0]!]!.parts.lead || INDENT : INDENT;
            const label = edgeLabel(e);
            const row = newRow({ label: "", lead, branchLabel: label || null, target }, null);
            rows[block.length ? block[block.length - 1]! : s.line]!.after.push(row);
            continue;
        }
        const row = rows[s.line]!;
        if (!row.parts.target) {
            // It flowed on before; if that arrow is still there, keep it.
            const flow = parse.links.find(l => l.from === from && l.via === "flow");
            const flowTo = flow ? ids[flow.to] : null;
            edit(s.line, p => (p.target = target));
            if (s.branchOf === null && flow && flowTo && edgeBetween(a, flowTo)) {
                row.after.unshift(newRow({ label: "", target: labelOf(flow.to) }, null));
            }
        } else if (s.branchOf === null) {
            row.after.push(newRow({ label: "", target }, null));
        }
    }

    // -- put it back together -------------------------------------------------
    const lines: string[] = [];
    const byLine: Array<string | null> = [];
    const emit = (row: Row) => {
        if (!row.removed) {
            lines.push(render(row));
            byLine.push(row.id);
        }
        for (const r of row.after) emit(r);
    };
    rows.forEach(emit);
    return idsForText(lines.join("\n"), byLine);
}
