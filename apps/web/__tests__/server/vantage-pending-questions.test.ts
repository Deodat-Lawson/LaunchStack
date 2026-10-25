const mockGet = jest.fn();
const mockReview = jest.fn();
jest.mock("@launchstack/pipelines/vantage", () => ({
    getPendingHistoricalQuestionsV1: (...args: unknown[]) => mockGet(...args),
    reviewPendingHistoricalQuestionV1: (...args: unknown[]) => mockReview(...args),
}));

import { loadPendingQuestions, reviewPendingQuestion } from "~/server/vantage/pending-questions";

beforeEach(() => {
    jest.clearAllMocks();
});

it("binds historical reads to the requesting actor and explicit agenda", async () => {
    const response = { agendaId: "current", questions: [], version: 3, unavailableCount: 0 };
    mockGet.mockResolvedValue(response);
    expect(
        await loadPendingQuestions({ companyId: 42n, userId: "operator", agendaId: "current" })
    ).toBe(response);
    expect(mockGet).toHaveBeenCalledWith({
        companyId: 42n,
        actorId: "operator",
        agendaId: "current",
    });
});

it("forwards only the explicit human review without generating reports or actions", async () => {
    const args = {
        companyId: 42n,
        userId: "operator",
        agendaId: "current",
        questionId: "original-topic",
        expectedVersion: 3,
        status: "addressed" as const,
    };
    const response = { agendaId: "current", questions: [], version: 4, unavailableCount: 0 };
    mockReview.mockResolvedValue(response);
    expect(await reviewPendingQuestion(args)).toBe(response);
    expect(mockReview).toHaveBeenCalledWith(args);
    expect(mockGet).not.toHaveBeenCalled();
});
