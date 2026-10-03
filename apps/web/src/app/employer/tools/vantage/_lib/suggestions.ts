/**
 * What Vantage suggests for the week, as plain data: which suggestions show,
 * in which group, in which order. Built only from what the overview already
 * carries — the drafted agenda, the check-ins, the signals — so every card
 * on This week is something the founder can take or leave with one click,
 * and the order is pinned by a unit test rather than by eye.
 *
 * The groups follow the week: get the meeting ready, follow through on what
 * was promised, keep the record current. After the meeting is held,
 * following through comes first.
 */
import type { AgendaDto, CommitmentDto, OverviewDto, TopicDto, VantageEvidenceRef } from "../api";
import { agoWords } from "./format";

export type WeekSuggestion =
    /** A drafted topic still waiting for Keep or Ignore. */
    | { kind: "topic"; id: string; topic: TopicDto; agenda: AgendaDto }
    /** Every suggestion handled and something kept: the agenda can go to the meeting. */
    | { kind: "mark-ready"; id: string; agenda: AgendaDto; kept: number }
    /** A promise due or overdue: did it happen? */
    | { kind: "check-in"; id: string; commitment: CommitmentDto; late: boolean }
    /** A topic discussed at a held meeting, undecided, with a proposed next step. */
    | { kind: "commit"; id: string; topic: TopicDto; agenda: AgendaDto }
    /** Metrics with no number for the week. */
    | { kind: "record-numbers"; id: string; metrics: { metricId: string; name: string }[] }
    /** Nothing logged for over a week. */
    | { kind: "log-evidence"; id: string; days: number | null };

export type SuggestionGroupId = "meeting" | "follow-through" | "record";

export interface SuggestionGroup {
    id: SuggestionGroupId;
    items: WeekSuggestion[];
}

/** Whether there is anything on file for a draft to read. */
export function hasMaterial(o: Pick<OverviewDto, "counts" | "checkIns">): boolean {
    return (
        o.counts.evidenceThisWindow > 0 ||
        o.counts.metricsWithData > 0 ||
        o.counts.openCommitments > 0 ||
        o.checkIns.length > 0
    );
}

/** Topics in their agenda order, dismissed ones out. */
function ordered(agenda: AgendaDto): TopicDto[] {
    return [...agenda.topics]
        .filter(t => t.status !== "dismissed")
        .sort((a, b) => a.position - b.position);
}

/** A kept topic the meeting talked about but nobody has committed to yet. */
export function readyToCommit(topic: TopicDto): boolean {
    return (
        topic.status === "kept" &&
        !topic.decision &&
        !topic.commitmentId &&
        topic.proposedNextStep.trim() !== ""
    );
}

export function weekSuggestions(
    overview: OverviewDto,
    opts: { today: string; hidden?: ReadonlySet<string> }
): SuggestionGroup[] {
    const hidden = opts.hidden ?? new Set<string>();
    const visible = (s: WeekSuggestion) => !hidden.has(s.id);
    const { agenda, previousAgenda } = overview;

    const meeting: WeekSuggestion[] = [];
    if (agenda) {
        const live = ordered(agenda);
        const suggested = live.filter(t => t.status === "suggested" && !t.decision);
        for (const topic of suggested)
            meeting.push({ kind: "topic", id: `topic:${topic.id}`, topic, agenda });
        const kept = live.filter(t => t.status === "kept").length;
        if (agenda.status === "draft" && suggested.length === 0 && kept > 0)
            meeting.push({ kind: "mark-ready", id: `ready:${agenda.id}`, agenda, kept });
    }

    const commits: WeekSuggestion[] = [];
    for (const a of [previousAgenda, agenda]) {
        if (!a || a.status !== "held") continue;
        for (const topic of ordered(a).filter(readyToCommit))
            commits.push({ kind: "commit", id: `commit:${topic.id}`, topic, agenda: a });
    }
    const checkIns = [...overview.checkIns]
        .sort((x, y) => (x.dueOn < y.dueOn ? -1 : x.dueOn > y.dueOn ? 1 : 0))
        .map(
            (commitment): WeekSuggestion => ({
                kind: "check-in",
                id: `check-in:${commitment.id}`,
                commitment,
                late: commitment.dueOn < opts.today,
            })
        );
    const late = checkIns.filter(c => c.kind === "check-in" && c.late);
    const due = checkIns.filter(c => c.kind === "check-in" && !c.late);
    const followThrough = [...late, ...commits, ...due];

    const record: WeekSuggestion[] = [];
    const missing = overview.signals.metricsWithoutData;
    if (missing.length > 0)
        record.push({
            kind: "record-numbers",
            id: `numbers:${overview.agendaWeek}`,
            metrics: missing.map(m => ({ metricId: m.metricId, name: m.name })),
        });
    const quiet = overview.daysSinceLastEntry;
    if (quiet === null || quiet > 7)
        record.push({ kind: "log-evidence", id: `quiet:${overview.agendaWeek}`, days: quiet });

    const groups: SuggestionGroup[] = [
        { id: "meeting", items: meeting.filter(visible) },
        { id: "follow-through", items: followThrough.filter(visible) },
        { id: "record", items: record.filter(visible) },
    ];
    // Once the meeting is held, what it decided matters more than the next draft.
    if (agenda?.status === "held" || (!agenda && previousAgenda?.status === "held"))
        groups.unshift(groups.splice(1, 1)[0]!);
    return groups.filter(g => g.items.length > 0);
}

/** The distinct sources a topic's facts cite, in the order they first appear. */
export function topicSources(topic: TopicDto): {
    refs: VantageEvidenceRef[];
    unsupported: boolean;
} {
    const seen = new Set<string>();
    const refs: VantageEvidenceRef[] = [];
    for (const f of topic.facts)
        for (const r of f.refs)
            if (!seen.has(r.ref)) {
                seen.add(r.ref);
                refs.push(r);
            }
    return { refs, unsupported: topic.facts.some(f => f.unsupported) };
}

/** The one line that says why a topic is worth the meeting's time. */
export function topicReason(topic: TopicDto): string {
    for (const line of [topic.whyItMatters, topic.rationale, topic.facts[0]?.text])
        if (line?.trim()) return line.trim();
    return "";
}

/** Who made a suggestion, in words that stay true whether or not a model ran. */
export function originWords(origin: TopicDto["origin"]): string {
    return origin === "ai" ? "AI draft" : origin === "rules" ? "From your records" : "Yours";
}

/** "drafted by AI yesterday" — who made an agenda's draft and when, from its metadata. */
export function draftedWords(agenda: AgendaDto, now = new Date()): string | null {
    if (!agenda.generatedAt) return null;
    const mode = agenda.modelMetadata?.mode as string | undefined;
    const by = mode === "ai" ? " by AI" : mode === "rules" ? " from your records" : "";
    return `drafted${by} ${agoWords(agenda.generatedAt, now)}`;
}
