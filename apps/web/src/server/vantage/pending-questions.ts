import {
    getPendingHistoricalQuestionsV1,
    reviewPendingHistoricalQuestionV1,
} from "@launchstack/pipelines/vantage";

/** This extension leaves the frozen overview and agenda responses unchanged. */
export function loadPendingQuestions(args: {
    companyId: bigint;
    userId: string;
    agendaId: string;
}) {
    return getPendingHistoricalQuestionsV1({
        companyId: args.companyId,
        actorId: args.userId,
        agendaId: args.agendaId,
    });
}

export function reviewPendingQuestion(args: {
    companyId: bigint;
    userId: string;
    agendaId: string;
    questionId: string;
    expectedVersion: number;
    status: "dismissed" | "addressed";
    reason?: string;
}) {
    return reviewPendingHistoricalQuestionV1(args);
}
