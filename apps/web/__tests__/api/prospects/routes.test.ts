/**
 * Prospects API route tests. External dependencies (workspace context, the
 * vertical's db helpers, Inngest, rate limiting, credits) are mocked so each
 * handler is exercised in isolation.
 *
 * The outreach test is the "check that catches the worst failure": a company
 * whose domain is on the segment's exclusion list must never become a
 * campaign recipient. The runs tests pin the one-execution-path rule: every
 * mode but sample is queued to the worker, and a second run for a segment
 * that already has one is refused.
 */
import { NextRequest } from "next/server";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

const DB_NAMES = [
    "createProgram",
    "listPrograms",
    "getProgram",
    "updateProgram",
    "createRun",
    "getRun",
    "listRuns",
    "findLiveRun",
    "requestRunStop",
    "listPartners",
    "countPartners",
    "countPartnerViews",
    "countRelationshipsByStage",
    "countProgramSummaries",
    "listStageChangeEvents",
    "listPeopleRows",
    "getRelationship",
    "getOrg",
    "listEvidenceForOrg",
    "listEvents",
    "listAgreements",
    "listAgreementsForRelationships",
    "transitionStage",
    "updateRelationship",
    "addEvent",
    "listExclusions",
    "isStale",
] as const;
type DbName = (typeof DB_NAMES)[number];
const mockDb = Object.fromEntries(DB_NAMES.map(name => [name, jest.fn()])) as Record<
    DbName,
    jest.Mock
>;
// Closures defer the mockDb access to call time: imports are hoisted above
// the const, so a direct reference would hit the temporal dead zone.
jest.mock("@launchstack/pipelines/distribution/db", () => {
    class RunInProgressError extends Error {
        code = "run_in_progress";
        status = 409;
        programId: string;
        constructor(mockProgramId: string) {
            super("A run is already in progress for this segment");
            this.name = "RunInProgressError";
            this.programId = mockProgramId;
        }
    }
    const names = [
        "createProgram",
        "listPrograms",
        "getProgram",
        "updateProgram",
        "createRun",
        "getRun",
        "listRuns",
        "findLiveRun",
        "requestRunStop",
        "listPartners",
        "countPartners",
        "countPartnerViews",
        "countRelationshipsByStage",
        "countProgramSummaries",
        "listStageChangeEvents",
        "listPeopleRows",
        "getRelationship",
        "getOrg",
        "listEvidenceForOrg",
        "listEvents",
        "listAgreements",
        "listAgreementsForRelationships",
        "transitionStage",
        "updateRelationship",
        "addEvent",
        "listExclusions",
        "isStale",
    ];
    return {
        RunInProgressError,
        ...Object.fromEntries(
            names.map(name => [
                name,
                (...args: unknown[]) => (mockDb as Record<string, jest.Mock>)[name]!(...args),
            ])
        ),
    };
});

const mockPrepareEmailCampaign = jest.fn();
jest.mock("@launchstack/pipelines/email", () => ({
    prepareEmailCampaign: (...args: unknown[]) => mockPrepareEmailCampaign(...args),
}));

const mockRunFixture = jest.fn();
jest.mock("~/server/distribution/fixture-run", () => ({
    runFixtureDistribution: (...args: unknown[]) => mockRunFixture(...args),
}));

const mockInngestSend = jest.fn();
jest.mock("~/server/inngest/client", () => ({
    inngest: { send: (...args: unknown[]) => mockInngestSend(...args) },
}));

jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: jest.fn(
        async (_request: Request, _config: unknown, handler: () => Promise<unknown>) => handler()
    ),
}));

const mockHasTokens = jest.fn();
jest.mock("~/lib/credits", () => ({ hasTokens: (...args: unknown[]) => mockHasTokens(...args) }));
const mockIsMeteringEnforced = jest.fn();
jest.mock("~/server/deployment", () => ({ isMeteringEnforced: () => mockIsMeteringEnforced() }));
jest.mock("~/server/prospects/metrics", () => ({
    recordRunFinished: jest.fn(),
    recordCandidate: jest.fn(),
}));
jest.mock("~/env", () => ({ env: { server: {} } }));
jest.mock("@launchstack/tools/place-search", () => ({ isPlaceSearchConfigured: () => false }));
jest.mock("@launchstack/tools/trade-data", () => ({ isTradeDataConfigured: () => false }));
jest.mock("@launchstack/tools/compliance-screen", () => ({
    resolveComplianceProvider: () => null,
}));

import { GET as GET_SEGMENTS, POST as POST_SEGMENTS } from "~/app/api/prospects/segments/route";
import { GET as GET_RUNS, POST as POST_RUNS } from "~/app/api/prospects/runs/route";
import { POST as POST_STOP } from "~/app/api/prospects/runs/[id]/stop/route";
import { GET as GET_COMPANIES } from "~/app/api/prospects/companies/route";
import { GET as GET_COMPANY } from "~/app/api/prospects/companies/[id]/route";
import { PATCH as PATCH_DEAL } from "~/app/api/prospects/deals/[id]/route";
import { POST as POST_OUTREACH } from "~/app/api/prospects/outreach/route";

const ctx = {
    success: true,
    data: { authUserId: "user-1", userPk: 7n, companyId: 42n, role: "owner", status: "active" },
};

function req(url: string, method: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${url}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

const program = {
    id: "prog-1",
    companyId: 42n,
    createdByUserId: "user-1",
    name: "EU coffee",
    offering: "Roasted coffee",
    categories: ["coffee"],
    hsCodes: ["0901"],
    targetTerritories: [{ country: "DE" }],
    partnerKinds: ["distributor", "retailer", "wholesaler"],
    constraints: null,
    knownPartnerDomains: ["existing-importer.de"],
    status: "active",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: null,
};

const run = (over: Record<string, unknown> = {}) => ({
    id: "run-1",
    companyId: 42n,
    programId: "prog-1",
    userId: "user-1",
    status: "queued",
    options: { maxCandidates: 25, mode: "keyless" },
    plan: null,
    summary: null,
    candidateOrgIds: null,
    creditsUsed: 0,
    errorMessage: null,
    createdAt: new Date("2026-09-17T09:00:00Z"),
    startedAt: null,
    completedAt: null,
    shortlistedCount: 0,
    enrichedCount: 0,
    cancelRequestedAt: null,
    heartbeatAt: null,
    ...over,
});

const ENV_KEYS = ["OPENAI_API_KEY", "EXA_API_KEY"] as const;

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue(ctx);
    mockIsMeteringEnforced.mockReturnValue(false);
    mockDb.countProgramSummaries.mockResolvedValue(new Map());
    mockDb.listRuns.mockResolvedValue([]);
    mockDb.listExclusions.mockResolvedValue({ domains: [], keys: [] });
    for (const key of ENV_KEYS) delete process.env[key];
});

describe("segments", () => {
    it("returns 401 passthrough when the workspace context fails", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response("no", { status: 401 }),
        });
        const res = await GET_SEGMENTS();
        expect(res.status).toBe(401);
    });

    it("creates a buyer-shaped program from the segment form", async () => {
        mockDb.createProgram.mockResolvedValue(program);
        const res = await POST_SEGMENTS(
            req("/api/prospects/segments", "POST", {
                name: "EU coffee",
                offering: "Roasted coffee",
                industries: ["coffee"],
                countries: ["de"],
            })
        );
        expect(res.status).toBe(201);
        const call = mockDb.createProgram.mock.calls[0]![0] as {
            companyId: bigint;
            input: { partnerKinds: string[]; targetTerritories: Array<{ country: string }> };
        };
        expect(call.companyId).toBe(42n);
        expect(call.input.partnerKinds).toEqual(["distributor", "retailer", "wholesaler"]);
        expect(call.input.targetTerritories).toEqual([{ country: "DE" }]);
        const body = (await res.json()) as { segment: { id: string; counts: { sources: number } } };
        expect(body.segment.id).toBe("prog-1");
        expect(body.segment.counts.sources).toBe(3);
    });

    it("rejects a segment without a country", async () => {
        const res = await POST_SEGMENTS(
            req("/api/prospects/segments", "POST", { name: "x", offering: "y", countries: [] })
        );
        expect(res.status).toBe(400);
        expect(mockDb.createProgram).not.toHaveBeenCalled();
    });
});

describe("runs — one execution path", () => {
    it("queues a keyless run to the worker instead of running it in the request", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.createRun.mockResolvedValue(run());
        const res = await POST_RUNS(req("/api/prospects/runs", "POST", { segmentId: "prog-1" }));
        expect(res.status).toBe(202);
        expect(mockDb.createRun).toHaveBeenCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ mode: "keyless" }) })
        );
        expect(mockInngestSend).toHaveBeenCalledWith({
            name: "distribution/run.requested",
            data: expect.objectContaining({ runId: "run-1", companyId: "42", userId: "user-1" }),
        });
        expect(mockRunFixture).not.toHaveBeenCalled();
        const body = (await res.json()) as { run: { status: string; mode: string } };
        expect(body.run.status).toBe("queued");
        expect(body.run.mode).toBe("keyless");
    });

    it("queues a live run when a model and a search provider are configured", async () => {
        process.env.OPENAI_API_KEY = "sk";
        process.env.EXA_API_KEY = "exa";
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.createRun.mockResolvedValue(run({ options: { maxCandidates: 25, mode: "live" } }));
        const res = await POST_RUNS(req("/api/prospects/runs", "POST", { segmentId: "prog-1" }));
        expect(res.status).toBe(202);
        expect(mockDb.createRun).toHaveBeenCalledWith(
            expect.objectContaining({ options: expect.objectContaining({ mode: "live" }) })
        );
        expect(mockInngestSend).toHaveBeenCalledTimes(1);
    });

    it("runs sample mode inline and never enqueues or checks credits", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.createRun.mockResolvedValue(
            run({ id: "run-fx", options: { maxCandidates: 25, mode: "fixture" } })
        );
        mockDb.getRun.mockResolvedValue(
            run({
                id: "run-fx",
                status: "completed",
                options: { maxCandidates: 25, mode: "fixture" },
                completedAt: new Date("2026-09-17T09:03:00Z"),
            })
        );
        mockIsMeteringEnforced.mockReturnValue(true);
        mockRunFixture.mockResolvedValue({ enriched: 3 });
        const res = await POST_RUNS(
            req("/api/prospects/runs", "POST", { segmentId: "prog-1", sample: true })
        );
        expect(res.status).toBe(201);
        expect(await res.json()).toMatchObject({
            run: { id: "run-fx", status: "completed", mode: "sample" },
        });
        expect(mockInngestSend).not.toHaveBeenCalled();
        expect(mockHasTokens).not.toHaveBeenCalled();
    });

    it("refuses with 402 when metering is enforced and credits are short", async () => {
        process.env.OPENAI_API_KEY = "sk";
        process.env.EXA_API_KEY = "exa";
        mockDb.getProgram.mockResolvedValue(program);
        mockIsMeteringEnforced.mockReturnValue(true);
        mockHasTokens.mockResolvedValue(false);
        const res = await POST_RUNS(req("/api/prospects/runs", "POST", { segmentId: "prog-1" }));
        expect(res.status).toBe(402);
        expect(mockDb.createRun).not.toHaveBeenCalled();
    });

    it("refuses a second run while one is in flight", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        const { RunInProgressError } = jest.requireMock(
            "@launchstack/pipelines/distribution/db"
        );
        mockDb.createRun.mockRejectedValue(new RunInProgressError("prog-1"));
        const res = await POST_RUNS(req("/api/prospects/runs", "POST", { segmentId: "prog-1" }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "run_in_progress" });
        expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("refuses to run an archived segment", async () => {
        mockDb.getProgram.mockResolvedValue({ ...program, status: "archived" });
        const res = await POST_RUNS(req("/api/prospects/runs", "POST", { segmentId: "prog-1" }));
        expect(res.status).toBe(409);
    });

    it("lists runs with the one in flight and the mode the next run will take", async () => {
        mockDb.listRuns.mockResolvedValue([
            run({ status: "enriching", shortlistedCount: 6, enrichedCount: 2 }),
        ]);
        mockDb.findLiveRun.mockResolvedValue(
            run({ status: "enriching", shortlistedCount: 6, enrichedCount: 2 })
        );
        const res = await GET_RUNS(req("/api/prospects/runs?segmentId=prog-1", "GET"));
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            runs: Array<{ progress: { shortlisted: number; profiled: number } | null }>;
            active: { id: string } | null;
            nextMode: string;
        };
        expect(body.runs[0]!.progress).toEqual({ shortlisted: 6, profiled: 2 });
        expect(body.active?.id).toBe("run-1");
        expect(body.nextMode).toBe("keyless");
    });

    it("stop marks the run and refuses when nothing is running", async () => {
        mockDb.requestRunStop.mockResolvedValueOnce(
            run({ status: "enriching", cancelRequestedAt: new Date() })
        );
        const ok = await POST_STOP(req("/api/prospects/runs/run-1/stop", "POST"), {
            params: Promise.resolve({ id: "run-1" }),
        });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toMatchObject({ run: { stopRequested: true } });
        mockDb.requestRunStop.mockResolvedValueOnce(null);
        const gone = await POST_STOP(req("/api/prospects/runs/run-1/stop", "POST"), {
            params: Promise.resolve({ id: "run-1" }),
        });
        expect(gone.status).toBe(409);
    });
});

describe("companies", () => {
    it("asks the database for the page, the count and the view counts", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.listPartners.mockResolvedValue([]);
        mockDb.countPartners.mockResolvedValue(120);
        mockDb.countPartnerViews.mockResolvedValue({
            all: 120,
            new: 3,
            highfit: 10,
            uncontacted: 100,
            excluded: 2,
        });
        const res = await GET_COMPANIES(
            req(
                "/api/prospects/companies?segmentId=prog-1&view=highfit&q=acme&sort=name&limit=25&offset=50",
                "GET"
            )
        );
        expect(res.status).toBe(200);
        const filters = mockDb.listPartners.mock.calls[0]![1] as Record<string, unknown>;
        expect(filters).toMatchObject({
            programId: "prog-1",
            excluded: false,
            minFit: 70,
            search: "acme",
            orderBy: "name",
            limit: 25,
            offset: 50,
        });
        const body = (await res.json()) as {
            total: number;
            nextOffset: number | null;
            counts: { excluded: number };
        };
        expect(body.total).toBe(120);
        expect(body.nextOffset).toBe(75);
        expect(body.counts.excluded).toBe(2);
    });

    it("rejects an unknown view and a missing segment", async () => {
        expect(
            (await GET_COMPANIES(req("/api/prospects/companies?segmentId=prog-1&view=nope", "GET")))
                .status
        ).toBe(400);
        expect((await GET_COMPANIES(req("/api/prospects/companies", "GET"))).status).toBe(400);
    });

    it("returns 404 rather than leaking a company from another workspace", async () => {
        mockDb.getRelationship.mockResolvedValue(null);
        const res = await GET_COMPANY(req("/api/prospects/companies/rel-9", "GET"), {
            params: Promise.resolve({ id: "rel-9" }),
        });
        expect(res.status).toBe(404);
        expect(mockDb.getRelationship).toHaveBeenCalledWith("rel-9", 42n);
    });
});

describe("deals", () => {
    const relationship = {
        id: "rel-1",
        companyId: 42n,
        programId: "prog-1",
        orgId: "org-1",
        kind: "distributor",
        territory: { country: "DE" },
        stage: "candidate",
        fitScore: 80,
        fitRationale: null,
        fitBreakdown: null,
        riskFlags: [],
        screening: null,
        dossier: null,
        ownerUserId: null,
        nextAction: null,
        nextActionAt: null,
        lastActivityAt: null,
        dossierDocumentId: null,
        source: "discovery",
        stageChangedAt: new Date("2026-09-01T00:00:00Z"),
        createdAt: new Date("2026-09-01T00:00:00Z"),
        updatedAt: null,
    };

    it("maps a refused stage move to 409 with the reason in plain words", async () => {
        mockDb.getRelationship.mockResolvedValue(relationship);
        mockDb.getOrg.mockResolvedValue({ id: "org-1", name: "Acme", domain: "acme.de" });
        mockDb.isStale.mockReturnValue(false);
        const err = Object.assign(new Error('Cannot move from "candidate" to "contacted".'), {
            name: "StageTransitionError",
            code: "owner_required",
            status: 409,
        });
        mockDb.transitionStage.mockRejectedValue(err);
        const res = await PATCH_DEAL(
            req("/api/prospects/deals/rel-1", "PATCH", { stage: "contacted" }),
            { params: Promise.resolve({ id: "rel-1" }) }
        );
        expect(res.status).toBe(409);
    });

    it("rejects a malformed patch", async () => {
        const res = await PATCH_DEAL(
            req("/api/prospects/deals/rel-1", "PATCH", { stage: "unicorn" }),
            { params: Promise.resolve({ id: "rel-1" }) }
        );
        expect(res.status).toBe(400);
    });
});

describe("outreach — the worst-failure check", () => {
    const relationship = (id: string, orgId: string, stage = "researched") => ({
        id,
        programId: "prog-1",
        orgId,
        kind: "distributor",
        stage,
        territory: { country: "DE" },
        dossier: {
            summary: "s",
            contactChannels: [
                { channel: "email", value: `import@${orgId}.example`, evidenceIds: [1] },
            ],
        },
    });

    it("never hands an excluded partner to the email vertical, and drafts for the rest", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.listExclusions.mockResolvedValue({
            domains: ["existing-importer.de", "engaged.example"],
            keys: [],
        });
        mockDb.listEvents.mockResolvedValue([]);
        mockDb.getRelationship.mockImplementation(async (id: string) => {
            if (id === "rel-existing") return relationship(id, "existing-importer.de");
            if (id === "rel-engaged") return relationship(id, "engaged.example");
            if (id === "rel-active") return relationship(id, "active.example", "active");
            if (id === "rel-fresh") return relationship(id, "fresh.example");
            return null;
        });
        mockDb.getOrg.mockImplementation(async (orgId: string) => ({
            id: orgId,
            name: orgId,
            domain: orgId,
        }));
        mockPrepareEmailCampaign.mockResolvedValue({
            campaign: { id: 77, status: "pending_approval" },
        });

        const res = await POST_OUTREACH(
            req("/api/prospects/outreach", "POST", {
                companyIds: [
                    "rel-existing",
                    "rel-engaged",
                    "rel-active",
                    "rel-fresh",
                    "rel-missing",
                ],
            })
        );
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
            campaignId: string;
            people: number;
            skipped: Array<{ personId: string; reason: string }>;
        };
        expect(body.campaignId).toBe("77");
        expect(body.people).toBe(1);
        expect(body.skipped.map(s => s.personId).sort()).toEqual([
            "rel-active",
            "rel-engaged",
            "rel-existing",
            "rel-missing",
        ]);
        const call = mockPrepareEmailCampaign.mock.calls[0]![0] as {
            recipients: Array<{ email: string }>;
        };
        expect(call.recipients.map(r => r.email)).toEqual(["import@fresh.example.example"]);
    });

    it("does not draft the same company into two campaigns on one day", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.getRelationship.mockResolvedValue(relationship("rel-fresh", "fresh.example"));
        mockDb.getOrg.mockResolvedValue({
            id: "fresh.example",
            name: "Fresh",
            domain: "fresh.example",
        });
        mockDb.listEvents.mockResolvedValue([
            { type: "note", payload: { campaignId: 5 }, occurredAt: new Date() },
        ]);
        const res = await POST_OUTREACH(
            req("/api/prospects/outreach", "POST", { companyIds: ["rel-fresh"] })
        );
        expect(res.status).toBe(409);
        expect(mockPrepareEmailCampaign).not.toHaveBeenCalled();
        expect(await res.json()).toMatchObject({
            skipped: [{ personId: "rel-fresh", reason: expect.stringContaining("today") }],
        });
    });
});
