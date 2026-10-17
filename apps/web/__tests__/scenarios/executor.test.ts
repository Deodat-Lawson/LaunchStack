/**
 * The in-process executor: a unit is retried before the run is marked
 * failed, and a poll resumes a run only when it is unfinished, runs inline,
 * and nobody holds its lease (a restart lost the process that did).
 */
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/lib/credits", () => ({ debitTokens: jest.fn() }));
jest.mock("~/server/scenarios/evidence", () => ({ gatherScenarioEvidence: jest.fn() }));
jest.mock("@launchstack/pipelines/scenarios/db", () => ({
    claimLease: jest.fn(),
    createScenarioStore: jest.fn(),
    getRunById: jest.fn(),
    releaseLease: jest.fn(),
    renewLease: jest.fn(),
}));
jest.mock("@launchstack/pipelines/scenarios", () => ({
    ...jest.requireActual<object>("@launchstack/pipelines/scenarios"),
    advanceRun: jest.fn(),
    createLlmSimulationModel: jest.fn(),
}));

import type { ScenarioRunPorts } from "@launchstack/pipelines/scenarios";

import {
    advanceWithRetries,
    readScenariosExecutor,
    resumeIfStalled,
} from "~/server/scenarios/executor";

const { after } = jest.requireMock<{ after: jest.Mock }>("next/server");
const { advanceRun } = jest.requireMock<{ advanceRun: jest.Mock }>(
    "@launchstack/pipelines/scenarios"
);

const finish = jest.fn();
const ports = {
    store: { finish },
    now: () => new Date("2026-10-17T00:00:00Z"),
} as unknown as ScenarioRunPorts;

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SCENARIOS_EXECUTOR;
});

it("retries a failing unit and marks the run failed after the last attempt", async () => {
    advanceRun.mockRejectedValue(new Error("model timed out"));
    expect(await advanceWithRetries(ports, 4, 3, 0)).toBe(false);
    expect(advanceRun).toHaveBeenCalledTimes(3);
    expect(finish).toHaveBeenCalledWith(4, "failed", "model timed out", expect.any(Date));
});

it("keeps going after a transient failure", async () => {
    advanceRun
        .mockRejectedValueOnce(new Error("blip"))
        .mockResolvedValueOnce({ state: "advanced", step: 2 });
    expect(await advanceWithRetries(ports, 4, 3, 0)).toBe(true);
    expect(finish).not.toHaveBeenCalled();
});

it("stops at a finished or raced unit", async () => {
    advanceRun.mockResolvedValue({ state: "done" });
    expect(await advanceWithRetries(ports, 4, 3, 0)).toBe(false);
    advanceRun.mockResolvedValue({ state: "skipped", reason: "raced" });
    expect(await advanceWithRetries(ports, 4, 3, 0)).toBe(false);
});

it("resumes only unfinished inline runs whose lease has lapsed", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(resumeIfStalled({ id: 1, status: "done", leaseUntil: null }, now)).toBe(false);
    expect(
        resumeIfStalled(
            { id: 1, status: "running", leaseUntil: new Date("2026-10-17T12:01:00Z") },
            now
        )
    ).toBe(false);
    expect(
        resumeIfStalled(
            { id: 1, status: "running", leaseUntil: new Date("2026-10-17T11:59:00Z") },
            now
        )
    ).toBe(true);
    expect(resumeIfStalled({ id: 1, status: "queued", leaseUntil: null }, now)).toBe(true);
    expect(after).toHaveBeenCalledTimes(2);
    process.env.SCENARIOS_EXECUTOR = "worker";
    expect(readScenariosExecutor()).toBe("worker");
    expect(resumeIfStalled({ id: 1, status: "queued", leaseUntil: null }, now)).toBe(false);
});
