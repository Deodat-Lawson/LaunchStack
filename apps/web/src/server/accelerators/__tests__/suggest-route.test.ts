/**
 * `POST …/sections/:sectionId/suggest`: who may call it, what it refuses before any paid work
 * starts, and what it queues. Access, the service and the credit pre-check are real; only the
 * database reads, the run queue, credits and `after()` are stubbed.
 */
import type * as MockRequireWorkspaceContext from "../../../../__tests__/helpers/mock-require-workspace-context";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";

import { makeWorkspaceContext } from "../../../../__tests__/helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../../../__tests__/helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/accelerators/access", () => ({
    ...jest.requireActual("~/server/accelerators/access"),
    // The real one re-resolves the member from the database after the work has run.
    resolveAcceleratorMember: jest.fn(async () => undefined),
}));

const mockGetApplication = jest.fn();
const mockGetProgram = jest.fn();
jest.mock("@launchstack/pipelines/accelerators/db", () => ({
    ...jest.requireActual("@launchstack/pipelines/accelerators/db"),
    getAcceleratorApplication: (...args: unknown[]) => mockGetApplication(...args),
    getCatalogueProgram: (...args: unknown[]) => mockGetProgram(...args),
}));

const mockFindLiveRun = jest.fn();
jest.mock("@launchstack/pipelines/proposals/db", () => ({
    ...jest.requireActual("@launchstack/pipelines/proposals/db"),
    findLiveRun: (...args: unknown[]) => mockFindLiveRun(...args),
}));

const mockQueueRun = jest.fn();
jest.mock("@launchstack/pipelines/proposals", () => ({
    ...jest.requireActual("@launchstack/pipelines/proposals"),
    queueProposalRun: (...args: unknown[]) => mockQueueRun(...args),
}));

const mockHasTokens = jest.fn();
jest.mock("~/lib/credits", () => ({
    hasTokens: (...args: unknown[]) => mockHasTokens(...args),
    debitTokens: jest.fn(),
}));
jest.mock("~/server/deployment", () => ({ isMeteringEnforced: () => true }));
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("~/server/workspace-models/scope", () => ({
    withWorkspaceChatModels: (_companyId: bigint, _feature: string, work: () => Promise<unknown>) =>
        work(),
}));

const mockAfter = jest.fn();
jest.mock("next/server", () => ({
    ...jest.requireActual("next/server"),
    after: (work: unknown) => mockAfter(work),
}));

import { NextRequest, NextResponse } from "next/server";

import { POST } from "~/app/api/accelerators/applications/[id]/sections/[sectionId]/suggest/route";

const ANSWER = "Prefix 😀 old suffix";
const params = { params: Promise.resolve({ id: "app-1", sectionId: "sec-1" }) };
const valid = { expectedRevision: 3, start: 10, end: 13, instruction: "Make it clearer" };

function section(overrides: Record<string, unknown> = {}) {
    return {
        id: "sec-1",
        key: "traction",
        revision: 3,
        draft: ANSWER,
        draftMeta: null,
        field: { fieldType: "long_text", question: "Describe your traction", position: 0 },
        ...overrides,
    };
}

function call(body: unknown, init: { raw?: string } = {}) {
    return POST(
        new NextRequest("http://x/api/accelerators/applications/app-1/sections/sec-1/suggest", {
            method: "POST",
            body: init.raw ?? JSON.stringify(body),
        }),
        params
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "owner", authUserId: "u1", companyId: BigInt(9) }),
    });
    mockGetApplication.mockResolvedValue({
        id: "app-1",
        programId: "prog-1",
        sections: [section()],
    });
    mockGetProgram.mockResolvedValue({ program: { id: "prog-1" }, contentHash: "h" });
    mockFindLiveRun.mockResolvedValue(null);
    mockHasTokens.mockResolvedValue(true);
    mockQueueRun.mockImplementation(async (args: { kind: string }) => ({
        id: "run-1",
        kind: args.kind,
        status: "queued",
        steps: [],
        summary: null,
        result: null,
        error: null,
        creditsUsed: 0,
        createdAt: new Date("2026-06-01T00:00:00Z"),
        startedAt: null,
        completedAt: null,
    }));
});

describe("who may ask for a Suggestion", () => {
    it("returns the authentication failure untouched", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });
        const response = await call(valid);
        expect(response.status).toBe(401);
        expect(mockGetApplication).not.toHaveBeenCalled();
    });

    it.each([
        ["without documents.edit", { permissions: ["documents.read" as const] }],
        [
            "with a restricted folder hidden from them",
            {
                scope: {
                    kind: "except" as const,
                    deniedCategories: ["Finance"],
                    deniedDocumentIds: [],
                    allowedDocumentIds: [],
                },
            },
        ],
        [
            "as a guest limited to what they were added to",
            { scope: { kind: "only" as const, categories: [], documentIds: [1] } as never },
        ],
        ["after losing active membership", { status: "suspended" as never }],
    ])("is refused %s, before anything is read or queued", async (_name, overrides) => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ companyId: BigInt(9), ...overrides }),
        });
        const response = await call(valid);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "accelerators_full_access_required" });
        expect(mockGetApplication).not.toHaveBeenCalled();
        expect(mockQueueRun).not.toHaveBeenCalled();
    });
});

describe("what it refuses before any paid work", () => {
    it.each([
        ["a missing instruction", { ...valid, instruction: undefined }],
        ["a blank instruction", { ...valid, instruction: "   " }],
        ["an empty range", { ...valid, start: 5, end: 5 }],
        ["a reversed range", { ...valid, start: 9, end: 4 }],
        ["a negative revision", { ...valid, expectedRevision: -1 }],
        ["an unknown key", { ...valid, sectionId: "sec-2" }],
    ])("rejects %s with a 400", async (_name, body) => {
        const response = await call(body);
        expect(response.status).toBe(400);
        expect(mockGetApplication).not.toHaveBeenCalled();
        expect(mockQueueRun).not.toHaveBeenCalled();
    });

    it("rejects a body that is not JSON", async () => {
        const response = await call(null, { raw: "not json" });
        expect(response.status).toBe(400);
        expect(mockQueueRun).not.toHaveBeenCalled();
    });

    it("rejects a stale revision with a 409 so the user selects again", async () => {
        const response = await call({ ...valid, expectedRevision: 2 });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "answer_conflict" });
        expect(mockQueueRun).not.toHaveBeenCalled();
    });

    it("rejects a Field that is not prose", async () => {
        mockGetApplication.mockResolvedValue({
            id: "app-1",
            programId: "prog-1",
            sections: [section({ field: { fieldType: "url", question: "Website" } })],
        });
        const response = await call(valid);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "prose_required" });
    });

    it.each([
        ["past the end of the saved answer", { start: 10, end: 99 }],
        ["through the middle of an emoji", { start: 8, end: 13 }],
    ])("rejects a selection %s", async (_name, range) => {
        const response = await call({ ...valid, ...range });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_edit_range" });
        expect(mockQueueRun).not.toHaveBeenCalled();
    });

    it("answers 404 for an Application or Field the company does not have", async () => {
        mockGetApplication.mockResolvedValue(null);
        expect((await call(valid)).status).toBe(404);
        mockGetApplication.mockResolvedValue({ id: "app-1", programId: "prog-1", sections: [] });
        expect((await call(valid)).status).toBe(404);
    });

    it("answers 409 while another company run is live", async () => {
        mockFindLiveRun.mockResolvedValue({ id: "other-run" });
        const response = await call(valid);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "run_in_progress" });
        expect(mockQueueRun).not.toHaveBeenCalled();
    });

    it("answers 402 and queues nothing when the company cannot pay 1,000 credits", async () => {
        mockHasTokens.mockResolvedValue(false);
        const response = await call(valid);
        expect(response.status).toBe(402);
        expect(await response.json()).toMatchObject({ code: "insufficient_credits" });
        expect(mockHasTokens).toHaveBeenCalledWith(BigInt(9), 1_000);
        expect(mockQueueRun).not.toHaveBeenCalled();
    });
});

describe("a valid request", () => {
    it("queues one accel_edit run for the company, then executes it after the response", async () => {
        const response = await call(valid);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            run: { id: "run-1", kind: "accel_edit", status: "queued" },
        });
        expect(mockHasTokens).toHaveBeenCalledWith(BigInt(9), 1_000);
        expect(mockQueueRun).toHaveBeenCalledTimes(1);
        expect(mockQueueRun).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: BigInt(9),
                userId: "u1",
                kind: "accel_edit",
                input: {
                    applicationId: "app-1",
                    acceleratorEdit: {
                        sectionId: "sec-1",
                        expectedRevision: 3,
                        start: 10,
                        end: 13,
                        instruction: "Make it clearer",
                    },
                },
            })
        );
        expect(mockAfter).toHaveBeenCalledTimes(1);
    });

    it("takes tenancy from the session, never from the body", async () => {
        const response = await call({ ...valid, companyId: "999" });
        expect(response.status).toBe(400);
        expect(mockQueueRun).not.toHaveBeenCalled();
    });
});
