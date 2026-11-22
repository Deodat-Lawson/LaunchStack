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
 * Two steps the page does not join are written with a blank line between
 * them when nothing else would keep them apart — a box dropped on its own,
 * an arrow someone deleted — since a blank line starts a separate chain.
 *
 * Both return the box id behind each step of the text they produce, so the
 * chart drawn from it keeps every box (`applySteps`'s `ids`).
 */

import type { DiagramEdge, DiagramNode, DiagramPage } from "../types";
import { edgeLabel, isStepNode, stepWords as wordsOf } from "./steps";
import {
    normalizeLabel,
    oneLine,
    parseSteps,
    stepKindOf,
    type StepLine,
    type StepsParse,
} from "./syntax";

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

/** A box that reads as End: nothing flows out of it, so nothing needs keeping apart. */
function ends(nd: DiagramNode): boolean {
    return stepKindOf(wordsOf(nd)) === "end";
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
 * With no `order` — a page never written out — the order the chart flows in
 * ({@link flowOrder}).
 */
function textOrder(page: DiagramPage, order: readonly string[]): DiagramNode[] {
    const steps = page.nodes.filter(nd => isStepNode(nd) && oneLine(nd.text) !== "");
    if (order.length === 0) return flowOrder(page, steps);
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

/**
 * Step boxes in the order the chart flows: from each step nothing leads into
 * (a Start pill first), along the arrows in the order they were drawn. A
 * decision's branches come straight after it in the order their arrows were
 * made — Yes before No, as they were written or added — and what each branch
 * leads on to follows the whole block, which is how the step language writes
 * a question. Steps no arrow reaches from a beginning (a loop with no way in)
 * follow in page order.
 */
function flowOrder(page: DiagramPage, steps: readonly DiagramNode[]): DiagramNode[] {
    const byId = new Map(steps.map(nd => [nd.id, nd]));
    const next = new Map<string, string[]>();
    const fed = new Set<string>();
    for (const e of page.edges) {
        const a = e.from.nodeId;
        const b = e.to.nodeId;
        if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) continue;
        const list = next.get(a) ?? [];
        if (!list.includes(b)) list.push(b);
        next.set(a, list);
        fed.add(b);
    }

    const out: DiagramNode[] = [];
    const placed = new Set<string>();
    const led = new Set<string>();
    const place = (id: string) => {
        placed.add(id);
        out.push(byId.get(id)!);
    };
    // What a placed step leads on to.
    const lead = (id: string) => {
        if (led.has(id)) return;
        led.add(id);
        const targets = next.get(id) ?? [];
        if (byId.get(id)!.shape !== "decision") {
            for (const t of targets) visit(t);
            return;
        }
        const block = targets.filter(t => !placed.has(t) && byId.get(t)!.shape !== "decision");
        block.forEach(place);
        for (const t of targets) {
            if (block.includes(t)) lead(t);
            else visit(t);
        }
    };
    const visit = (id: string) => {
        if (placed.has(id)) return;
        place(id);
        lead(id);
    };

    const beginnings = steps.filter(nd => !fed.has(nd.id));
    const starts = beginnings.filter(nd => stepKindOf(oneLine(nd.text)) === "start");
    for (const nd of [...starts, ...beginnings, ...steps]) visit(nd.id);
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
            // A branch with no arrow out would flow on into the next line (and
            // a question with no branches would too): then a blank line keeps
            // the next line apart, and the branches that do go on there say so.
            const stops = (b: DiagramNode) => (out.get(b.id) ?? []).length === 0 && !ends(b);
            const apart =
                nextId !== null && (edges.length === 0 || block.some(k => stops(steps[k]!)));
            for (const k of block) {
                const b = steps[k]!;
                const via = edges.find(e => e.to.nodeId === b.id)!;
                const label = edgeLabel(via);
                const leaving = out.get(b.id) ?? [];
                const onward = leaving.filter(e => e.to.nodeId !== nextId);
                const jump = onward[0]
                    ? ` -> ${wordsOf(steps[index.get(onward[0].to.nodeId!)!]!)}`
                    : apart && leaving.some(e => e.to.nodeId === nextId)
                      ? ` -> ${wordsOf(steps[next]!)}`
                      : "";
                push(`${INDENT}${label ? `${label}: ` : ""}${wordsOf(b)}${jump}`, b.id);
            }
            for (const e of edges) {
                if (block.some(k => steps[k]!.id === e.to.nodeId)) continue;
                const label = edgeLabel(e);
                const target = wordsOf(steps[index.get(e.to.nodeId!)!]!);
                push(`${INDENT}${label ? `${label}: ` : ""}-> ${target}`, null);
            }
            if (apart) push("", null);
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
            // Joined to nothing, it would flow on into the next line: a blank
            // line keeps them apart.
            if (targets.length === 0 && nextId !== null && !ends(nd)) push("", null);
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
        const words = wordsOf(nodes.get(id)!);
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
        const words = wordsOf(nd);
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
    return keepApart(lines, byLine, page);
}

/**
 * The lines, with a blank line put in wherever a step would flow on into the
 * next line but the page has no arrow between them — an arrow deleted on the
 * canvas, a box dropped on its own after the last step, the steps either
 * side of a box deleted without joining them, a branch added under a
 * question that goes nowhere yet. When a branch is kept apart that way, the
 * branches beside it that do go on to the next line say so with `-> Step`.
 */
function keepApart(
    lines: readonly string[],
    byLine: ReadonlyArray<string | null>,
    page: DiagramPage
): WrittenSteps {
    const parse = parseSteps(lines.join("\n"));
    const joined = new Set(page.edges.map(e => `${e.from.nodeId}>${e.to.nodeId}`));
    const idOf = (step: number) => byLine[parse.steps[step]!.line] ?? null;
    const isJoined = (from: number, to: number) => {
        const a = idOf(from);
        const b = idOf(to);
        return !a || !b || joined.has(`${a}>${b}`);
    };
    /** Lines a blank line goes before. */
    const before = new Set<number>();
    /** Branch lines that now say where they go: line → the words of the step. */
    const onTo = new Map<number, string>();
    /** Arrows from a decision's block on into the line after it, by that line's step. */
    const onward = new Map<number, number[]>();
    parse.links.forEach((link, k) => {
        const from = parse.steps[link.from]!;
        const line = parse.lines[link.line]!;
        if (link.via === "flow" && from.branchOf === null && link.line === from.line) {
            if (!isJoined(link.from, link.to)) before.add(parse.steps[link.to]!.line);
            return;
        }
        // A branch line with no `->` of its own that leads past its block.
        if (line.branch && line.target === null && link.to !== line.step) {
            onward.set(link.to, [...(onward.get(link.to) ?? []), k]);
        }
    });
    const firstWith = new Map<string, number>();
    parse.steps.forEach((st, i) => {
        const key = normalizeLabel(st.label);
        if (key && !firstWith.has(key)) firstWith.set(key, i);
    });
    for (const [to, ks] of onward) {
        const links = ks.map(k => parse.links[k]!);
        if (links.every(l => isJoined(l.from, l.to))) continue;
        const target = parse.steps[to]!;
        // `-> words` must find this step, not an earlier one with the same words.
        if (firstWith.get(normalizeLabel(target.label)) !== to) continue;
        before.add(target.line);
        for (const l of links) if (isJoined(l.from, l.to)) onTo.set(l.line, target.label);
    }
    if (before.size === 0) return idsForText(lines.join("\n"), byLine);
    const outLines: string[] = [];
    const outIds: Array<string | null> = [];
    lines.forEach((line, i) => {
        if (before.has(i) && (outLines[outLines.length - 1] ?? "").trim() !== "") {
            outLines.push("");
            outIds.push(null);
        }
        const target = onTo.get(i);
        outLines.push(target ? `${line.trimEnd()} -> ${target}` : line);
        outIds.push(byLine[i] ?? null);
    });
    return idsForText(outLines.join("\n"), outIds);
}

/**
 * The page as the lines can say it: a box with no words yet (Tab, then
 * nothing typed) has no line, so an arrow through it reads as one arrow from
 * the step before it to the step after. Everything else is as it was.
 */
export function withoutWordless(page: DiagramPage): DiagramPage {
    const wordless = new Set(
        page.nodes.filter(nd => isStepNode(nd) && oneLine(nd.text) === "").map(nd => nd.id)
    );
    if (wordless.size === 0) return page;
    const kept = page.edges.filter(
        e => !wordless.has(e.from.nodeId ?? "") && !wordless.has(e.to.nodeId ?? "")
    );
    const have = new Set(kept.map(e => `${e.from.nodeId}>${e.to.nodeId}`));
    const through: DiagramEdge[] = [];
    for (const first of page.edges) {
        const a = first.from.nodeId;
        if (!a || wordless.has(a) || !wordless.has(first.to.nodeId ?? "")) continue;
        // Every step past the wordless boxes this arrow leads into.
        const seen = new Set<string>();
        const queue = [first.to.nodeId!];
        while (queue.length > 0) {
            const id = queue.shift()!;
            if (seen.has(id)) continue;
            seen.add(id);
            for (const e of page.edges) {
                const b = e.to.nodeId;
                if (e.from.nodeId !== id || !b || b === a) continue;
                if (wordless.has(b)) queue.push(b);
                else if (!have.has(`${a}>${b}`)) {
                    have.add(`${a}>${b}`);
                    through.push({ ...first, id: `${first.id}~${b}`, to: { ...e.to } });
                }
            }
        }
    }
    return {
        ...page,
        nodes: page.nodes.filter(nd => !wordless.has(nd.id)),
        edges: [...kept, ...through],
    };
}
