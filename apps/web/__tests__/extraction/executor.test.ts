/**
 * Where an extraction table runs: inline by default (a lease, orphaned rows
 * put back, each unit inside the workspace's model scope under "extraction"),
 * and a driver that stops rather than spins when units find nothing to do.
 */
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/server/extraction/documents", () => ({
    readExtractionDocument: jest.fn(),
    extractStructured: jest.fn(),
    readImageFields: jest.fn(),
}));
jest.mock("@launchstack/pipelines/extraction", () => ({ advanceTable: jest.fn() }));
jest.mock("@launchstack/pipelines/extraction/db", () => ({
    claimLease: jest.fn(),
    renewLease: jest.fn(async () => undefined),
    releaseLease: jest.fn(async () => undefined),
    getTableById: jest.fn(),
    createExtractionStore: jest.fn(() => ({})),
}));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: jest.fn((_companyId: unknown, _use: unknown, fn: () => unknown) =>
        fn()
    ),
}));

import type { ExtractionPorts } from "@launchstack/pipelines/extraction/types";

import {
    advanceWithRetries,
    createUnitGate,
    dispatchTable,
    driveTable,
    MAX_UNITS,
    readExtractionConcurrency,
    readExtractionExecutor,
    resumeIfStalled,
} from "~/server/extraction/executor";

type Mocks<K extends string> = Record<K, jest.Mock>;
const { advanceTable } = jest.requireMock<Mocks<"advanceTable">>(
    "@launchstack/pipelines/extraction"
);
const db = jest.requireMock<Mocks<"claimLease" | "releaseLease" | "getTableById">>(
    "@launchstack/pipelines/extraction/db"
);
const { withWorkspaceChatModels } = jest.requireMock<Mocks<"withWorkspaceChatModels">>(
    "~/server/workspace-models/scope"
);
const { after } = jest.requireMock<Mocks<"after">>("next/server");
const { inngest } = jest.requireMock<{ inngest: Mocks<"send"> }>("~/server/inngest/client");

function ports() {
    const store = { releaseRunningRows: jest.fn(async () => 0), finish: jest.fn() };
    return {
        store,
        ports: { store, now: () => new Date("2026-11-12T08:00:00Z") } as unknown as ExtractionPorts,
    };
}

const TABLE = { id: 7, companyId: BigInt(5), createdByUserId: "creator" };

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EXTRACTION_EXECUTOR;
    db.claimLease.mockResolvedValue(true);
    db.getTableById.mockResolvedValue(TABLE);
});

describe("settings", () => {
    it("runs inline unless EXTRACTION_EXECUTOR says worker", () => {
        expect(readExtractionExecutor({})).toBe("inline");
        expect(readExtractionExecutor({ EXTRACTION_EXECUTOR: " Worker " })).toBe("worker");
        expect(readExtractionExecutor({ EXTRACTION_EXECUTOR: "queue" })).toBe("inline");
    });

    it("reads 8 documents at a time unless EXTRACTION_CONCURRENCY says 1–16", () => {
        expect(readExtractionConcurrency({})).toBe(8);
        expect(readExtractionConcurrency({ EXTRACTION_CONCURRENCY: "1" })).toBe(1);
        expect(readExtractionConcurrency({ EXTRACTION_CONCURRENCY: "64" })).toBe(16);
        expect(readExtractionConcurrency({ EXTRACTION_CONCURRENCY: "0" })).toBe(1);
        expect(readExtractionConcurrency({ EXTRACTION_CONCURRENCY: "many" })).toBe(8);
    });

    it("allows a unit per document, the finishing unit and slack", () => {
        expect(MAX_UNITS).toBeGreaterThanOrEqual(501);
    });
});

describe("createUnitGate", () => {
    it("goes on while rows are processed and stops at the end", () => {
        const keepGoing = createUnitGate();
        expect(keepGoing({ state: "advanced", processed: 8 })).toBe(true);
        expect(keepGoing({ state: "finished", status: "done" })).toBe(false);
        expect(createUnitGate()({ state: "skipped" })).toBe(false);
        expect(createUnitGate()(null)).toBe(false);
    });

    it("stops after two units in a row that processed nothing", () => {
        const keepGoing = createUnitGate();
        expect(keepGoing({ state: "advanced", processed: 0 })).toBe(true);
        expect(keepGoing({ state: "advanced", processed: 3 })).toBe(true);
        expect(keepGoing({ state: "advanced", processed: 0 })).toBe(true);
        expect(keepGoing({ state: "advanced", processed: 0 })).toBe(false);
    });
});

describe("driveTable", () => {
    it("does nothing when another process holds the lease", async () => {
        db.claimLease.mockResolvedValue(false);
        const { ports: p, store } = ports();
        await driveTable(7, p);
        expect(advanceTable).not.toHaveBeenCalled();
        expect(store.releaseRunningRows).not.toHaveBeenCalled();
        expect(db.releaseLease).not.toHaveBeenCalled();
    });

    it("puts orphaned rows back once, then runs units in the workspace's scope until the table finishes", async () => {
        advanceTable
            .mockResolvedValueOnce({ state: "advanced", processed: 8 })
            .mockResolvedValueOnce({ state: "advanced", processed: 2 })
            .mockResolvedValueOnce({ state: "finished", status: "done" });
        const { ports: p, store } = ports();

        await driveTable(7, p);

        expect(store.releaseRunningRows).toHaveBeenCalledTimes(1);
        expect(store.releaseRunningRows.mock.invocationCallOrder[0]).toBeLessThan(
            advanceTable.mock.invocationCallOrder[0]!
        );
        expect(advanceTable).toHaveBeenCalledTimes(3);
        expect(withWorkspaceChatModels).toHaveBeenCalledTimes(3);
        expect(withWorkspaceChatModels).toHaveBeenCalledWith(
            BigInt(5),
            { feature: "extraction", userId: "creator", enforce: false },
            expect.any(Function)
        );
        expect(db.releaseLease).toHaveBeenCalledWith(7);
    });

    it("leaves a table whose units find nothing to do for the next resume", async () => {
        advanceTable.mockResolvedValue({ state: "advanced", processed: 0 });
        const { ports: p, store } = ports();
        await driveTable(7, p);
        expect(advanceTable).toHaveBeenCalledTimes(2);
        expect(store.finish).not.toHaveBeenCalled();
        expect(db.releaseLease).toHaveBeenCalledWith(7);
    });

    it("retries a unit that throws, putting its rows back, and fails the table after the last attempt", async () => {
        advanceTable.mockRejectedValue(new Error("endpoint down"));
        const { ports: p, store } = ports();
        expect(await advanceWithRetries(p, 7, 3, 0)).toBeNull();
        expect(advanceTable).toHaveBeenCalledTimes(3);
        expect(store.releaseRunningRows).toHaveBeenCalledTimes(2);
        expect(store.finish).toHaveBeenCalledWith(7, "failed", "endpoint down", expect.any(Date));
    });
});

describe("dispatch and resume", () => {
    it("drives inline after the response, or sends the event to the worker", async () => {
        await dispatchTable(TABLE);
        expect(after).toHaveBeenCalledTimes(1);
        expect(inngest.send).not.toHaveBeenCalled();

        process.env.EXTRACTION_EXECUTOR = "worker";
        await dispatchTable(TABLE);
        expect(after).toHaveBeenCalledTimes(1);
        expect(inngest.send).toHaveBeenCalledWith({
            name: "extraction/run.requested",
            data: { tableId: 7, companyId: "5", userId: "creator" },
        });
    });

    it("resumes only an unfinished inline table whose lease has lapsed", () => {
        const now = new Date("2026-11-12T08:00:00Z");
        const live = new Date(now.getTime() + 1000);
        const lapsed = new Date(now.getTime() - 1000);
        expect(resumeIfStalled({ id: 7, status: "running", leaseUntil: lapsed }, now)).toBe(true);
        expect(resumeIfStalled({ id: 7, status: "queued", leaseUntil: null }, now)).toBe(true);
        expect(resumeIfStalled({ id: 7, status: "running", leaseUntil: live }, now)).toBe(false);
        expect(resumeIfStalled({ id: 7, status: "done", leaseUntil: null }, now)).toBe(false);
        process.env.EXTRACTION_EXECUTOR = "worker";
        expect(resumeIfStalled({ id: 7, status: "running", leaseUntil: lapsed }, now)).toBe(false);
        expect(after).toHaveBeenCalledTimes(2);
    });
});
