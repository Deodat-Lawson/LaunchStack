/**
 * Weekly change detection — the deterministic half of "what changed or
 * remains uncertain". Pure: rows in, signals out, nothing read from the
 * database or the clock. The generator reads these; the overview renders
 * them; a test can pin every rule.
 *
 * Also here: the rules-based agenda draft the product falls back to when no
 * model is configured or the call fails, and the citation check that keeps
 * a generated topic honest about what it can point at.
 */

import type {
    VantageCommitmentRow,
    VantageEvidenceKind,
    VantageEvidenceRef,
    VantageEvidenceRow,
    VantageFact,
    VantageMetricDefinitionRow,
    VantageMetricObservationRow,
} from "./schema";
import type {
    AgendaDraft,
    DraftTopic,
    EvidencePack,
    MetricChange,
    MetricConflict,
    PackItem,
    WeeklySignals,
} from "./types";
import { addDays, daysBetween, toIsoDate, weekEndOf } from "./week";

/** A swing at or past this fraction is worth its own topic. */
export const NOTABLE_PCT = 0.2;
/** How far back the pack looks for evidence. */
export const WINDOW_DAYS = 14;
/** How many recent evidence items the pack carries, newest first. */
export const MAX_PACK_EVIDENCE = 40;

export const EVIDENCE_KIND_LABEL: Record<VantageEvidenceKind, string> = {
    note: "Note",
    interview: "Interview",
    link: "Link",
    task: "Task",
    claim: "Claim",
    document: "Document",
};

export interface SignalInputs {
    weekStart: string;
    now: Date;
    definitions: VantageMetricDefinitionRow[];
    observations: VantageMetricObservationRow[];
    evidence: VantageEvidenceRow[];
    commitments: VantageCommitmentRow[];
}

function byPeriodEndDesc(a: VantageMetricObservationRow, b: VantageMetricObservationRow): number {
    if (a.periodEnd !== b.periodEnd) return a.periodEnd < b.periodEnd ? 1 : -1;
    if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? 1 : -1;
    return a.createdAt.getTime() < b.createdAt.getTime() ? 1 : -1;
}

function overlaps(a: VantageMetricObservationRow, b: VantageMetricObservationRow): boolean {
    return a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;
}

/**
 * Latest observation per metric against the one before it. Two numbers for
 * overlapping periods that disagree are a conflict, not a change — the deck
 * said 1,200 and analytics said 900, and the agenda must say so rather than
 * pick one.
 */
export function detectMetricChanges(
    definitions: VantageMetricDefinitionRow[],
    observations: VantageMetricObservationRow[]
): { changes: MetricChange[]; conflicts: MetricConflict[]; withoutData: MetricChange["key"][] } {
    const changes: MetricChange[] = [];
    const conflicts: MetricConflict[] = [];
    const withoutData: string[] = [];

    for (const def of definitions) {
        const rows = observations.filter(o => o.metricId === def.id).sort(byPeriodEndDesc);
        if (rows.length === 0) {
            withoutData.push(def.key);
            continue;
        }

        // Conflicts: any pair with overlapping periods and different values.
        for (let i = 0; i < rows.length; i++) {
            for (let j = i + 1; j < rows.length; j++) {
                const a = rows[i]!;
                const b = rows[j]!;
                if (overlaps(a, b) && a.value !== b.value) {
                    conflicts.push({
                        metricId: def.id,
                        key: def.key,
                        name: def.name,
                        a: pick(a),
                        b: pick(b),
                    });
                }
            }
        }

        const latest = rows[0]!;
        // The previous *period*: skip anything overlapping the latest.
        const previous = rows.slice(1).find(r => !overlaps(r, latest)) ?? null;
        const delta = previous ? latest.value - previous.value : null;
        const pct =
            previous && previous.value !== 0 && delta !== null ? delta / previous.value : null;
        const direction: MetricChange["direction"] = !previous
            ? "new"
            : delta === 0
              ? "flat"
              : delta! > 0
                ? "up"
                : "down";
        const notable =
            direction !== "flat" &&
            direction !== "new" &&
            (pct === null ? Math.abs(delta ?? 0) > 0 : Math.abs(pct) >= NOTABLE_PCT);
        changes.push({
            metricId: def.id,
            key: def.key,
            name: def.name,
            unit: def.unit,
            definition: def.definition,
            latest: pick(latest),
            previous: previous ? pick(previous) : null,
            delta,
            pct,
            direction,
            notable,
        });
    }
    return { changes, conflicts, withoutData };
}

function pick(row: VantageMetricObservationRow) {
    return {
        observationId: row.id,
        value: row.value,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        source: row.source ?? null,
    };
}

export function computeSignals(input: SignalInputs): WeeklySignals {
    const today = toIsoDate(input.now);
    const since = addDays(today, -WINDOW_DAYS);
    const weekEnd = weekEndOf(input.weekStart);

    const { changes, conflicts, withoutData } = detectMetricChanges(
        input.definitions,
        input.observations
    );
    const withoutDataRows = input.definitions
        .filter(d => withoutData.includes(d.key))
        .map(d => ({ metricId: d.id, key: d.key, name: d.name }));

    const recent = input.evidence
        .filter(e => e.observedAt >= since)
        .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0));
    const counts = new Map<VantageEvidenceKind, number>();
    for (const e of recent) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

    const open = input.commitments.filter(c => c.status === "open");
    const overdue = open.filter(c => c.dueOn < today).map(c => c.id);
    const dueThisWeek = open.filter(c => c.dueOn >= today && c.dueOn <= weekEnd).map(c => c.id);
    const resolved = input.commitments
        .filter(c => c.status !== "open" && c.resolvedAt && toIsoDate(c.resolvedAt) >= since)
        .map(c => c.id);

    const lastEntry = [
        ...input.evidence.map(e => e.createdAt),
        ...input.observations.map(o => o.createdAt),
        ...input.commitments.map(c => c.createdAt),
    ].sort((a, b) => b.getTime() - a.getTime())[0];

    return {
        weekStart: input.weekStart,
        since,
        computedAt: input.now.toISOString(),
        metricChanges: changes,
        metricConflicts: conflicts,
        metricsWithoutData: withoutDataRows,
        newEvidence: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
        recentEvidenceIds: recent.slice(0, MAX_PACK_EVIDENCE).map(e => e.id),
        overdueCommitmentIds: overdue,
        dueThisWeekCommitmentIds: dueThisWeek,
        resolvedCommitmentIds: resolved,
        daysSinceLastEntry: lastEntry ? daysBetween(toIsoDate(lastEntry), today) : null,
    };
}

// ---------------------------------------------------------------------------
// The evidence pack
// ---------------------------------------------------------------------------

export const REF_PREFIX = { evidence: "ev", observation: "obs", commitment: "cm" } as const;

export function evidenceRef(id: string): string {
    return `${REF_PREFIX.evidence}:${id}`;
}
export function observationRef(id: string): string {
    return `${REF_PREFIX.observation}:${id}`;
}
export function commitmentRef(id: string): string {
    return `${REF_PREFIX.commitment}:${id}`;
}

export function formatNumber(value: number, unit: string): string {
    const n = Number.isInteger(value)
        ? value.toLocaleString("en-US")
        : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (unit === "percent" || unit === "%") return `${n}%`;
    if (unit === "count" || unit === "") return n;
    if (unit === "usd" || unit === "$") return `$${n}`;
    if (unit === "eur" || unit === "€") return `€${n}`;
    return `${n} ${unit}`;
}

export function periodLabel(start: string, end: string): string {
    return start === end ? start : `${start} to ${end}`;
}

/**
 * Everything the generator may cite, each with the id it must cite by.
 * Deliberately built from the same rows the signals were: the model never
 * sees a number the overview cannot show.
 */
export function buildEvidencePack(input: SignalInputs, signals: WeeklySignals): EvidencePack {
    const items: PackItem[] = [];
    const defs = new Map(input.definitions.map(d => [d.id, d]));

    const recentIds = new Set(signals.recentEvidenceIds);
    for (const e of input.evidence) {
        if (!recentIds.has(e.id)) continue;
        items.push({
            ref: evidenceRef(e.id),
            kind: "evidence",
            label: `${EVIDENCE_KIND_LABEL[e.kind]}: ${e.title}`,
            date: e.observedAt,
            text: [
                e.body.trim(),
                e.source ? `Source: ${e.source}` : null,
                e.visibility === "private" ? "(private note)" : null,
            ]
                .filter(Boolean)
                .join("\n"),
        });
    }

    // Every observation the changes and conflicts point at, plus the last
    // few per metric so a trend is visible.
    const wanted = new Set<string>();
    for (const c of signals.metricChanges) {
        wanted.add(c.latest.observationId);
        if (c.previous) wanted.add(c.previous.observationId);
    }
    for (const c of signals.metricConflicts) {
        wanted.add(c.a.observationId);
        wanted.add(c.b.observationId);
    }
    const perMetric = new Map<string, number>();
    const sorted = [...input.observations].sort(byPeriodEndDesc);
    for (const o of sorted) {
        const n = perMetric.get(o.metricId) ?? 0;
        if (n < 4) {
            wanted.add(o.id);
            perMetric.set(o.metricId, n + 1);
        }
    }
    for (const o of sorted) {
        if (!wanted.has(o.id)) continue;
        const def = defs.get(o.metricId);
        if (!def) continue;
        items.push({
            ref: observationRef(o.id),
            kind: "observation",
            label: `${def.name}: ${formatNumber(o.value, def.unit)} (${periodLabel(o.periodStart, o.periodEnd)})`,
            date: o.periodEnd,
            text: [
                `${def.name} = ${formatNumber(o.value, def.unit)} for ${periodLabel(o.periodStart, o.periodEnd)}.`,
                `Definition: ${def.definition}`,
                o.source ? `Source: ${o.source}` : null,
                o.note ? `Note: ${o.note}` : null,
            ]
                .filter(Boolean)
                .join("\n"),
        });
    }

    const commitmentIds = new Set([
        ...signals.overdueCommitmentIds,
        ...signals.dueThisWeekCommitmentIds,
        ...signals.resolvedCommitmentIds,
    ]);
    for (const c of input.commitments) {
        if (!commitmentIds.has(c.id)) continue;
        const state =
            c.status === "open"
                ? signals.overdueCommitmentIds.includes(c.id)
                    ? "overdue"
                    : "due this week"
                : c.status;
        items.push({
            ref: commitmentRef(c.id),
            kind: "commitment",
            label: `Commitment (${state}): ${c.title}`,
            date: c.dueOn,
            text: [
                `${c.title} — owner ${c.owner}, due ${c.dueOn}, ${state}.`,
                c.test ? `Test: ${c.test}` : null,
                c.outcome ? `Outcome: ${c.outcome}` : null,
            ]
                .filter(Boolean)
                .join("\n"),
        });
    }

    return { weekStart: input.weekStart, items, signals };
}

// ---------------------------------------------------------------------------
// Citation validation
// ---------------------------------------------------------------------------

export function refFor(pack: EvidencePack, ref: string): VantageEvidenceRef | null {
    const item = pack.items.find(i => i.ref === ref);
    return item ? { ref: item.ref, label: item.label, date: item.date } : null;
}

/**
 * Keep only citations the pack can confirm. A fact left with none is kept
 * but marked `unsupported`, so the founder sees exactly which sentence the
 * model could not back — deleting it silently would hide the gap, and
 * keeping it unmarked would pretend it is evidence.
 */
export function validateFacts(
    pack: EvidencePack,
    facts: { text: string; refs: string[] }[]
): VantageFact[] {
    return facts
        .map(f => {
            const refs = [...new Set(f.refs)]
                .map(r => refFor(pack, r))
                .filter((r): r is VantageEvidenceRef => r !== null);
            return { text: f.text.trim(), refs, unsupported: refs.length === 0 };
        })
        .filter(f => f.text.length > 0);
}

export function validateRefs(pack: EvidencePack, refs: string[]): VantageEvidenceRef[] {
    return [...new Set(refs)]
        .map(r => refFor(pack, r))
        .filter((r): r is VantageEvidenceRef => r !== null);
}

// ---------------------------------------------------------------------------
// The rules-based draft
// ---------------------------------------------------------------------------

function pctLabel(pct: number | null, delta: number | null, unit: string): string {
    if (pct !== null) return `${pct > 0 ? "+" : ""}${Math.round(pct * 100)}%`;
    if (delta !== null) return `${delta > 0 ? "+" : ""}${formatNumber(delta, unit)}`;
    return "";
}

/** The size of a move without its sign, for "rose 33%" / "fell 33%". */
function magnitudeLabel(pct: number | null, delta: number | null, unit: string): string {
    if (pct !== null) return `${Math.round(Math.abs(pct) * 100)}%`;
    if (delta !== null) return formatNumber(Math.abs(delta), unit);
    return "";
}

/**
 * The agenda without a model: one topic per notable metric swing, one per
 * metric conflict, one for overdue commitments, one for interviews with
 * nothing decided yet, one for metrics with no data. Each carries the same
 * six parts a generated topic must, with honest wording: the rules can say
 * what happened and what to decide, and say "unknown" for why.
 */
export function draftFromRules(pack: EvidencePack, input: SignalInputs): AgendaDraft {
    const { signals } = pack;
    const topics: DraftTopic[] = [];
    const weekEnd = weekEndOf(signals.weekStart);
    const commitmentById = new Map(input.commitments.map(c => [c.id, c]));

    for (const conflict of signals.metricConflicts.slice(0, 2)) {
        const refs = validateRefs(pack, [
            observationRef(conflict.a.observationId),
            observationRef(conflict.b.observationId),
        ]);
        const unit = input.definitions.find(d => d.id === conflict.metricId)?.unit ?? "count";
        topics.push({
            title: `Two numbers for ${conflict.name}`,
            facts: [
                {
                    text: `${conflict.name} is recorded as ${formatNumber(conflict.a.value, unit)} (${conflict.a.source ?? "no source"}) and ${formatNumber(conflict.b.value, unit)} (${conflict.b.source ?? "no source"}) for overlapping periods.`,
                    refs,
                },
            ],
            whyItMatters:
                "A metric with two values cannot be reused in an update or an application until the definitions are reconciled.",
            decisionQuestion: `Which definition of ${conflict.name} is the one we report, and what does each number actually count?`,
            proposedNextStep: `Write the definition of ${conflict.name} down and re-enter the numbers against it.`,
            proposedOwner: null,
            proposedDue: weekEnd,
            helpRequested: null,
            unknowns: ["Whether the two sources count the same thing."],
            conflicts: [
                {
                    text: `${formatNumber(conflict.a.value, unit)} vs ${formatNumber(conflict.b.value, unit)} for ${conflict.name}.`,
                    refs,
                },
            ],
            rationale: "Two observations of the same metric overlap in period and disagree.",
        });
    }

    const notable = signals.metricChanges
        .filter(c => c.notable)
        .sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0));
    for (const change of notable.slice(0, 2)) {
        const refs = validateRefs(pack, [
            observationRef(change.latest.observationId),
            ...(change.previous ? [observationRef(change.previous.observationId)] : []),
        ]);
        const word = change.direction === "up" ? "rose" : "fell";
        topics.push({
            title: `${change.name} ${word} ${magnitudeLabel(change.pct, change.delta, change.unit)}`,
            facts: [
                {
                    text: `${change.name} was ${formatNumber(change.latest.value, change.unit)} for ${periodLabel(change.latest.periodStart, change.latest.periodEnd)}, against ${change.previous ? formatNumber(change.previous.value, change.unit) : "no prior number"} the period before.`,
                    refs,
                },
            ],
            whyItMatters: `A ${Math.round(Math.abs(change.pct ?? 0) * 100)}% move in one period is larger than noise for a team this size; the cause is not in the evidence.`,
            decisionQuestion:
                change.direction === "up"
                    ? `Do we put next week into what drove ${change.name} up, or hold and confirm it repeats?`
                    : `Do we fix what pulled ${change.name} down before anything else, or accept it for now?`,
            proposedNextStep: `Name the one likely cause and run a one-week check that would confirm or rule it out.`,
            proposedOwner: null,
            proposedDue: weekEnd,
            helpRequested: null,
            unknowns: [`What caused the change in ${change.name}.`],
            conflicts: [],
            rationale: `${change.name} moved ${pctLabel(change.pct, change.delta, change.unit)} between the last two periods.`,
        });
    }

    if (signals.overdueCommitmentIds.length > 0) {
        const rows = signals.overdueCommitmentIds
            .map(id => commitmentById.get(id))
            .filter((c): c is VantageCommitmentRow => Boolean(c));
        const refs = validateRefs(
            pack,
            rows.map(c => commitmentRef(c.id))
        );
        topics.push({
            title:
                rows.length === 1
                    ? `Overdue: ${rows[0]!.title}`
                    : `${rows.length} commitments are overdue`,
            facts: rows.map(c => ({
                text: `"${c.title}" (${c.owner}) was due ${c.dueOn} and is still open.`,
                refs: validateRefs(pack, [commitmentRef(c.id)]),
            })),
            whyItMatters:
                "A promise that slipped without a decision is either still the right thing to do, or it is not; the meeting should say which.",
            decisionQuestion: "Re-commit with a new date, hand it to someone else, or drop it?",
            proposedNextStep: "Pick one of the three for each item before the meeting ends.",
            proposedOwner: rows.length === 1 ? rows[0]!.owner : null,
            proposedDue: weekEnd,
            helpRequested: null,
            unknowns: ["Why it slipped."],
            conflicts: [],
            rationale: `${rows.length} open commitment${rows.length === 1 ? " is" : "s are"} past due — ${refs.length} cited.`,
        });
    }

    const interviews = input.evidence
        .filter(e => e.kind === "interview" && signals.recentEvidenceIds.includes(e.id))
        .slice(0, 5);
    if (interviews.length > 0) {
        topics.push({
            title: `${interviews.length} customer conversation${interviews.length === 1 ? "" : "s"} to draw a decision from`,
            facts: interviews.map(e => ({
                text: `${e.title} (${e.observedAt}): ${firstSentence(e.body)}`,
                refs: validateRefs(pack, [evidenceRef(e.id)]),
            })),
            whyItMatters:
                "Conversations are the richest evidence an early team has, and the easiest to leave as notes. Enthusiasm in a call is not willingness to pay.",
            decisionQuestion:
                "What is the one thing these conversations should change about next week's plan — and what would prove it?",
            proposedNextStep:
                "Write the one claim the calls support and the one they do not, and pick a test for the second.",
            proposedOwner: null,
            proposedDue: weekEnd,
            helpRequested: null,
            unknowns: ["Whether the people interviewed would pay."],
            conflicts: [],
            rationale: `${interviews.length} interview note${interviews.length === 1 ? "" : "s"} in the window.`,
        });
    }

    if (topics.length < 3 && signals.metricsWithoutData.length > 0) {
        const names = signals.metricsWithoutData.map(m => m.name);
        topics.push({
            title: `No numbers yet for ${names.slice(0, 3).join(", ")}`,
            facts: [],
            whyItMatters:
                "A metric that is defined but never recorded cannot show a change; the agenda is flying on interviews alone.",
            decisionQuestion:
                "Which one metric do we commit to recording every week, and from where?",
            proposedNextStep: "Enter this week's number for it and name its source.",
            proposedOwner: null,
            proposedDue: weekEnd,
            helpRequested: null,
            unknowns: names.map(n => `${n} for the current period.`),
            conflicts: [],
            rationale: "Defined metrics without any observation.",
        });
    }

    const summaryBits: string[] = [];
    if (signals.newEvidence.length > 0)
        summaryBits.push(
            signals.newEvidence
                .map(
                    n =>
                        `${n.count} ${EVIDENCE_KIND_LABEL[n.kind].toLowerCase()}${n.count === 1 ? "" : "s"}`
                )
                .join(", ") + " logged"
        );
    if (notable.length > 0)
        summaryBits.push(
            notable.map(c => `${c.name} ${pctLabel(c.pct, c.delta, c.unit)}`).join(", ")
        );
    if (signals.metricConflicts.length > 0)
        summaryBits.push(
            `${signals.metricConflicts.length} conflicting number${signals.metricConflicts.length === 1 ? "" : "s"}`
        );
    if (signals.overdueCommitmentIds.length > 0)
        summaryBits.push(
            `${signals.overdueCommitmentIds.length} overdue commitment${signals.overdueCommitmentIds.length === 1 ? "" : "s"}`
        );

    return {
        summary:
            summaryBits.length > 0
                ? `Since ${signals.since}: ${summaryBits.join("; ")}.`
                : "Nothing new was logged in the last two weeks. Add evidence and metrics and prepare again.",
        topics: topics.slice(0, 5),
        origin: "rules",
        modelMetadata: { mode: "rules" },
    };
}

function firstSentence(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    const end = flat.search(/[.!?](\s|$)/);
    const cut = end === -1 ? flat : flat.slice(0, end + 1);
    return cut.length > 200 ? `${cut.slice(0, 199)}…` : cut;
}
