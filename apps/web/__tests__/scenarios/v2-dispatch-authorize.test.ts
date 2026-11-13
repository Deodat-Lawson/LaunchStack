/**
 * The v2 reconciler's orchestration (which queries run in which mode, how a
 * failed send backs off, how an over-cap run is failed) and the access
 * recheck every unit starts with. The queries themselves are covered against
 * Postgres in pipelines/src/scenarios/v2/store.integration.test.ts.
 */
jest.mock("@launchstack/pipelines/scenarios/v2/db", () => ({
    claimDispatch: jest.fn(),
    claimDueDispatches: jest.fn(async () => []),
    createV2Store: jest.fn(),
    markAbandonedAttempts: jest.fn(async () => 0),
    markDispatchFailed: jest.fn(async () => new Date("2026-11-13T10:00:05Z")),
    markDispatchSent: jest.fn(),
    purgeRawReplies: jest.fn(async () => 0),
    redispatchStalledRuns: jest.fn(async () => ({ dispatched: [], overCap: [] })),
    releaseTerminalHolds: jest.fn(async () => 0),
    sourceManifestDocumentIds: jest.fn(async () => null),
}));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/server/scenarios/executor", () => ({
    readScenariosExecutor: jest.fn(() => "worker"),
    readScenariosConcurrency: jest.fn(() => 6),
}));
jest.mock("~/server/scenarios/v2/credits", () => ({ createAppScenarioCredits: jest.fn() }));
jest.mock("~/server/scenarios/evidence", () => ({ visibleDocumentIds: jest.fn() }));
jest.mock("~/lib/require-workspace-context", () => ({ resolveMemberContext: jest.fn() }));
jest.mock("@launchstack/pipelines/scenarios", () => ({ createLlmSimulationModel: jest.fn() }));

import { AccessRevokedError, RUN_MESSAGES } from "@launchstack/pipelines/scenarios/v2/engine";
import type { ScenarioRunRecord } from "@launchstack/pipelines/scenarios";

import { authorizeScenarioRun } from "~/server/scenarios/v2/deps";
import {
    deliverDispatch,
    readRawRetentionDays,
    reconcileScenarioRunsV2,
} from "~/server/scenarios/v2/dispatch";

const db = jest.requireMock<Record<string, jest.Mock>>("@launchstack/pipelines/scenarios/v2/db");
const { inngest } = jest.requireMock<{ inngest: { send: jest.Mock } }>("~/server/inngest/client");
const { resolveMemberContext } = jest.requireMock<{ resolveMemberContext: jest.Mock }>(
    "~/lib/require-workspace-context"
);
const { visibleDocumentIds } = jest.requireMock<{ visibleDocumentIds: jest.Mock }>(
    "~/server/scenarios/evidence"
);

const now = new Date("2026-11-13T10:00:00Z");
const dispatch = {
    id: 3,
    companyId: 5n,
    runId: 9,
    generation: 1,
    eventId: "scenario-run:9:g1",
    status: "pending",
    attempts: 1,
};

beforeEach(() => jest.clearAllMocks());

describe("dispatch", () => {
    it("publishes with the dispatch's own event id, then marks it sent", async () => {
        db.claimDispatch!.mockResolvedValueOnce(dispatch);
        expect(await deliverDispatch(3, undefined, now)).toBe(true);
        expect(inngest.send).toHaveBeenCalledWith({
            id: "scenario-run:9:g1",
            name: "scenarios/run.v2.requested",
            data: { runId: 9, companyId: "5", generation: 1 },
        });
        expect(db.markDispatchSent).toHaveBeenCalledWith(3, expect.any(Date));
    });

    it("leaves a failed send pending with a backoff for the reconciler", async () => {
        db.claimDispatch!.mockResolvedValueOnce(dispatch);
        inngest.send.mockRejectedValueOnce(new Error("Inngest is down"));
        expect(await deliverDispatch(3, undefined, now)).toBe(false);
        expect(db.markDispatchSent).not.toHaveBeenCalled();
        expect(db.markDispatchFailed).toHaveBeenCalledWith(dispatch, "Inngest is down", now);
    });

    it("re-dispatches, delivers, fails over-cap runs under a fresh lease, and sweeps", async () => {
        const finishRun = jest.fn(async () => true);
        const claimLease = jest
            .fn()
            .mockResolvedValueOnce({ runId: 4, owner: "o", epoch: 2, generation: 1 })
            .mockResolvedValueOnce(null);
        db.createV2Store!.mockReturnValue({ claimLease, finishRun });
        db.redispatchStalledRuns!.mockResolvedValueOnce({
            dispatched: [{ ...dispatch, id: 4, eventId: "scenario-run:9:g1:r1" }],
            overCap: [4, 5],
        });
        db.claimDueDispatches!.mockResolvedValueOnce([
            { ...dispatch, id: 4, eventId: "scenario-run:9:g1:r1" },
        ]);
        const publish = jest.fn(async () => {});
        const report = await reconcileScenarioRunsV2({ now, publish });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(report).toMatchObject({ redispatched: 1, delivered: 1, stalledFailed: 1 });
        expect(finishRun).toHaveBeenCalledWith(
            { runId: 4, owner: "o", epoch: 2, generation: 1 },
            { status: "failed", error: RUN_MESSAGES.stalled, at: now }
        );
        expect(db.releaseTerminalHolds).toHaveBeenCalled();
        expect(db.markAbandonedAttempts).toHaveBeenCalledWith(
            new Date(now.getTime() - 30 * 60_000),
            now
        );
        expect(db.purgeRawReplies).toHaveBeenCalledWith(new Date(now.getTime() - 30 * 86_400_000));
    });

    it("delivers whatever SCENARIOS_EXECUTOR says (the worker may not carry it)", async () => {
        const { readScenariosExecutor } = jest.requireMock<{ readScenariosExecutor: jest.Mock }>(
            "~/server/scenarios/executor"
        );
        readScenariosExecutor.mockReturnValue("inline");
        await reconcileScenarioRunsV2({ now });
        expect(db.redispatchStalledRuns).toHaveBeenCalled();
        expect(db.claimDueDispatches).toHaveBeenCalled();
        readScenariosExecutor.mockReturnValue("worker");
    });

    it("reads the raw-reply retention from the environment", () => {
        expect(readRawRetentionDays({})).toBe(30);
        expect(readRawRetentionDays({ SCENARIOS_RAW_RETENTION_DAYS: "7" })).toBe(7);
        expect(readRawRetentionDays({ SCENARIOS_RAW_RETENTION_DAYS: "-1" })).toBe(30);
    });
});

describe("authorizeScenarioRun", () => {
    const run = {
        id: 9,
        companyId: 5n,
        generation: 1,
        createdByUserId: "creator",
        sources: { documentIds: [1, 2] },
    } as unknown as ScenarioRunRecord;
    const member = { documentScope: jest.fn(async () => ({ kind: "member" })) };

    it("passes while the creator is a member who can open every file", async () => {
        resolveMemberContext.mockResolvedValueOnce(member);
        db.sourceManifestDocumentIds!.mockResolvedValueOnce([2, 3]);
        visibleDocumentIds.mockResolvedValueOnce(new Set([1, 2, 3]));
        await expect(authorizeScenarioRun(run)).resolves.toBeUndefined();
        expect(visibleDocumentIds).toHaveBeenCalledWith(5n, { kind: "member" }, [1, 2, 3]);
    });

    it("revokes when the creator left the workspace", async () => {
        resolveMemberContext.mockResolvedValueOnce(null);
        await expect(authorizeScenarioRun(run)).rejects.toBeInstanceOf(AccessRevokedError);
    });

    it("revokes when a captured file can no longer be opened", async () => {
        resolveMemberContext.mockResolvedValueOnce(member);
        db.sourceManifestDocumentIds!.mockResolvedValueOnce([3]);
        visibleDocumentIds.mockResolvedValueOnce(new Set([1, 2]));
        await expect(authorizeScenarioRun(run)).rejects.toBeInstanceOf(AccessRevokedError);
    });
});
