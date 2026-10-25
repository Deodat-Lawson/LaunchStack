/** Prompt projection only. Never mutates or truncates the persisted question ledger. */
import type { GenerationInput } from "./contract-v1";
import { PENDING_QUESTIONS_CONTRACT } from "./pending-questions-v1";
import {
    MAX_PREVIOUS_VANTAGE_BYTES,
    MAX_PREVIOUS_VANTAGE_TOPICS,
    type PreviousVantageContext,
} from "./previous-context-v1";

export function usablePendingQuestions(input: GenerationInput) {
    const context = input.pendingHistoricalQuestions;
    return context?.contractVersion === PENDING_QUESTIONS_CONTRACT &&
        context.trust === "historical-human-records"
        ? context
        : null;
}

/** Explicit human review suppresses old AI prose as well as the pending card. */
export function historicalContextForGeneration(
    input: GenerationInput
): PreviousVantageContext | null {
    const previous = input.previousVantageContext;
    if (!previous) return null;
    const pending = usablePendingQuestions(input);
    if (pending?.unavailableCount) return null;
    const reviewed = new Set(pending?.reviewedQuestionIds ?? []);
    const topics = previous.topics.filter(
        topic => topic.status !== "dismissed" && !reviewed.has(topic.topicId)
    );
    // A summary has no per-sentence lineage: conservatively withhold it when any
    // terminal review exists, including a question omitted by the topic budget.
    if (!reviewed.size && topics.length === previous.topics.length) return previous;
    return {
        ...previous,
        summary: null,
        topics,
        omissions: {
            ...previous.omissions,
            summary: true,
            topics: previous.omissions.topics + previous.topics.length - topics.length,
        },
    };
}

export function projectHistoricalPrompt(
    input: GenerationInput,
    previous: PreviousVantageContext | null
) {
    const pending = usablePendingQuestions(input);
    const eligible = (pending?.questions ?? [])
        .filter(
            question =>
                question.questionId === question.originTopicId &&
                question.originWeekStart < input.reportPeriod.weekStart
        )
        .sort(
            (a, b) =>
                a.originWeekStart.localeCompare(b.originWeekStart) ||
                a.questionId.localeCompare(b.questionId)
        );
    const project = (question: (typeof eligible)[number]) => ({
        questionId: question.questionId,
        originTopicId: question.originTopicId,
        originReportId: question.originReportId,
        originWeekStart: question.originWeekStart,
        question: question.question,
        recordedDecision: question.humanReview.decision,
        originalDue: question.suggestedDue,
        provenance: { origin: question.origin, humanReview: question.humanReview.kind },
        originalSourceRefs: question.sourceRefs.slice(0, 8).map(ref => ref.ref),
        omittedSourceRefs: Math.max(0, question.sourceRefs.length - 8),
    });
    const pendingHistoricalQuestions = pending
        ? {
              contractVersion: pending.contractVersion,
              trust: pending.trust,
              questions: [] as ReturnType<typeof project>[],
              unavailableCount: pending.unavailableCount,
              totalCount: pending.questions.length,
              omittedCount: pending.questions.length,
          }
        : null;
    let previousVantageContext: PreviousVantageContext | null = null;
    const bytes = () =>
        Buffer.byteLength(
            JSON.stringify({
                previousVantageContext,
                pendingHistoricalQuestions,
            }),
            "utf8"
        );
    // Keep complete question/decision text, or omit the whole entry from this prompt.
    // No linguistic ranking, merging, paraphrasing, or inferred closure occurs here.
    for (const question of eligible) {
        if (
            !pendingHistoricalQuestions ||
            pendingHistoricalQuestions.questions.length >= MAX_PREVIOUS_VANTAGE_TOPICS
        )
            break;
        pendingHistoricalQuestions.questions.push(project(question));
        pendingHistoricalQuestions.omittedCount--;
        if (bytes() > MAX_PREVIOUS_VANTAGE_BYTES) {
            pendingHistoricalQuestions.questions.pop();
            pendingHistoricalQuestions.omittedCount++;
        }
    }
    // Unavailable carried provenance can also have leaked into an older summary.
    // Withhold old AI prose conservatively while retaining the full private ledger.
    previousVantageContext =
        previous && !pending?.unavailableCount ? structuredClone(previous) : null;
    if (previousVantageContext) {
        const pendingIds = new Set(pending?.questions.map(question => question.questionId) ?? []);
        previousVantageContext.topics = previousVantageContext.topics.filter(topic => {
            if (!pendingIds.has(topic.topicId)) return true;
            previousVantageContext!.omissions.topics++;
            return false;
        });
        while (
            previousVantageContext.topics.length +
                (pendingHistoricalQuestions?.questions.length ?? 0) >
            MAX_PREVIOUS_VANTAGE_TOPICS
        ) {
            previousVantageContext.topics.pop();
            previousVantageContext.omissions.topics++;
        }
        if (bytes() > MAX_PREVIOUS_VANTAGE_BYTES) {
            previousVantageContext.summary = null;
            previousVantageContext.omissions.summary = true;
        }
        while (bytes() > MAX_PREVIOUS_VANTAGE_BYTES && previousVantageContext.topics.length) {
            previousVantageContext.topics.pop();
            previousVantageContext.omissions.topics++;
        }
        if (bytes() > MAX_PREVIOUS_VANTAGE_BYTES) previousVantageContext = null;
    }
    return { previousVantageContext, pendingHistoricalQuestions };
}
