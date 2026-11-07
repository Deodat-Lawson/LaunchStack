/**
 * The worker path for the post writer (MARKETING_EXECUTOR=worker): one
 * attempt per Inngest attempt, a failed attempt with attempts left is thrown
 * so Inngest retries it (from the run's checkpoints), and a run that fails
 * for good is marked failed so the screen never spins forever.
 */
type Handler = (ctx: {
    event: { data: { runId: string; companyId: string } };
    step: { run: (name: string, op: () => Promise<unknown>) => Promise<unknown> };
    attempt: number;
}) => Promise<unknown>;
type Options = {
    id: string;
    retries: number;
    onFailure: (ctx: {
        error: Error;
        event: { data: { event: { data: { runId: string } } } };
    }) => Promise<void>;
};

jest.mock("~/server/inngest/client", () => ({
    inngest: {
        createFunction: jest.fn((options: Options, _trigger: unknown, handler: Handler) => ({
            options,
            handler,
        })),
    },
}));
const mockAttempt = jest.fn();
jest.mock("~/server/marketing/executor", () => ({
    MAX_ATTEMPTS: 3,
    attemptMarketingRun: (...a: unknown[]) => mockAttempt(...a),
    failureMessage: () => "Failed to run marketing pipeline",
}));
const mockFinish = jest.fn();
jest.mock("@launchstack/pipelines/marketing/runs", () => ({
    finishMarketingRun: (...a: unknown[]) => mockFinish(...a),
}));

import { marketingRunJob, MarketingRunRetry } from "~/server/inngest/functions/marketingRun";

const job = marketingRunJob as unknown as { options: Options; handler: Handler };
const event = { data: { runId: "run-1", companyId: "42" } };
const names: string[] = [];
const step = { run: async (name: string, op: () => Promise<unknown>) => (names.push(name), op()) };

beforeEach(() => {
    jest.clearAllMocks();
    names.length = 0;
});

it("runs one attempt inside a step, for the run's own workspace", async () => {
    mockAttempt.mockResolvedValue("completed");
    await expect(job.handler({ event, step, attempt: 0 })).resolves.toEqual({
        runId: "run-1",
        outcome: "completed",
    });
    expect(names).toEqual(["attempt-0"]);
    expect(mockAttempt).toHaveBeenCalledWith("run-1", 42n);
});

it("throws on a retryable failure so Inngest tries again", async () => {
    mockAttempt.mockResolvedValue("retry");
    await expect(job.handler({ event, step, attempt: 1 })).rejects.toBeInstanceOf(
        MarketingRunRetry
    );
    expect(names).toEqual(["attempt-1"]);
});

it("allows as many executions as the run allows attempts", () => {
    expect(job.options.retries).toBe(2);
});

it("marks the run failed once Inngest gives up (payload under event.data.event.data)", async () => {
    await job.options.onFailure({
        error: new Error("boom"),
        event: { data: { event: { data: { runId: "run-1" } } } },
    });
    expect(mockFinish).toHaveBeenCalledWith("run-1", {
        status: "failed",
        errorMessage: "Failed to run marketing pipeline",
    });
});
