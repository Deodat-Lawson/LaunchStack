/** Historical agenda context is a set of questions, never current-world evidence. */
import { createHash } from "node:crypto";
import type { AgendaV1Dto, ReportPeriod } from "./contract-v1";
import type { CommitmentDto, TopicDto } from "./types";

export const MAX_PREVIOUS_VANTAGE_BYTES = 4096;
export const MAX_PREVIOUS_VANTAGE_TOPICS = 6;
export const MAX_PREVIOUS_VANTAGE_REFS = 8;

export interface PreviousVantageSource {
    ref: string;
    status:
        | "available"
        | "missing-or-unauthorized"
        | "after-cutoff"
        | "document-verification-unavailable"
        | "unsupported-ref";
    documentVerification: "not-applicable" | "unavailable";
}
export interface PreviousVantageTopic {
    topicId: string;
    contentVersion: number;
    origin: TopicDto["origin"];
    status: TopicDto["status"];
    /** All prose below is an untrusted historical assertion or suggestion. */
    title: string;
    /** Prior fact-like sentences are still untrusted claims to re-check. */
    historicalClaims?: string[];
    interpretation: string;
    question: string;
    suggestedNextStep: string;
    suggestedDue: string | null;
    /** A record that someone chose this, not evidence that planned work happened. */
    recordedDecision: { text: string; decidedAt: string | null } | null;
    /** Reported database state, not an inferred completion assessment. */
    reportedActions: {
        id: string;
        /** Full relevant DTO fingerprint, calculated before text clipping. */
        stateVersion?: string;
        title: string;
        owner: string;
        dueOn: string;
        test: string | null;
        status: CommitmentDto["status"];
        outcome: string | null;
        resolvedAt: string | null;
        createdAt: string;
    }[];
    /** Provenance only. These IDs do not extend current citation eligibility. */
    originalRefs: PreviousVantageSource[];
}
export interface PreviousVantageContext {
    contractVersion: "previous-vantage/v1";
    trust: "untrusted-history";
    reportId: string;
    weekStart: string;
    generatedAt: string | null;
    reportVersion: number;
    /** Fingerprint covers full relevant state, including text omitted from this projection. */
    snapshotVersion: string;
    summary: string | null;
    topics: PreviousVantageTopic[];
    unavailableSources: PreviousVantageSource[];
    omissions: { topics: number; refs: number; summary: boolean };
    documentVerification: "unavailable";
}
export interface PreviousVantageAssemblyInput {
    currentPeriod: ReportPeriod;
    report: AgendaV1Dto | null;
    actions?: CommitmentDto[];
    sourceStates?: PreviousVantageSource[];
    reportUpdatedAt?: string | null;
    topicState?: Record<string, { createdAt?: string; updatedAt?: string | null }>;
    actionState?: Record<string, { updatedAt?: string | null }>;
    snapshotVersion?: string;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const clipped = (value: string | null | undefined, length: number) =>
    (value ?? "").replace(/\u0000/g, "").slice(0, length);
const nullable = (value: string | null | undefined, length: number) =>
    value ? clipped(value, length) : null;
const priorWeek = (week: string) =>
    new Date(Date.parse(week + "T12:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
const within = (value: string | null | undefined, asOf: string) =>
    value == null || (Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(asOf));
export const previousTopicRefs = (topic: Pick<TopicDto, "facts" | "conflicts">): string[] =>
    [...new Set([...topic.facts, ...topic.conflicts].flatMap(f => f.refs.map(r => r.ref)))].sort(
        compare
    );

/** Full state hashing is deliberately independent of text clipping and projection budgets. */
export function previousVantageFingerprint(value: unknown): string {
    const canonical = (v: unknown): unknown =>
        typeof v === "bigint"
            ? { $bigint: v.toString() }
            : v instanceof Date
              ? v.toISOString()
              : Array.isArray(v)
                ? v.map(canonical)
                : v && typeof v === "object"
                  ? Object.fromEntries(
                        Object.entries(v)
                            .sort(([a], [b]) => compare(a, b))
                            .map(([key, item]) => [key, canonical(item)])
                    )
                  : v;
    return createHash("sha256")
        .update(JSON.stringify(canonical(value)))
        .digest("hex");
}

/** Compare a full current action to history without mistaking clipping for a change. */
export function previousActionStateFingerprint(action: CommitmentDto): string {
    return previousVantageFingerprint({
        id: action.id,
        agendaId: action.agendaId,
        topicId: action.topicId,
        title: action.title,
        owner: action.owner,
        dueOn: action.dueOn,
        test: action.test,
        status: action.status,
        outcome: action.outcome,
        shared: action.shared,
        resolvedAt: action.resolvedAt,
        createdAt: action.createdAt,
    });
}

/**
 * The reader must authorize the report and fresh source states before calling.
 * Missing checks fail closed. No document URLs, metadata, or content are fetched.
 */
export function assemblePreviousVantageContext(
    input: PreviousVantageAssemblyInput
): PreviousVantageContext | null {
    const { report, currentPeriod: period } = input;
    if (
        !report ||
        report.weekStart !== priorWeek(period.weekStart) ||
        report.id.length > 120 ||
        !within(report.createdAt, period.asOf) ||
        !within(report.generatedAt, period.asOf) ||
        !within(input.reportUpdatedAt, period.asOf)
    )
        return null;
    const ordered = [...report.topics].sort(
        (a, b) => a.position - b.position || compare(a.id, b.id)
    );
    const sourceStates = new Map((input.sourceStates ?? []).map(s => [s.ref, s]));
    const result: PreviousVantageContext = {
        contractVersion: "previous-vantage/v1",
        trust: "untrusted-history",
        reportId: report.id,
        weekStart: report.weekStart,
        generatedAt: report.generatedAt,
        reportVersion: report.version,
        snapshotVersion:
            input.snapshotVersion ??
            previousVantageFingerprint({
                report: { ...report, topics: ordered },
                actions: [...(input.actions ?? [])].sort((a, b) => compare(a.id, b.id)),
                sources: [...sourceStates.values()].sort((a, b) => compare(a.ref, b.ref)),
                reportUpdatedAt: input.reportUpdatedAt,
                topicState: input.topicState,
                actionState: input.actionState,
            }),
        summary: nullable(report.summary, 600),
        topics: [],
        unavailableSources: [],
        omissions: {
            topics: Math.max(0, ordered.length - MAX_PREVIOUS_VANTAGE_TOPICS),
            refs: 0,
            summary: false,
        },
        documentVerification: "unavailable",
    };
    const unavailable = new Map<string, PreviousVantageSource>();
    for (const topic of ordered.slice(0, MAX_PREVIOUS_VANTAGE_TOPICS)) {
        const refs = previousTopicRefs(topic);
        const checks = refs.slice(0, MAX_PREVIOUS_VANTAGE_REFS).map(ref => {
            const known = sourceStates.get(ref);
            if (known) {
                if (!/^(ev|obs|cm):[^\s]{1,64}$/.test(ref))
                    return {
                        ref: "unsupported",
                        status: "unsupported-ref",
                        documentVerification: "unavailable",
                    } satisfies PreviousVantageSource;
                if (known.status === "available" && known.documentVerification === "unavailable")
                    return {
                        ...known,
                        status: "document-verification-unavailable",
                    } satisfies PreviousVantageSource;
                return { ...known };
            }
            const safeRef = /^(ev|obs|cm):[^\s]{1,64}$/.test(ref) ? ref : "unsupported";
            return {
                ref: safeRef,
                status: safeRef === "unsupported" ? "unsupported-ref" : "missing-or-unauthorized",
                documentVerification: safeRef === "unsupported" ? "unavailable" : "not-applicable",
            } satisfies PreviousVantageSource;
        });
        for (const check of checks)
            if (check.status !== "available") unavailable.set(check.ref, check);
        const topicMeta = input.topicState?.[topic.id];
        const actions = (input.actions ?? [])
            .filter(a => a.topicId === topic.id || a.id === topic.commitmentId)
            .sort((a, b) => compare(a.id, b.id));
        const inaccessible =
            refs.length > MAX_PREVIOUS_VANTAGE_REFS ||
            checks.some(s => s.status !== "available") ||
            !within(topicMeta?.createdAt, period.asOf) ||
            !within(topicMeta?.updatedAt, period.asOf) ||
            !within(topic.decidedAt, period.asOf) ||
            actions.some(
                action =>
                    !within(action.createdAt, period.asOf) ||
                    !within(action.resolvedAt, period.asOf) ||
                    !within(input.actionState?.[action.id]?.updatedAt, period.asOf)
            );
        result.omissions.refs += Math.max(0, refs.length - MAX_PREVIOUS_VANTAGE_REFS);
        if (inaccessible) {
            result.omissions.topics++;
            continue;
        }
        result.topics.push({
            topicId: topic.id,
            contentVersion: topic.contentVersion,
            origin: topic.origin,
            status: topic.status,
            title: clipped(topic.title, 120),
            historicalClaims: topic.facts.slice(0, 2).map(fact => clipped(fact.text, 160)),
            interpretation: clipped(topic.whyItMatters, 160),
            question: clipped(topic.decisionQuestion, 140),
            suggestedNextStep: clipped(topic.proposedNextStep, 180),
            suggestedDue: topic.proposedDue,
            recordedDecision: topic.decision
                ? { text: clipped(topic.decision, 180), decidedAt: topic.decidedAt }
                : null,
            reportedActions: actions.slice(0, 2).map(action => ({
                id: action.id,
                stateVersion: previousActionStateFingerprint(action),
                title: clipped(action.title, 100),
                owner: clipped(action.owner, 80),
                dueOn: action.dueOn,
                test: nullable(action.test, 120),
                status: action.status,
                outcome: nullable(action.outcome, 140),
                resolvedAt: action.resolvedAt,
                createdAt: action.createdAt,
            })),
            originalRefs: checks,
        });
        if (actions.length > 2) result.omissions.refs += actions.length - 2;
    }
    result.unavailableSources = [...unavailable.values()]
        .sort((a, b) => compare(a.ref, b.ref))
        .slice(0, 8);
    result.omissions.refs += Math.max(0, unavailable.size - result.unavailableSources.length);
    const withholdSummary = () => {
        if (report.summary) result.omissions.summary = true;
        result.summary = null;
    };
    if (result.omissions.topics || result.omissions.refs || unavailable.size) withholdSummary();
    const bytes = () => Buffer.byteLength(JSON.stringify(result), "utf8");
    while (bytes() > MAX_PREVIOUS_VANTAGE_BYTES && result.topics.length) {
        result.topics.pop();
        result.omissions.topics++;
        withholdSummary();
    }
    if (bytes() > MAX_PREVIOUS_VANTAGE_BYTES) withholdSummary();
    while (bytes() > MAX_PREVIOUS_VANTAGE_BYTES && result.unavailableSources.length) {
        result.unavailableSources.pop();
        result.omissions.refs++;
    }
    return bytes() <= MAX_PREVIOUS_VANTAGE_BYTES ? result : null;
}
