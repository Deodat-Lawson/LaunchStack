/** Pure v1 input preparation. Never fetches URLs, documents, or database rows. */
import type { GenerationInput } from "./contract-v1";
import type { EvidencePack, MetricObservationDto, PackItem, WeeklySignals } from "./types";
import { matchingPreviousTopic } from "./revalidate-previous-v1";

export const MAX_GENERATION_ITEMS = 40;
export const MAX_EVIDENCE_BYTES = 14000;
export const localDate = (value: string): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(value));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
};
export const dayAdd = (date: string, n: number) =>
    new Date(Date.parse(date + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const newest = (a: MetricObservationDto, b: MetricObservationDto) =>
    compare(b.periodEnd, a.periodEnd) || compare(b.createdAt, a.createdAt) || compare(a.id, b.id);
const overlaps = (a: MetricObservationDto, b: MetricObservationDto) =>
    a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;
const pick = (o: MetricObservationDto) => ({
    observationId: o.id,
    value: o.value,
    periodStart: o.periodStart,
    periodEnd: o.periodEnd,
    source: o.source,
});

/** Defense in depth only; the host remains responsible for authorization. */
export function eligibleInput(input: GenerationInput): GenerationInput {
    const p = input.reportPeriod;
    const endDay = localDate(p.endExclusive);
    const last = p.kind === "completed-week" ? dayAdd(endDay, -1) : endDay;
    const beforeCutoff = (s: string) =>
        Number.isFinite(Date.parse(s)) && Date.parse(s) <= Date.parse(p.asOf);
    const inTime = (s: string) =>
        Date.parse(s) >= Date.parse(p.startInclusive) && Date.parse(s) < Date.parse(p.endExclusive);
    const definitions = input.data.metricDefinitions.filter(d => beforeCutoff(d.createdAt));
    const ids = new Set(definitions.map(d => d.id));
    const observation = (o: MetricObservationDto) =>
        ids.has(o.metricId) &&
        Number.isFinite(o.value) &&
        beforeCutoff(o.createdAt) &&
        o.periodStart <= o.periodEnd;
    return {
        ...input,
        data: {
            metricDefinitions: definitions,
            currentEvidence: input.data.currentEvidence.filter(
                e =>
                    beforeCutoff(e.createdAt) &&
                    (/^\d{4}-\d{2}-\d{2}$/.test(e.observedAt)
                        ? e.observedAt >= p.weekStart && e.observedAt <= last
                        : inTime(e.observedAt))
            ),
            currentObservations: input.data.currentObservations.filter(
                o => observation(o) && o.periodStart >= p.weekStart && o.periodEnd <= last
            ),
            comparisonObservations: input.data.comparisonObservations.filter(
                o => observation(o) && o.periodEnd < p.weekStart
            ),
            resolvedCommitments: input.data.resolvedCommitments.filter(
                c =>
                    beforeCutoff(c.createdAt) &&
                    c.status !== "open" &&
                    c.resolvedAt !== null &&
                    inTime(c.resolvedAt)
            ),
            carryForwardCommitments: input.data.carryForwardCommitments.filter(
                c => beforeCutoff(c.createdAt) && c.status === "open" && c.resolvedAt === null
            ),
        },
    };
}

/** Uses all eligible supplied rows, before pack limits. No wall-clock reads. */
export function computeGenerationSignals(input: GenerationInput): WeeklySignals {
    const { data, reportPeriod: p } = input;
    // Historical commitments are evaluated at the reporting cutoff, not today's wall clock.
    const today = localDate(new Date(Date.parse(p.endExclusive) - 1).toISOString());
    const signals: WeeklySignals = {
        weekStart: p.weekStart,
        since: p.weekStart,
        computedAt: p.asOf,
        metricChanges: [],
        metricConflicts: [],
        metricsWithoutData: [],
        newEvidence: [],
        recentEvidenceIds: [],
        overdueCommitmentIds: [],
        dueThisWeekCommitmentIds: [],
        resolvedCommitmentIds: [],
        daysSinceLastEntry: null,
    };
    for (const d of [...data.metricDefinitions].sort((a, b) => compare(a.id, b.id))) {
        const current = data.currentObservations.filter(o => o.metricId === d.id).sort(newest);
        const identity = { metricId: d.id, key: d.key, name: d.name };
        const latest = current[0];
        if (!latest) {
            signals.metricsWithoutData.push(identity);
            continue;
        }
        for (let i = 0; i < current.length; i++) {
            for (let j = i + 1; j < current.length; j++) {
                const a = current[i]!,
                    b = current[j]!;
                if (overlaps(a, b) && a.value !== b.value) {
                    signals.metricConflicts.push({ ...identity, a: pick(a), b: pick(b) });
                }
            }
        }
        // Match calendar windows, not elapsed hours (a DST week may have 167/169 hours).
        const candidates = data.comparisonObservations
            .filter(
                o =>
                    o.metricId === d.id &&
                    o.periodStart === dayAdd(latest.periodStart, -7) &&
                    o.periodEnd === dayAdd(latest.periodEnd, -7)
            )
            .sort(newest);
        const conflictingCurrent = current.some(
            o => overlaps(o, latest) && o.value !== latest.value
        );
        const previous =
            !conflictingCurrent &&
            candidates.length &&
            candidates.every(o => o.value === candidates[0]!.value)
                ? candidates[0]!
                : null;
        const rawDelta = previous ? latest.value - previous.value : null;
        const delta = rawDelta !== null && Number.isFinite(rawDelta) ? rawDelta : null;
        const rawPct =
            previous && previous.value !== 0 && delta !== null ? delta / previous.value : null;
        const pct = rawPct !== null && Number.isFinite(rawPct) ? rawPct : null;
        signals.metricChanges.push({
            ...identity,
            unit: d.unit,
            definition: d.definition,
            latest: pick(latest),
            previous: previous ? pick(previous) : null,
            delta,
            pct,
            direction: delta === null ? "new" : delta === 0 ? "flat" : delta > 0 ? "up" : "down",
            notable: delta !== null && delta !== 0 && (pct === null || Math.abs(pct) >= 0.2),
        });
    }
    const counts = new Map<(typeof data.currentEvidence)[number]["kind"], number>();
    for (const e of data.currentEvidence) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    signals.newEvidence = [...counts]
        .sort(([a], [b]) => compare(a, b))
        .map(([kind, count]) => ({ kind, count }));
    signals.recentEvidenceIds = [...data.currentEvidence]
        .sort((a, b) => compare(b.observedAt, a.observedAt) || compare(a.id, b.id))
        .slice(0, 40)
        .map(e => e.id);
    signals.overdueCommitmentIds = data.carryForwardCommitments
        .filter(c => c.dueOn < today)
        .map(c => c.id)
        .sort();
    signals.dueThisWeekCommitmentIds = data.carryForwardCommitments
        .filter(c => c.dueOn >= today && c.dueOn <= dayAdd(p.weekStart, 6))
        .map(c => c.id)
        .sort();
    signals.resolvedCommitmentIds = data.resolvedCommitments.map(c => c.id).sort();
    const dates = [
        ...data.currentEvidence,
        ...data.currentObservations,
        ...data.comparisonObservations,
        ...data.resolvedCommitments,
        ...data.carryForwardCommitments,
    ]
        .map(x => x.createdAt)
        .sort();
    if (dates.length)
        signals.daysSinceLastEntry = Math.max(0, days(localDate(dates.at(-1)!), localDate(p.asOf)));
    return signals;
}

export function selectGenerationEvidence(input: GenerationInput, signals: WeeklySignals) {
    const data = input.data;
    const ranked: { item: PackItem; priority: number }[] = [];
    const important = new Set(
        signals.metricConflicts.flatMap(c => [c.a.observationId, c.b.observationId])
    );
    const changes = new Set(
        signals.metricChanges
            .filter(c => c.notable)
            .flatMap(c => [
                c.latest.observationId,
                ...(c.previous ? [c.previous.observationId] : []),
            ])
    );
    for (const e of data.currentEvidence)
        ranked.push({
            // Search the supplied authorized current evidence for historical questions.
            // This bounded association never inserts a historical source into the pack.
            priority: matchingPreviousTopic(input, `${e.title} ${e.body}`, [`ev:${e.id}`])
                ? 2.5
                : 3,
            item: {
                ref: `ev:${e.id}`,
                kind: "evidence",
                label: e.source ?? e.title,
                date: e.observedAt,
                text: `${e.title}\n${e.kind === "document" ? "Workspace document verification: unavailable. This is a Vantage submission, not an actor-authorized document/version read.\n" : ""}${e.body}\nVisibility: ${e.visibility}. A source URL is not fetched.`,
            },
        });
    for (const [rows, context] of [
        [data.currentObservations, "current"],
        [data.comparisonObservations, "comparison context only"],
    ] as const) {
        for (const o of rows) {
            const d = data.metricDefinitions.find(d => d.id === o.metricId)!;
            ranked.push({
                priority: important.has(o.id)
                    ? 0
                    : changes.has(o.id)
                      ? 1
                      : context === "current"
                        ? 4
                        : 5,
                item: {
                    ref: `obs:${o.id}`,
                    kind: "observation",
                    label: o.source ?? o.metricName,
                    date: o.periodEnd,
                    text: `${context}: ${d.name} = ${o.value} ${d.unit}; ${o.periodStart} to ${o.periodEnd}. Definition: ${d.definition}. ${o.note ?? ""}`,
                },
            });
        }
    }
    for (const [rows, context] of [
        [data.carryForwardCommitments, "carry-forward context, not a current event"],
        [data.resolvedCommitments, "resolved in reporting period"],
    ] as const) {
        for (const c of rows)
            ranked.push({
                priority: 2,
                item: {
                    ref: `cm:${c.id}`,
                    kind: "commitment",
                    label: c.title,
                    date: c.dueOn,
                    text: `${context}: ${c.title}. Owner: ${c.owner}; original due: ${c.dueOn}; status: ${c.status}; created: ${c.createdAt}; resolved: ${c.resolvedAt ?? "not resolved"}. Test: ${c.test ?? "unknown"}. Outcome: ${c.outcome ?? "unknown"}.`,
                },
            });
    }
    ranked.sort(
        (a, b) =>
            a.priority - b.priority ||
            compare(b.item.date ?? "", a.item.date ?? "") ||
            compare(a.item.ref, b.item.ref)
    );
    const items: PackItem[] = [];
    let bytes = 0,
        truncated = 0;
    const seen = new Set<string>();
    for (const { item } of ranked) {
        if (seen.has(item.ref)) continue;
        seen.add(item.ref);
        const clipped = {
            ...item,
            label: item.label.slice(0, 200),
            text: item.text.slice(0, 1200),
        };
        const size = Buffer.byteLength(JSON.stringify(clipped), "utf8");
        if (items.length >= MAX_GENERATION_ITEMS || bytes + size > MAX_EVIDENCE_BYTES) continue;
        if (clipped.text !== item.text || clipped.label !== item.label) truncated++;
        items.push(clipped);
        bytes += size;
    }
    const pack: EvidencePack = { weekStart: input.reportPeriod.weekStart, signals, items };
    return {
        pack,
        selection: {
            eligibleItems: seen.size,
            selectedItems: items.length,
            omittedItems: seen.size - items.length,
            truncatedItems: truncated,
            evidenceBytes: bytes,
        },
    };
}
