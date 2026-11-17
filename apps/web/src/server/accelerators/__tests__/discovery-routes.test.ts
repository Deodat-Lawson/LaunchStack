import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPublishedCatalogue } from "@launchstack/pipelines/accelerators/catalogue";
import { programDetails } from "~/server/accelerators/details";

import {
    CatalogueProgramSchema,
    FIT_DIMENSION_KEYS,
    FIT_RUBRIC_VERSION,
    hashProfile,
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
import {
    AcceleratorAccessError,
    companySharedScope,
    resolveAcceleratorMember,
} from "~/server/accelerators/access";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../../../__tests__/helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);
/** What every member may read; a marker, so a test can tell it apart from a member's own view. */
const SHARED_SCOPE = {
    kind: "except" as const,
    deniedCategories: ["Board"],
    allowedCategories: [],
    deniedDocumentIds: [41],
    allowedDocumentIds: [],
};
jest.mock("~/server/accelerators/access", () => ({
    ...jest.requireActual("~/server/accelerators/access"),
    resolveAcceleratorMember: jest.fn(async () => undefined),
    companySharedScope: jest.fn(),
}));

const mockCatalogue = jest.fn();
const mockMatches = jest.fn();
const mockIntelligence = jest.fn();
jest.mock("@launchstack/pipelines/accelerators/db", () => ({
    listCatalogue: (...args: unknown[]) => mockCatalogue(...args),
    listCompanyMatches: (...args: unknown[]) => mockMatches(...args),
    listProgramIntelligence: (...args: unknown[]) => mockIntelligence(...args),
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
const mockSharedScope = jest.mocked(companySharedScope);
const originalExecutor = process.env.PROPOSALS_EXECUTOR;
const profile: OrgProfile = {
    summary: "We build software for growing companies.",
    applicantType: "any",
    focusAreas: [],
    geography: [],
    facts: [
        {
            key: "description",
            label: "What it does",
            value: "Software for growing companies",
            cites: [1],
            source: "manual",
        },
    ],
    evidence: [
        {
            n: 1,
            documentId: null,
            title: "What it does",
            page: null,
            quote: "Software for growing companies",
            url: null,
            origin: "profile",
        },
    ],
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
    mockIntelligence.mockResolvedValue([]);
    mockMatches.mockResolvedValue({});
    mockProfile.mockResolvedValue(profile);
    mockSharedScope.mockResolvedValue(SHARED_SCOPE);
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
            costs: { matchPerProgram: 167 },
            details: {},
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

    it("returns sourced details for every stored dossier, including unpublished fields", async () => {
        const { dossiers } = loadPublishedCatalogue(
            join(__dirname, "../../../../../../fixtures/accelerators")
        );
        mockIntelligence.mockResolvedValue(
            dossiers.map(dossier => ({ dossier, contentHash: hashValue(dossier) }))
        );
        const response = await home(new NextRequest("http://x/api/accelerators"));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(Object.keys(body.details)).toHaveLength(dossiers.length);
        const dossier = dossiers.find(item => item.deal.summary.value === null)!;
        expect(body.details[dossier.programId]).toEqual(programDetails(dossier));
        expect(body.details[dossier.programId].deal.summary.value).toBeNull();
        expect(body.details[dossier.programId].sources.length).toBeGreaterThan(0);
    });

    it("marks stale fit without hiding the score or claiming it is current, where nothing is private", async () => {
        mockSharedScope.mockResolvedValue({ kind: "everything" });
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
                    fit: { ...ratedAssessment, overall: { score: 88, missing: 0, deduction: 0 } },
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

    it("withholds the grades and notes of a result not scored from the company-shared profile", async () => {
        // The workspace has private sources (SHARED_SCOPE denies some), and this result was
        // scored from another profile, possibly one that included them: its notes could quote it.
        mockMatches.mockResolvedValue({
            [program.id]: {
                assessment: ratedAssessment,
                profileHash: "profile-with-private-sources",
                programHash: hashValue(program),
                rubricVersion: FIT_RUBRIC_VERSION,
                checkedAt: "2026-10-24T00:00:00Z",
            } satisfies StoredFit,
        });
        const response = await home(new NextRequest("http://x/api/accelerators"));
        const [view] = (await response.json()).programs;
        expect(view.fit).toBeNull();
        expect(view.freshness).toMatchObject({
            status: "out_of_date",
            reasons: ["profile_changed"],
        });
        expect(JSON.stringify(view)).not.toContain(ratedAssessment.dimensions.sector.note);
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

    it("keeps a result current and shown when the profile was only rebuilt, not changed", async () => {
        mockMatches.mockResolvedValue({
            [program.id]: {
                assessment: ratedAssessment,
                profileHash: hashProfile({ ...profile, builtAt: "2026-10-01T00:00:00.000Z" }),
                programHash: hashValue(program),
                rubricVersion: FIT_RUBRIC_VERSION,
                checkedAt: "2026-10-24T00:00:00Z",
            } satisfies StoredFit,
        });
        const response = await home(new NextRequest("http://x/api/accelerators"));
        const [view] = (await response.json()).programs;
        expect(view.freshness.status).toBe("current");
        expect(view.fit).not.toBeNull();
    });

    async function servedFit(assessment: FitAssessmentV1) {
        mockMatches.mockResolvedValue({
            [program.id]: {
                assessment,
                profileHash: hashProfile(profile),
                programHash: hashValue(program),
                rubricVersion: FIT_RUBRIC_VERSION,
                checkedAt: "2026-11-09T00:00:00Z",
            } satisfies StoredFit,
        });
        const response = await home(new NextRequest("http://x/api/accelerators"));
        expect(mockQueue).not.toHaveBeenCalled();
        return (await response.json()).programs[0];
    }

    // AE7: a confirmed failed hard requirement stays explicit beside a strong score.
    it("serves an ineligible Program with its score rather than hiding either", async () => {
        const view = await servedFit({
            ...ratedAssessment,
            eligibility: { status: "ineligible", note: "Requires US incorporation." },
        });
        expect(view.fit).toMatchObject({
            eligibility: { status: "ineligible", note: "Requires US incorporation." },
            overall: { score: 88, missing: 0, deduction: 0 },
        });
        expect(view.freshness.status).toBe("current");
    });

    // AE8: thin evidence leaves unknowns; they carry no weight and each take 5% off the score.
    it("scores thin evidence with a deduction instead of withholding it, keeping the grades", async () => {
        const unknown = {
            score: null,
            applicable: true,
            note: "The profile does not say.",
            evidence: { sourceIds: [], companyEvidenceIds: [] },
        };
        const view = await servedFit({
            ...ratedAssessment,
            dimensions: {
                ...ratedAssessment.dimensions,
                stage: unknown,
                businessModel: unknown,
                deal: unknown,
            },
        });
        // Graded sector 50·20 + operations 100·10 + value 100·10 = 3000 / 40 = 75;
        // three areas missing take 15% off: 75 × 0.85 = 63.75 → 64.
        expect(view.fit.overall).toEqual({ score: 64, missing: 3, deduction: 15 });
        expect(view.fit.dimensions.sector.score).toBe(50);
        expect(view.fit.dimensions.deal.score).toBeNull();
        expect(view.freshness.status).toBe("current");
    });

    // AE9: a refreshed Program makes the saved result out of date without starting a match.
    it("marks fit out of date when the Program changes", async () => {
        mockMatches.mockResolvedValue({
            [program.id]: {
                assessment: ratedAssessment,
                profileHash: hashProfile(profile),
                programHash: "an-earlier-program-version",
                rubricVersion: FIT_RUBRIC_VERSION,
                checkedAt: "2026-11-09T00:00:00Z",
            } satisfies StoredFit,
        });
        const response = await home(new NextRequest("http://x/api/accelerators"));
        expect((await response.json()).programs[0].freshness).toMatchObject({
            status: "out_of_date",
            reasons: ["program_changed"],
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

    it("withholds read results when access is revoked during the read", async () => {
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
        { role: "guest" },
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
            expect(await response.json()).toMatchObject({ code: "accelerators_access_denied" });
            expect(mockProfile).not.toHaveBeenCalled();
            expect(mockQueue).not.toHaveBeenCalled();
        }
    );

    it("lets a member who cannot see a private file score, from what the whole company can read", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({
                companyId: 9n,
                role: "member",
                scope: {
                    kind: "except",
                    deniedCategories: ["Finance"],
                    deniedDocumentIds: [],
                    allowedDocumentIds: [],
                },
            }),
        });
        const response = await match(
            new NextRequest("http://x/api/accelerators/match", {
                method: "POST",
                body: JSON.stringify({ programIds: [program.id] }),
            })
        );
        expect(response.status).toBe(200);
        // The profile is read through the company-shared view, never the requester's own.
        expect(mockSharedScope).toHaveBeenCalledWith(9n);
        expect(mockProfile).toHaveBeenCalledWith(9n, SHARED_SCOPE);
    });

    it.each([null, { ...profile, evidence: [] }])(
        "requires a profile with something to cite before charging",
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
            new NextRequest("http://x/api/accelerators/match", {
                method: "POST",
                body: JSON.stringify({ programIds: [program.id] }),
            })
        );
        expect(response.status).toBe(402);
        expect(await response.json()).toMatchObject({ code: "insufficient_credits" });
        expect(mockQueue).not.toHaveBeenCalled();
    });

    describe("reuse of current results", () => {
        const current = (): StoredFit => ({
            assessment: ratedAssessment,
            profileHash: hashProfile(profile),
            programHash: hashValue(program),
            rubricVersion: FIT_RUBRIC_VERSION,
            checkedAt: "2026-11-14T00:00:00.000Z",
        });
        const post = (body: unknown) =>
            match(
                new NextRequest("http://x/api/accelerators/match", {
                    method: "POST",
                    body: JSON.stringify(body),
                })
            );

        it("sends and prices only the chosen Programs whose result is not current", async () => {
            const other = { ...program, id: "other-program" };
            mockCatalogue.mockResolvedValue([
                { program, contentHash: hashValue(program) },
                { program: other, contentHash: hashValue(other) },
            ]);
            mockMatches.mockResolvedValue({ [program.id]: current() });
            const response = await post({ programIds: [program.id, other.id] });
            expect(response.status).toBe(200);
            expect(mockHasTokens).toHaveBeenCalledWith(9n, 167);
            expect(mockQueue).toHaveBeenCalledWith(
                expect.objectContaining({ input: { programs: { programIds: [other.id] } } })
            );
        });

        it("refuses a run when every chosen result is current, without charging", async () => {
            mockMatches.mockResolvedValue({ [program.id]: current() });
            const response = await post({ programIds: [program.id] });
            expect(response.status).toBe(409);
            expect(await response.json()).toMatchObject({ code: "all_current" });
            expect(mockHasTokens).not.toHaveBeenCalled();
            expect(mockQueue).not.toHaveBeenCalled();
        });

        it("re-scores current results only when asked", async () => {
            mockMatches.mockResolvedValue({ [program.id]: current() });
            const response = await post({ programIds: [program.id], rescore: true });
            expect(response.status).toBe(200);
            expect(mockQueue).toHaveBeenCalledWith(
                expect.objectContaining({ input: { programs: { programIds: [program.id] } } })
            );
        });

        it("re-scores an out-of-date result without being asked", async () => {
            mockMatches.mockResolvedValue({
                [program.id]: { ...current(), profileHash: "an-older-profile" },
            });
            const response = await post({ programIds: [program.id] });
            expect(response.status).toBe(200);
            expect(mockQueue).toHaveBeenCalledWith(
                expect.objectContaining({ input: { programs: { programIds: [program.id] } } })
            );
        });
    });
});
