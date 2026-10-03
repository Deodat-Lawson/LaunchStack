/**
 * Small builders for Vantage's wire shapes, shared by the suggestion tests.
 * Each returns a complete DTO with quiet defaults — nothing suggested,
 * nothing late, nothing missing — so a test spells out only the fields its
 * rule reads.
 */
import type {
    AgendaDto,
    CommitmentDto,
    OverviewDto,
    TopicDto,
    VantageEvidenceRef,
    WeeklySignals,
} from "~/app/employer/tools/vantage/api";

/** A Saturday: the next meeting is the week of Monday 5 October. */
export const TODAY = "2026-10-03";
export const WEEK = "2026-10-05";
export const WEEK_END = "2026-10-11";
export const LAST_WEEK = "2026-09-28";

export function ref(id: string, label = `Source ${id}`): VantageEvidenceRef {
    return { ref: id, label, date: "2026-09-30" };
}

export function topic(over: Partial<TopicDto> = {}): TopicDto {
    return {
        id: "t1",
        agendaId: "a1",
        position: 0,
        status: "suggested",
        origin: "ai",
        title: "A topic",
        facts: [],
        whyItMatters: "",
        decisionQuestion: "",
        proposedNextStep: "",
        proposedOwner: null,
        proposedDue: null,
        helpRequested: null,
        unknowns: [],
        conflicts: [],
        rationale: null,
        shared: false,
        decision: null,
        decidedAt: null,
        commitmentId: null,
        ...over,
    };
}

export function agenda(over: Partial<AgendaDto> = {}): AgendaDto {
    return {
        id: "a1",
        weekStart: WEEK,
        weekEnd: WEEK_END,
        status: "draft",
        summary: null,
        signals: null,
        modelMetadata: null,
        generatedAt: null,
        heldAt: null,
        createdAt: "2026-10-02T09:00:00.000Z",
        topics: [],
        ...over,
    };
}

export function commitment(over: Partial<CommitmentDto> = {}): CommitmentDto {
    return {
        id: "c1",
        agendaId: null,
        topicId: null,
        topicTitle: null,
        title: "A promise",
        owner: "Dana",
        dueOn: "2026-10-05",
        test: null,
        status: "open",
        outcome: null,
        shared: false,
        resolvedAt: null,
        createdAt: "2026-09-20T09:00:00.000Z",
        ...over,
    };
}

export function signals(over: Partial<WeeklySignals> = {}): WeeklySignals {
    return {
        weekStart: WEEK,
        since: "2026-09-21",
        computedAt: "2026-10-03T09:00:00.000Z",
        metricChanges: [],
        metricConflicts: [],
        metricsWithoutData: [],
        newEvidence: [],
        recentEvidenceIds: [],
        overdueCommitmentIds: [],
        dueThisWeekCommitmentIds: [],
        resolvedCommitmentIds: [],
        daysSinceLastEntry: 2,
        ...over,
    };
}

export function overview(over: Partial<OverviewDto> = {}): OverviewDto {
    return {
        today: TODAY,
        agendaWeek: WEEK,
        agendaWeekEnd: WEEK_END,
        agenda: null,
        previousAgenda: null,
        signals: signals(),
        checkIns: [],
        recentEvidence: [],
        counts: { evidenceThisWindow: 0, openCommitments: 0, metricsWithData: 0 },
        lastEntryAt: "2026-10-01T10:00:00.000Z",
        daysSinceLastEntry: 2,
        ...over,
    };
}
