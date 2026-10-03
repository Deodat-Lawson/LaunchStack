/**
 * Wire shapes for Vantage — what the API returns and the screens render.
 * Dates are ISO strings; ids are opaque. The web client mirrors these, so a
 * field added here shows up in one more place, not three.
 */

import type {
    VantageAgendaStatus,
    VantageCommitmentStatus,
    VantageConflict,
    VantageEvidenceKind,
    VantageEvidenceRef,
    VantageFact,
    VantageTopicOrigin,
    VantageTopicStatus,
    VantageVisibility,
} from "./schema";

export type {
    VantageAgendaStatus,
    VantageCommitmentStatus,
    VantageConflict,
    VantageEvidenceKind,
    VantageEvidenceRef,
    VantageFact,
    VantageTopicOrigin,
    VantageTopicStatus,
    VantageVisibility,
};

export interface EvidenceDto {
    id: string;
    kind: VantageEvidenceKind;
    title: string;
    body: string;
    source: string | null;
    sourceUrl: string | null;
    observedAt: string;
    visibility: VantageVisibility;
    tags: string[];
    createdAt: string;
}

export interface MetricDefinitionDto {
    id: string;
    key: string;
    name: string;
    definition: string;
    unit: string;
    createdAt: string;
}

export interface MetricObservationDto {
    id: string;
    metricId: string;
    metricKey: string;
    metricName: string;
    value: number;
    periodStart: string;
    periodEnd: string;
    source: string | null;
    note: string | null;
    createdAt: string;
}

export interface TopicDto {
    id: string;
    agendaId: string;
    position: number;
    status: VantageTopicStatus;
    origin: VantageTopicOrigin;
    title: string;
    facts: VantageFact[];
    whyItMatters: string;
    decisionQuestion: string;
    proposedNextStep: string;
    proposedOwner: string | null;
    proposedDue: string | null;
    helpRequested: string | null;
    unknowns: string[];
    conflicts: VantageConflict[];
    rationale: string | null;
    shared: boolean;
    decision: string | null;
    decidedAt: string | null;
    /** The commitment the decision created, when there is one. */
    commitmentId: string | null;
}

export interface AgendaDto {
    id: string;
    weekStart: string;
    weekEnd: string;
    status: VantageAgendaStatus;
    summary: string | null;
    signals: WeeklySignals | null;
    modelMetadata: Record<string, unknown> | null;
    generatedAt: string | null;
    heldAt: string | null;
    createdAt: string;
    topics: TopicDto[];
}

export interface AgendaSummaryDto {
    id: string;
    weekStart: string;
    weekEnd: string;
    status: VantageAgendaStatus;
    topicCount: number;
    decidedCount: number;
    generatedAt: string | null;
    heldAt: string | null;
}

export interface CommitmentDto {
    id: string;
    agendaId: string | null;
    topicId: string | null;
    topicTitle: string | null;
    title: string;
    owner: string;
    dueOn: string;
    test: string | null;
    status: VantageCommitmentStatus;
    outcome: string | null;
    shared: boolean;
    resolvedAt: string | null;
    createdAt: string;
}

export interface DeadlineDto {
    id: string;
    title: string;
    dueOn: string;
    note: string | null;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Signals — what the week's change detection produces
// ---------------------------------------------------------------------------

export interface MetricChange {
    metricId: string;
    key: string;
    name: string;
    unit: string;
    definition: string;
    latest: { observationId: string; value: number; periodStart: string; periodEnd: string };
    previous: {
        observationId: string;
        value: number;
        periodStart: string;
        periodEnd: string;
    } | null;
    delta: number | null;
    /** Fraction, e.g. 0.25 for +25%. Null when the previous value was 0 or missing. */
    pct: number | null;
    /** "up" | "down" | "flat" | "new" — new when there is nothing to compare. */
    direction: "up" | "down" | "flat" | "new";
    /** True when the swing is large enough to merit a topic on its own. */
    notable: boolean;
}

export interface MetricConflict {
    metricId: string;
    key: string;
    name: string;
    a: {
        observationId: string;
        value: number;
        periodStart: string;
        periodEnd: string;
        source: string | null;
    };
    b: {
        observationId: string;
        value: number;
        periodStart: string;
        periodEnd: string;
        source: string | null;
    };
}

export interface WeeklySignals {
    /** Monday of the week the agenda is for. */
    weekStart: string;
    /** The window the signals cover: evidence observed on or after this date. */
    since: string;
    computedAt: string;
    metricChanges: MetricChange[];
    metricConflicts: MetricConflict[];
    /** Metrics defined but with no number for the window. */
    metricsWithoutData: { metricId: string; key: string; name: string }[];
    newEvidence: { kind: VantageEvidenceKind; count: number }[];
    /** Interviews and notes added in the window, newest first, capped. */
    recentEvidenceIds: string[];
    overdueCommitmentIds: string[];
    dueThisWeekCommitmentIds: string[];
    /** Commitments resolved in the window — done, missed or dropped — with their outcome. */
    resolvedCommitmentIds: string[];
    /** Days since anything was logged. Null when nothing was ever logged. */
    daysSinceLastEntry: number | null;
}

// ---------------------------------------------------------------------------
// The evidence pack the generator reads
// ---------------------------------------------------------------------------

/** One citable item, with the id the generator must use to cite it. */
export interface PackItem {
    ref: string;
    kind: "evidence" | "observation" | "commitment";
    label: string;
    date: string | null;
    text: string;
}

export interface EvidencePack {
    weekStart: string;
    items: PackItem[];
    signals: WeeklySignals;
}

/** A topic as the generator or the rules produce it, before it is stored. */
export interface DraftTopic {
    title: string;
    facts: VantageFact[];
    whyItMatters: string;
    decisionQuestion: string;
    proposedNextStep: string;
    proposedOwner: string | null;
    proposedDue: string | null;
    helpRequested: string | null;
    unknowns: string[];
    conflicts: VantageConflict[];
    rationale: string;
}

export interface AgendaDraft {
    summary: string;
    topics: DraftTopic[];
    origin: "ai" | "rules";
    modelMetadata: Record<string, unknown>;
}
