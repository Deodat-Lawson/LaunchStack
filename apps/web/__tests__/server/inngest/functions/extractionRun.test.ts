/**
 * The worker path for extraction (EXTRACTION_EXECUTOR=worker): one memoized
 * step per unit, each inside the workspace's model scope with orphaned rows
 * put back first, until the table stops advancing; a job that fails for good
 * marks the table failed so the screen never spins forever.
 */
type Outcome = { state: string; processed?: number };
type Step = { run: (name: string, op: () => Promise<Outcome>) => Promise<Outcome> };
type Handler = (ctx: {
    event: { data: { tableId: number; companyId: string; userId: string } };
    step: Step;
}) => Promise<unknown>;
type Options = {
    id: string;
    retries: number;
    concurrency: unknown;
    onFailure: (ctx: {
        error: Error;
        event: { data: { event: { data: { tableId: number } } } };
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
jest.mock("@launchstack/pipelines/extraction", () => ({ advanceTable: jest.fn() }));
jest.mock("@launchstack/pipelines/extraction/db", () => {
    const finish = jest.fn();
    return { createExtractionStore: () => ({ finish }), __finish: finish };
});
jest.mock("~/server/extraction/executor", () => {
    const releaseRunningRows = jest.fn(async () => 0);
    return {
        ...jest.requireActual<object>("~/server/extraction/executor"),
        createExtractionPorts: jest.fn(() => ({ store: { releaseRunningRows } })),
        __release: releaseRunningRows,
    };
});
jest.mock("~/server/extraction/documents", () => ({}));
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: jest.fn((_companyId: unknown, _use: unknown, fn: () => unknown) =>
        fn()
    ),
}));

import { extractionRunJob } from "~/server/inngest/functions/extractionRun";

const job = extractionRunJob as unknown as { options: Options; handler: Handler };
const { withWorkspaceChatModels } = jest.requireMock<{ withWorkspaceChatModels: jest.Mock }>(
    "~/server/workspace-models/scope"
);
const { advanceTable } = jest.requireMock<{ advanceTable: jest.Mock }>(
    "@launchstack/pipelines/extraction"
);
const { __finish: finish } = jest.requireMock<{ __finish: jest.Mock }>(
    "@launchstack/pipelines/extraction/db"
);
const { __release: release } = jest.requireMock<{ __release: jest.Mock }>(
    "~/server/extraction/executor"
);

function recordingStep(): Step & { names: string[] } {
    const names: string[] = [];
    return { names, run: async (name, op) => (names.push(name), op()) };
}

const event = { data: { tableId: 7, companyId: "5", userId: "creator" } };

beforeEach(() => jest.clearAllMocks());

describe("extractionRunJob", () => {
    it("runs one workspace at a time, six across the deployment", () => {
        expect(job.options.id).toBe("extraction-run");
        expect(job.options.concurrency).toEqual([
            { key: "event.data.companyId", limit: 1 },
            { limit: 6 },
        ]);
    });

    it("runs a step per unit in the workspace's scope until the table finishes", async () => {
        advanceTable
            .mockResolvedValueOnce({ state: "advanced", processed: 8 })
            .mockResolvedValueOnce({ state: "advanced", processed: 1 })
            .mockResolvedValueOnce({ state: "finished", status: "done" });
        const step = recordingStep();

        const result = await job.handler({ event, step });

        expect(step.names).toEqual(["unit-0", "unit-1", "unit-2"]);
        expect(result).toEqual({ tableId: 7, state: "finished" });
        expect(release).toHaveBeenCalledTimes(3);
        expect(withWorkspaceChatModels).toHaveBeenCalledTimes(3);
        expect(withWorkspaceChatModels).toHaveBeenCalledWith(
            BigInt(5),
            { feature: "extraction", userId: "creator", enforce: false },
            expect.any(Function)
        );
    });

    it("stops instead of spinning when units find nothing to do", async () => {
        advanceTable.mockResolvedValue({ state: "advanced", processed: 0 });
        const step = recordingStep();
        await job.handler({ event, step });
        expect(step.names).toEqual(["unit-0", "unit-1"]);
    });

    it("marks the table failed when the job fails for good", async () => {
        await job.options.onFailure({
            error: new Error("step exhausted"),
            event: { data: { event: { data: { tableId: 7 } } } },
        });
        expect(finish).toHaveBeenCalledWith(7, "failed", "step exhausted", expect.any(Date));
    });
});
