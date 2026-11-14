import {
    executeProposalRun,
    queueProposalRun,
    type RunKind,
    type RunRecord,
} from "@launchstack/pipelines/proposals";
import { getRun } from "@launchstack/pipelines/proposals/db";

import { hasTokens } from "~/lib/credits";
import { resolveMemberContext } from "~/lib/require-workspace-context";
import { isMeteringEnforced } from "~/server/deployment";
import { inngest } from "~/server/inngest/client";
import {
    creditsFor,
    executeProposalRunForMember,
    startProposalRun,
} from "~/server/proposals/executor";

import { makeWorkspaceContext } from "../helpers/workspace-context";

jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("@launchstack/pipelines/proposals", () => ({
    ...jest.requireActual<object>("@launchstack/pipelines/proposals/types"),
    PROPOSAL_CREDITS: {
        funders: 2_000,
        extract: 1_000,
        draft: 1_500,
        rewrite: 1_000,
        review: 2_000,
        programs: 167,
    },
    queueProposalRun: jest.fn(),
    executeProposalRun: jest.fn(),
    failProposalRun: jest.fn(),
}));
jest.mock("@launchstack/pipelines/proposals/db", () => ({ getRun: jest.fn() }));
jest.mock("~/lib/credits", () => ({ hasTokens: jest.fn() }));
jest.mock("~/lib/require-workspace-context", () => ({ resolveMemberContext: jest.fn() }));
jest.mock("~/server/deployment", () => ({ isMeteringEnforced: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/server/proposals/ports", () => ({ createProposalPorts: jest.fn() }));
jest.mock("~/server/workspace-models/scope", () => ({ withWorkspaceChatModels: jest.fn() }));

const mockQueue = jest.mocked(queueProposalRun);
const mockExecute = jest.mocked(executeProposalRun);
const mockGetRun = jest.mocked(getRun);
const mockMember = jest.mocked(resolveMemberContext);
const mockCredits = jest.mocked(hasTokens);
const mockMetering = jest.mocked(isMeteringEnforced);
const mockSend = jest.mocked(inngest.send);
const originalExecutor = process.env.PROPOSALS_EXECUTOR;
const run: RunRecord = {
    id: "run",
    companyId: 5n,
    userId: "writer",
    kind: "programs",
    status: "queued",
    applicationId: null,
    input: {},
    steps: [],
    summary: null,
    error: null,
    creditsUsed: 0,
    createdAt: new Date("2026-10-25T00:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    updatedAt: null,
};

beforeEach(() => {
    jest.resetAllMocks();
    process.env.PROPOSALS_EXECUTOR = "worker";
    mockMetering.mockReturnValue(true);
    mockCredits.mockResolvedValue(true);
    mockQueue.mockResolvedValue(run);
    mockGetRun.mockResolvedValue(run);
    mockExecute.mockResolvedValue(run);
    mockMember.mockResolvedValue(makeWorkspaceContext({ companyId: 5n, authUserId: "writer" }));
});

afterAll(() => {
    if (originalExecutor === undefined) delete process.env.PROPOSALS_EXECUTOR;
    else process.env.PROPOSALS_EXECUTOR = originalExecutor;
});

describe("Program matching credit admission", () => {
    it.each<[RunKind, number, number]>([
        ["draft", 3, 4_500],
        ["draft", 0, 1_500],
        ["programs", 1, 167],
        ["programs", 12, 2_004],
    ])("prices %s with %i units at %i credits", (kind, count, expected) => {
        expect(creditsFor(kind, count)).toBe(expected);
    });

    it("queues company matching priced per chosen Program", async () => {
        const queued = await startProposalRun({
            companyId: 5n,
            userId: "writer",
            kind: "programs",
            input: { programs: { programIds: ["a", "b", "c"] } },
        });
        expect(queued).toEqual(run);
        expect(mockCredits).toHaveBeenCalledWith(5n, 501);
        expect(mockSend).toHaveBeenCalledWith({
            name: "proposals/run.requested",
            data: { runId: run.id, companyId: "5", userId: "writer" },
        });
    });

    it("returns the required credit amount without dispatching when the company cannot pay", async () => {
        mockCredits.mockResolvedValue(false);
        await expect(
            startProposalRun({
                companyId: 5n,
                userId: "writer",
                kind: "programs",
                input: { programs: { programIds: ["a", "b"] } },
            })
        ).rejects.toMatchObject({ status: 402, required: 334 });
        expect(mockQueue).not.toHaveBeenCalled();
        expect(mockSend).not.toHaveBeenCalled();
    });

    it.each(["accel_draft", "accel_edit"])(
        "rejects a retired %s kind before metering or dispatch even without metering enforcement",
        async kind => {
            mockMetering.mockReturnValue(false);
            await expect(
                startProposalRun({
                    companyId: 5n,
                    userId: "writer",
                    kind: kind as RunKind,
                    input: {},
                })
            ).rejects.toThrow();
            expect(mockCredits).not.toHaveBeenCalled();
            expect(mockQueue).not.toHaveBeenCalled();
            expect(mockSend).not.toHaveBeenCalled();
        }
    );
});

describe("deferred matching access", () => {
    it("refuses a missing or retired run returned by the current-kind database boundary", async () => {
        mockGetRun.mockResolvedValue(null);
        await expect(executeProposalRunForMember(run.id, 5n)).rejects.toThrow("Run not found");
        expect(mockExecute).not.toHaveBeenCalled();
        expect(mockMember).not.toHaveBeenCalled();
    });

    it.each([
        { permissions: ["documents.read" as const] },
        {
            scope: {
                kind: "only" as const,
                allowedCategories: [],
                deniedDocumentIds: [],
                allowedDocumentIds: [],
            },
        },
        { status: "suspended" as const },
    ])("does not execute after the writer loses matching access (%o)", async overrides => {
        mockMember.mockResolvedValue(
            makeWorkspaceContext({ companyId: 5n, authUserId: "writer", ...overrides })
        );
        await expect(executeProposalRunForMember(run.id, 5n)).rejects.toMatchObject({
            status: 403,
        });
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("refuses a writer whose company membership was removed", async () => {
        mockMember.mockResolvedValue(null);
        await expect(executeProposalRunForMember(run.id, 5n)).rejects.toThrow();
        expect(mockExecute).not.toHaveBeenCalled();
    });
});
