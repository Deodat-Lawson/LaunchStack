import { vantageApi } from "~/app/employer/tools/vantage/api";

const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue(
        new Response(
            JSON.stringify({
                contractVersion: "pending-historical-questions/v1",
                agendaId: "current/report",
                version: 4,
                questions: [],
                unavailableCount: 0,
            }),
            { status: 200 }
        )
    );
});
afterEach(() => {
    global.fetch = originalFetch;
});

it("loads the extension by encoded current report ID without changing overview", async () => {
    await vantageApi.pendingQuestions("current/report");
    expect(mockFetch.mock.calls[0]![0]).toBe(
        "/api/vantage/agendas/current%2Freport/pending-questions"
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
});

it("sends the original question identity, explicit terminal review and CAS version", async () => {
    await vantageApi.reviewPendingQuestion("current/report", "original-topic", "addressed", 3);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe("/api/vantage/agendas/current%2Freport/pending-questions");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toEqual({
        questionId: "original-topic",
        status: "addressed",
        expectedVersion: 3,
    });
});
