import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
    CatalogueProgramSchema,
    FIT_DIMENSION_KEYS,
    FIT_RUBRIC_VERSION,
    hashValue,
    type CatalogueProgram,
    type FitAssessmentV1,
    type StoredFit,
} from "@launchstack/pipelines/accelerators";
import {
    queueProposalRun,
    type OrgProfile,
    type RunRecord,
} from "@launchstack/pipelines/proposals";
import { getRun } from "@launchstack/pipelines/proposals/db";

import type * as MockRequireWorkspaceContext from "../../../../__tests__/helpers/mock-require-workspace-context";
import { makeWorkspaceContext } from "../../../../__tests__/helpers/workspace-context";

import type { WorkspaceContextResult } from "~/lib/require-workspace-context";
import { AcceleratorAccessError, resolveAcceleratorMember } from "~/server/accelerators/access";

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
    resolveAcceleratorMember: jest.fn(async () => undefined),
}));

const mockCatalogue = jest.fn();
const mockMatches = jest.fn();
jest.mock("@launchstack/pipelines/accelerators/db", () => ({
    listCatalogue: (...args: unknown[]) => mockCatalogue(...args),
    listCompanyMatches: (...args: unknown[]) => mockMatches(...args),
}));
const mockProfile = jest.fn();
const mockFindLiveRun = jest.fn();
jest.mock("@launchstack/pipelines/proposals/db", () => ({
    loadOrgProfile: (...args: unknown[]) => mockProfile(...args),
    findLiveRun: (...args: unknown[]) => mockFindLiveRun(...args),
    getRun: jest.fn(),
}));
jest.mock("@launchstack/pipelines/proposals", () => ({
    ...jest.requireActual("@launchstack/pipelines/proposals"),
    queueProposalRun: jest.fn(),
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

import { GET as home } from "~/app/api/accelerators/route";
import { POST as match } from "~/app/api/accelerators/match/route";
import { GET as preview } from "~/app/api/accelerators/programs/[id]/route";
import { GET as progress } from "~/app/api/accelerators/runs/[id]/route";

const mockQueue = jest.mocked(queueProposalRun);
const mockGetRun = jest.mocked(getRun);
const mockRecheck = jest.mocked(resolveAcceleratorMember);
const originalExecutor = process.env.PROPOSALS_EXECUTOR;
const profile: OrgProfile = {
    summary: "We build software for growing companies.",
    applicantType: "any",
    focusAreas: [],
    geography: [],
    facts: [],
    evidence: [],
    builtFrom: { documents: 0, snippets: 0 },
    builtAt: "2026-10-25T00:00:00Z",
    promptVersion: "fixture",
};
const run: RunRecord = {
    id: "run-1",
    companyId: 9n,
    userId: "u1",
    kind: "programs",
    status: "queued",
    applicationId: null,
    input: {},
    steps: [],
    summary: null,
    error: null,
    creditsUsed: 0,
    createdAt: new Date("2026-10-25T00:00:00Z"),
    startedAt: null,
    completedAt: null,
    updatedAt: null,
};
let program: CatalogueProgram;

beforeAll(async () => {
    program = CatalogueProgramSchema.parse(
        JSON.parse(
            await readFile(
                join(
                    __dirname,
                    "../../../../../../fixtures/accelerators/programs/abovea-startup-accelerator.json"
                ),
                "utf8"
            )
        )
    );
});

beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROPOSALS_EXECUTOR = "inline";
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ companyId: 9n, authUserId: "u1" }),
    });
    mockCatalogue.mockResolvedValue([{ program, contentHash: hashValue(program) }]);
    mockMatches.mockResolvedValue({});
    mockProfile.mockResolvedValue(profile);
    mockFindLiveRun.mockResolvedValue(null);
    mockHasTokens.mockResolvedValue(true);
    mockQueue.mockResolvedValue(run);
    mockGetRun.mockResolvedValue(run);
    mockRecheck.mockResolvedValue(makeWorkspaceContext({ companyId: 9n, authUserId: "u1" }));
});

afterAll(() => {
    if (originalExecutor === undefined) delete process.env.PROPOSALS_EXECUTOR;
    else process.env.PROPOSALS_EXECUTOR = originalExecutor;
});

/** Sector 50, the other applicable dimensions 100, portfolio not applicable: (50·20 + 100·65) / 85 ≈ 88. */
const ratedAssessment: FitAssessmentV1 = {
    rubricVersion: FIT_RUBRIC_VERSION,
    eligibility: { status: "eligible", note: "No published requirement is failed." },
    dimensions: Object.fromEntries(
        FIT_DIMENSION_KEYS.map(key => [
            key,
            key === "portfolio"
                ? {
                      score: null,
                      applicable: false,
                      note: "Past-company data is not collected for this accelerator.",
                      evidence: { sourceIds: [], companyEvidenceIds: [] },
                  }
                : {
                      score: key === "sector" ? 50 : 100,
                      applicable: true,
                      note: "Relevant target applicants",
                      evidence: { sourceIds: ["official"], companyEvidenceIds: [1] },
                  },
        ])
    ) as FitAssessmentV1["dimensions"],
};

describe("discovery reads", () => {
    it("serves the existing catalogue and sourced Program preview without starting paid work", async () => {
        const response = await home(new NextRequest("http://x/api/accelerators"));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            programs: [
                {
                    program,
                    contentHash: hashValue(program),
                    fit: null,
                    freshness: { status: "not_assessed", reasons: [], assessedAt: null },
                },
            ],
            profileReady: true,
            canEdit: true,
            costs: { match: 2_000 },
        });
        const detail = await preview(
            new NextRequest(`http://x/api/accelerators/programs/${program.id}`),
            { params: Promise.resolve({ id: program.id }) }
        );
        expect(detail.status).toBe(200);
        expect(await detail.json()).toMatchObject({ program: { program } });
        expect(mockQueue).not.toHaveBeenCalled();
        expect(mockHasTokens).not.toHaveBeenCalled();
        expect(mockAfter).not.toHaveBeenCalled();
    });

    it("marks stale fit without hiding the score or claiming it is current", async () => {
        const fit: StoredFit = {
            assessment: ratedAssessment,
            profileHash: "previous-profile",
            programHash: hashValue(program),
            rubricVersion: FIT_RUBRIC_VERSION,
            checkedAt: "2026-10-24T00:00:00Z",
        };
        mockMatches.mockResolvedValue({ [program.id]: fit });
        const response = await home(new NextRequest("http://x/api/accelerators"));
        expect(await response.json()).toMatchObject({
            programs: [
                {
                    fit: { ...ratedAssessment, overall: { score: 88, coverage: 100 } },
                    freshness: {
                        status: "out_of_date",
                        reasons: ["profile_changed"],
                        assessedAt: fit.checkedAt,
                    },
                },
            ],
        });
        expect(mockQueue).not.toHaveBeenCalled();
    });

    it("reports a result saved under an earlier rubric as out of date without grades", async () => {
        mockMatches.mockResolvedValue({
            [program.id]: {
                assessment: null,
                profileHash: "previous-profile",
                programHash: hashValue(program),
                rubricVersion: null,
                checkedAt: "2026-10-24T00:00:00Z",
            } satisfies StoredFit,
        });
        const response = await home(new NextRequest("http://x/api/accelerators"));
        const [view] = (await response.json()).programs;
        expect(view.fit).toBeNull();
        expect(view.freshness).toEqual({
            status: "out_of_date",
            reasons: ["profile_changed", "rubric_changed"],
            assessedAt: "2026-10-24T00:00:00Z",
        });
        expect(mockQueue).not.toHaveBeenCalled();
    });

    it("returns 404 for a Program that is not in the catalogue", async () => {
        const response = await preview(
            new NextRequest("http://x/api/accelerators/programs/missing"),
            { params: Promise.resolve({ id: "missing" }) }
        );
        expect(response.status).toBe(404);
    });

    it("withholds read results when unrestricted document access is revoked during the read", async () => {
        mockRecheck.mockRejectedValue(new AcceleratorAccessError());
        const response = await home(new NextRequest("http://x/api/accelerators"));
        expect(response.status).toBe(403);
        expect(await response.json()).not.toHaveProperty("programs");
    });

    it("exposes matching progress, not a stored private result payload", async () => {
        mockGetRun.mockResolvedValue({
            ...run,
            result: { suggestion: { replacement: "Private historical text" } },
        } as RunRecord);
        const response = await progress(new NextRequest("http://x/api/accelerators/runs/run-1"), {
            params: Promise.resolve({ id: run.id }),
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({
            run: { id: run.id, kind: "programs", status: "queued", creditsUsed: 0 },
        });
        expect(body.run).not.toHaveProperty("result");
        expect(JSON.stringify(body)).not.toContain("Private historical text");
    });

    it("does not expose a Grant run through the Accelerator progress API", async () => {
        mockGetRun.mockResolvedValue({ ...run, kind: "draft" });
        const response = await progress(new NextRequest("http://x/api/accelerators/runs/grant"), {
            params: Promise.resolve({ id: "grant" }),
        });
        expect(response.status).toBe(404);
    });
});

describe("matching access and admission", () => {
    it("preserves the authentication failure", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });
        const response = await match(
            new NextRequest("http://x/api/accelerators/match", { method: "POST" })
        );
        expect(response.status).toBe(401);
        expect(mockQueue).not.toHaveBeenCalled();
    });

    it.each([
        { permissions: ["documents.read" as const] },
        {
            scope: {
                kind: "except" as const,
                deniedCategories: ["Finance"],
                deniedDocumentIds: [],
                allowedDocumentIds: [],
            },
        },
        {
            scope: {
                kind: "only" as const,
                allowedCategories: [],
                deniedDocumentIds: [],
                allowedDocumentIds: [1],
            },
        },
        { status: "suspended" as const },
    ])(
        "refuses paid matching before reading company data when access is insufficient (%o)",
        async overrides => {
            mockRequireWorkspaceContext.mockResolvedValue({
                success: true,
                data: makeWorkspaceContext({ companyId: 9n, ...overrides }),
            });
            const response = await match(
                new NextRequest("http://x/api/accelerators/match", { method: "POST" })
            );
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({
                code: "accelerators_full_access_required",
            });
            expect(mockProfile).not.toHaveBeenCalled();
            expect(mockQueue).not.toHaveBeenCalled();
        }
    );

    it.each([null, { ...profile, summary: "", facts: [] }])(
        "requires a built nonempty company profile",
        async missingProfile => {
            mockProfile.mockResolvedValue(missingProfile);
            const response = await match(
                new NextRequest("http://x/api/accelerators/match", { method: "POST" })
            );
            expect(response.status).toBe(409);
            expect(await response.json()).toMatchObject({ code: "profile_required" });
            expect(mockQueue).not.toHaveBeenCalled();
        }
    );

    it("requires an imported catalogue", async () => {
        mockCatalogue.mockResolvedValue([]);
        const response = await match(
            new NextRequest("http://x/api/accelerators/match", { method: "POST" })
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "catalogue_empty" });
        expect(mockQueue).not.toHaveBeenCalled();
    });

    it("does not start another paid run while company work is live", async () => {
        mockFindLiveRun.mockResolvedValue({ id: "other-run" });
        const response = await match(
            new NextRequest("http://x/api/accelerators/match", { method: "POST" })
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "run_in_progress" });
        expect(mockQueue).not.toHaveBeenCalled();
    });

    it("returns 402 without queueing when the company cannot pay the matching price", async () => {
        mockHasTokens.mockResolvedValue(false);
        const response = await match(
            new NextRequest("http://x/api/accelerators/match", { method: "POST" })
        );
        expect(response.status).toBe(402);
        expect(await response.json()).toMatchObject({ code: "insufficient_credits" });
        expect(mockQueue).not.toHaveBeenCalled();
    });
});
