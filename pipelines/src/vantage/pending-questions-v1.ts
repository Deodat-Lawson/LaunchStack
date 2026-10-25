import type { AgendaV1Dto } from "./contract-v1";
import type { PreviousVantageSource } from "./previous-context-v1";
import { previousVantageFingerprint } from "./previous-context-v1";
import type { TopicDto, VantageEvidenceRef } from "./types";

export const PENDING_QUESTIONS_CONTRACT = "pending-historical-questions/v1" as const;
/** Bounds each native validation query, never the persisted ledger or review view. */
export const PENDING_VALIDATION_BATCH_SIZE = 100;

export interface PendingHistoricalQuestionV1 {
    questionId: string;
    originReportId: string;
    originTopicId: string;
    originWeekStart: string;
    originGeneratedAt: string | null;
    title: string;
    question: string;
    origin: TopicDto["origin"];
    humanReview: {
        kind: "recorded-decision" | "kept-topic" | "authored-or-edited";
        contentVersion: number;
        status: TopicDto["status"];
        decision: string | null;
        decidedAt: string | null;
    };
    suggestedDue: string | null;
    sourceRefs: VantageEvidenceRef[];
}
export interface PendingHistoricalQuestionReviewV1 {
    status: "dismissed" | "addressed";
    reviewedAt: string;
    reviewedBy: string | null;
    reason: string | null;
}
export interface PendingHistoricalStateV1 {
    version: 1;
    questions: PendingHistoricalQuestionV1[];
    /** Human-only tombstones survive absent topics and same-week regeneration. */
    reviews: Record<string, PendingHistoricalQuestionReviewV1>;
}
export interface PendingHistoricalQuestionsContextV1 {
    contractVersion: typeof PENDING_QUESTIONS_CONTRACT;
    trust: "historical-human-records";
    questions: PendingHistoricalQuestionV1[];
    unavailableCount: number;
    snapshotVersion: string;
    /** Internal suppression keys only; never expose these withdrawn identities in prompts/UI. */
    reviewedQuestionIds?: string[];
}
export interface PendingHistoricalQuestionsViewV1 {
    contractVersion: typeof PENDING_QUESTIONS_CONTRACT;
    agendaId: string;
    version: number;
    questions: PendingHistoricalQuestionV1[];
    unavailableCount: number;
}
export type PendingOriginAvailability =
    | "available"
    | "missing-or-unauthorized"
    | "after-cutoff"
    | "dismissed";

export function emptyPendingHistoricalState(): PendingHistoricalStateV1 {
    return { version: 1, questions: [], reviews: {} };
}
/** Stored values are internal JSON; reject malformed legacy/unknown versions. */
export function pendingHistoricalState(value: unknown): PendingHistoricalStateV1 {
    if (!value || typeof value !== "object") return emptyPendingHistoricalState();
    const v = value as Partial<PendingHistoricalStateV1>;
    if (
        v.version !== 1 ||
        !Array.isArray(v.questions) ||
        !v.reviews ||
        typeof v.reviews !== "object"
    )
        return emptyPendingHistoricalState();
    return structuredClone(v as PendingHistoricalStateV1);
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: PendingHistoricalQuestionV1, b: PendingHistoricalQuestionV1) =>
    compare(a.originWeekStart, b.originWeekStart) ||
    compare(a.originReportId, b.originReportId) ||
    compare(a.originTopicId, b.originTopicId);

/** Seed only accepted human records. An AI suggestion never creates an obligation. */
export function pendingQuestionsFromReport(
    report: AgendaV1Dto | null
): PendingHistoricalQuestionV1[] {
    return (report?.topics ?? [])
        .filter(
            topic =>
                topic.status !== "dismissed" &&
                topic.decisionQuestion.trim() &&
                (topic.origin === "founder" || topic.status === "kept" || topic.decision !== null)
        )
        .map<PendingHistoricalQuestionV1>(topic => ({
            questionId: topic.id,
            originReportId: report!.id,
            originTopicId: topic.id,
            originWeekStart: report!.weekStart,
            originGeneratedAt: report!.generatedAt,
            title: topic.title,
            question: topic.decisionQuestion,
            origin: topic.origin,
            humanReview: {
                kind:
                    topic.decision !== null
                        ? "recorded-decision"
                        : topic.origin === "founder"
                          ? "authored-or-edited"
                          : "kept-topic",
                contentVersion: topic.contentVersion,
                status: topic.status,
                decision: topic.decision,
                decidedAt: topic.decidedAt,
            },
            suggestedDue: topic.proposedDue,
            sourceRefs: [
                ...new Map(
                    [...topic.facts, ...topic.conflicts]
                        .flatMap(f => f.refs)
                        .map(ref => [ref.ref, { ...ref }])
                ).values(),
            ].sort((a, b) => compare(a.ref, b.ref)),
        }))
        .sort(order);
}

/** Only the immediately previous saved report discovers questions; older entries flow via its ledger. */
export function mergePendingHistoricalState(args: {
    previous: PendingHistoricalStateV1;
    current: PendingHistoricalStateV1;
    previousReport: AgendaV1Dto | null;
}): PendingHistoricalStateV1 {
    const questions = new Map<string, PendingHistoricalQuestionV1>();
    // Existing original content wins; never replace it with a generated paraphrase.
    for (const question of [
        ...args.current.questions,
        ...args.previous.questions,
        ...pendingQuestionsFromReport(args.previousReport),
    ])
        if (!questions.has(question.questionId))
            questions.set(question.questionId, structuredClone(question));
    const reviews = { ...args.previous.reviews };
    for (const [id, review] of Object.entries(args.current.reviews)) {
        if (!reviews[id] || Date.parse(review.reviewedAt) >= Date.parse(reviews[id].reviewedAt))
            reviews[id] = structuredClone(review);
    }
    return {
        version: 1,
        questions: [...questions.values()].sort(order),
        reviews,
    };
}

/** No AI, metric, action status, missing feedback or elapsed date closes a question. */
export function projectPendingHistoricalQuestions(args: {
    state: PendingHistoricalStateV1;
    originAvailability: Record<string, PendingOriginAvailability>;
    sourceStates: PreviousVantageSource[];
    asOf: string;
    currentWeekStart: string;
    fingerprintState?: unknown;
}): PendingHistoricalQuestionsContextV1 {
    const sources = new Map(args.sourceStates.map(source => [source.ref, source]));
    const active = args.state.questions.filter(question => {
        const review = args.state.reviews[question.questionId];
        return !review || Date.parse(review.reviewedAt) > Date.parse(args.asOf);
    });
    const questions = active.filter(question => {
        const refs = question.sourceRefs;
        return (
            !args.state.reviews[question.questionId] &&
            question.questionId === question.originTopicId &&
            question.originWeekStart < args.currentWeekStart &&
            args.originAvailability[question.questionId] === "available" &&
            (!question.originGeneratedAt ||
                Date.parse(question.originGeneratedAt) <= Date.parse(args.asOf)) &&
            (!question.humanReview.decidedAt ||
                Date.parse(question.humanReview.decidedAt) <= Date.parse(args.asOf)) &&
            refs.every(ref => {
                const source = sources.get(ref.ref);
                return (
                    /^(ev|obs|cm):[^\s]{1,64}$/.test(ref.ref) &&
                    source?.status === "available" &&
                    source.documentVerification === "not-applicable"
                );
            })
        );
    });
    return {
        contractVersion: PENDING_QUESTIONS_CONTRACT,
        trust: "historical-human-records",
        questions: structuredClone(questions),
        unavailableCount: active.length - questions.length,
        reviewedQuestionIds: Object.entries(args.state.reviews)
            .filter(([, review]) => Date.parse(review.reviewedAt) <= Date.parse(args.asOf))
            .map(([questionId]) => questionId)
            .sort(compare),
        snapshotVersion: previousVantageFingerprint({ ...args, state: args.state }),
    };
}
