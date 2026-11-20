/**
 * The worker path for v2 scenario runs: one memoized step per unit, each in
 * the workspace's model scope; a unit waiting on the graph sleeps until its
 * backoff passes; the reconciler cron runs one pass per tick.
 */
type StepResult = { state: string; unitKey?: string; retryAt?: string; reason?: string };
type Step = {
    run: (name: string, op: () => Promise<unknown>) => Promise<unknown>;
    sleepUntil: (name: string, until: Date) => Promise<void>;
};
type Handler = (ctx: {
    event: { data: { runId: number; companyId: string; generation: number } };
    step: Step;
}) => Promise<unknown>;

jest.mock("~/server/inngest/client", () => ({
    inngest: {
        createFunction: jest.fn((options: unknown, trigger: unknown, handler: Handler) => ({
            options,
            trigger,
            handler,
        })),
    },
}));
jest.mock("@launchstack/pipelines/scenarios/db", () => ({ getRunById: jest.fn() }));
jest.mock("@launchstack/pipelines/scenarios/v2/engine", () => ({ stepV2: jest.fn() }));
jest.mock("~/server/scenarios/v2/deps", () => ({ createEngineDeps: jest.fn(() => ({})) }));
jest.mock("~/server/scenarios/v2/dispatch", () => ({
    SCENARIO_RUN_V2_EVENT: "scenarios/run.v2.requested",
    reconcileScenarioRunsV2: jest.fn(async () => ({ delivered: 1 })),
}));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: jest.fn((_companyId: unknown, _use: unknown, fn: () => unknown) =>
        fn()
    ),
}));

import {
    scenarioRunV2Job,
    scenarioRunV2Reconciler,
} from "~/server/inngest/functions/scenarioRunV2";

const job = scenarioRunV2Job as unknown as {
    options: { id: string; concurrency: unknown };
    trigger: { event: string };
    handler: Handler;
};
const cron = scenarioRunV2Reconciler as unknown as {
    trigger: { cron: string };
    handler: Handler;
};
const { stepV2 } = jest.requireMock<{ stepV2: jest.Mock }>(
    "@launchstack/pipelines/scenarios/v2/engine"
);
const { getRunById } = jest.requireMock<{ getRunById: jest.Mock }>(
    "@launchstack/pipelines/scenarios/db"
);
const { withWorkspaceChatModels } = jest.requireMock<{ withWorkspaceChatModels: jest.Mock }>(
    "~/server/workspace-models/scope"
);
const { reconcileScenarioRunsV2 } = jest.requireMock<{ reconcileScenarioRunsV2: jest.Mock }>(
    "~/server/scenarios/v2/dispatch"
);

function recordingStep(): Step & { names: string[]; sleeps: Array<[string, Date]> } {
    const names: string[] = [];
    const sleeps: Array<[string, Date]> = [];
    return {
        names,
        sleeps,
        run: async (name, op) => (names.push(name), op()),
        sleepUntil: async (name, until) => {
            sleeps.push([name, until]);
        },
    };
}

const event = { data: { runId: 9, companyId: "5", generation: 1 } };

beforeEach(() => {
    jest.clearAllMocks();
    getRunById.mockResolvedValue({ id: 9, createdByUserId: "starter" });
});

it("listens for v2 run events with v1's concurrency limits", () => {
    expect(job.options.id).toBe("scenario-run-v2");
    expect(job.trigger.event).toBe("scenarios/run.v2.requested");
    expect(job.options.concurrency).toEqual([
        { key: "event.data.companyId", limit: 2 },
        { limit: 6 },
    ]);
});

it("runs one step per unit, each in the creator's model scope, until the run stops", async () => {
    stepV2
        .mockResolvedValueOnce({ state: "advanced", unitKey: "sources" })
        .mockResolvedValueOnce({ state: "advanced", unitKey: "brief" })
        .mockResolvedValueOnce({ state: "done" });
    const step = recordingStep();
    const result = await job.handler({ event, step });
    expect(step.names).toEqual(["unit-0", "unit-1", "unit-2"]);
    expect(stepV2).toHaveBeenCalledWith({}, 9);
    expect(withWorkspaceChatModels).toHaveBeenCalledTimes(3);
    expect(withWorkspaceChatModels).toHaveBeenCalledWith(
        5n,
        { feature: "scenarios", userId: "starter", enforce: false },
        expect.any(Function)
    );
    expect(result).toEqual({ runId: 9, state: "done" });
});

it("sleeps until a waiting unit's backoff passes, then carries on", async () => {
    const retryAt = new Date("2026-11-13T10:01:00Z");
    stepV2
        .mockResolvedValueOnce({ state: "waiting", unitKey: "graph:ingest:01", retryAt })
        .mockResolvedValueOnce({ state: "advanced", unitKey: "graph:ingest:01" })
        .mockResolvedValueOnce({ state: "skipped", reason: "leased" });
    const step = recordingStep();
    const result = (await job.handler({ event, step })) as StepResult;
    expect(step.names).toEqual(["unit-0", "unit-1", "unit-2"]);
    expect(step.sleeps).toEqual([["wait-0", retryAt]]);
    // Another driver holds the run: this delivery ends without touching it.
    expect(result).toEqual({ runId: 9, state: "skipped", reason: "leased" });
});

it("skips a run that no longer exists without opening a model scope", async () => {
    getRunById.mockResolvedValueOnce(undefined);
    const step = recordingStep();
    expect(await job.handler({ event, step })).toEqual({
        runId: 9,
        state: "skipped",
        reason: "missing",
    });
    expect(withWorkspaceChatModels).not.toHaveBeenCalled();
});

it("reconciles every minute", async () => {
    expect(cron.trigger.cron).toBe("* * * * *");
    const step = recordingStep();
    expect(await cron.handler({ event, step })).toEqual({ delivered: 1 });
    expect(reconcileScenarioRunsV2).toHaveBeenCalledTimes(1);
});
