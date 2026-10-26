/**
 * The worker path for scenarios (SCENARIOS_EXECUTOR=worker): one memoized
 * step per unit until the run stops advancing, and a run that fails for good
 * is marked failed so the UI never spins forever.
 */
type Outcome = { state: string; step?: number };
type Step = { run: (name: string, op: () => Promise<Outcome>) => Promise<Outcome> };
type Handler = (ctx: {
    event: { data: { runId: number; companyId: string } };
    step: Step;
}) => Promise<unknown>;
type Options = {
    id: string;
    retries: number;
    onFailure: (ctx: {
        error: Error;
        event: { data: { event: { data: { runId: number } } } };
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
jest.mock("@launchstack/pipelines/scenarios", () => ({ advanceRun: jest.fn() }));
jest.mock("@launchstack/pipelines/scenarios/db", () => {
    const finish = jest.fn();
    return {
        createScenarioStore: () => ({ finish }),
        __finish: finish,
    };
});
jest.mock("~/server/scenarios/executor", () => ({ createScenarioPorts: jest.fn(() => ({})) }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: jest.fn((_companyId: unknown, _feature: unknown, fn: () => unknown) =>
        fn()
    ),
}));

import { scenarioRunJob } from "~/server/inngest/functions/scenarioRun";

const job = scenarioRunJob as unknown as { options: Options; handler: Handler };
const { withWorkspaceChatModels } = jest.requireMock<{ withWorkspaceChatModels: jest.Mock }>(
    "~/server/workspace-models/scope"
);
const { advanceRun } = jest.requireMock<{ advanceRun: jest.Mock }>(
    "@launchstack/pipelines/scenarios"
);
const { __finish: finish } = jest.requireMock<{ __finish: jest.Mock }>(
    "@launchstack/pipelines/scenarios/db"
);

function recordingStep(): Step & { names: string[] } {
    const names: string[] = [];
    return { names, run: async (name, op) => (names.push(name), op()) };
}

beforeEach(() => jest.clearAllMocks());

it("runs one step per unit until the run stops advancing", async () => {
    advanceRun
        .mockResolvedValueOnce({ state: "advanced", step: 1 })
        .mockResolvedValueOnce({ state: "advanced", step: 2 })
        .mockResolvedValueOnce({ state: "advanced", step: 3 })
        .mockResolvedValueOnce({ state: "done" });
    const step = recordingStep();
    const result = await job.handler({
        event: { data: { runId: 7, companyId: "5", userId: "starter" } },
        step,
    });
    expect(step.names).toEqual(["unit-0", "unit-1", "unit-2", "unit-3"]);
    expect(advanceRun).toHaveBeenCalledWith({}, 7);
    // Each step enters the workspace's model scope itself (steps don't inherit it).
    expect(withWorkspaceChatModels).toHaveBeenCalledTimes(4);
    // Counted against whoever started the run, and never stopped by their allowance.
    expect(withWorkspaceChatModels).toHaveBeenCalledWith(
        5n,
        { feature: "scenarios", userId: "starter", enforce: false },
        expect.any(Function)
    );
    expect(result).toEqual({ runId: 7, state: "done" });
});

it("stops on a raced or cancelled unit", async () => {
    advanceRun.mockResolvedValueOnce({ state: "skipped", reason: "raced" });
    const step = recordingStep();
    await job.handler({ event: { data: { runId: 7, companyId: "5" } }, step });
    expect(step.names).toEqual(["unit-0"]);
});

it("marks the run failed when Inngest gives up on it", async () => {
    expect(job.options.retries).toBeGreaterThan(0);
    await job.options.onFailure({
        error: new Error("model unreachable"),
        event: { data: { event: { data: { runId: 7 } } } },
    });
    expect(finish).toHaveBeenCalledWith(7, "failed", "model unreachable", expect.any(Date));
});
