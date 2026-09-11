/**
 * Distribution API route tests. External dependencies (workspace context,
 * the vertical's db helpers, Inngest, rate limiting, credits) are mocked so
 * each handler is exercised in isolation.
 *
 * The outreach test is the "check that catches the worst failure" (design
 * §8): a relationship whose organisation is on the program's exclusion list
 * must never become a campaign recipient.
 */
import { NextRequest } from "next/server";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

const mockDb = {
    createProgram: jest.fn(),
    listPrograms: jest.fn(),
    getProgram: jest.fn(),
    updateProgram: jest.fn(),
    createRun: jest.fn(),
    getRun: jest.fn(),
    listRuns: jest.fn(),
    listPartners: jest.fn(),
    getRelationship: jest.fn(),
    getOrg: jest.fn(),
    listEvidenceForOrg: jest.fn(),
    listEvents: jest.fn(),
    listAgreements: jest.fn(),
    transitionStage: jest.fn(),
    updateRelationship: jest.fn(),
    addEvent: jest.fn(),
    listExclusions: jest.fn(),
    importPartners: jest.fn(),
    getDashboard: jest.fn(),
    createAgreement: jest.fn(),
    updateAgreement: jest.fn(),
};
// Closures defer the mockDb access to call time: imports are hoisted above
// the const, so a direct reference would hit the temporal dead zone.
jest.mock("@launchstack/pipelines/distribution/db", () => {
    const names = [
        "createProgram",
        "listPrograms",
        "getProgram",
        "updateProgram",
        "createRun",
        "getRun",
        "listRuns",
        "listPartners",
        "getRelationship",
        "getOrg",
        "listEvidenceForOrg",
        "listEvents",
        "listAgreements",
        "transitionStage",
        "updateRelationship",
        "addEvent",
        "listExclusions",
        "importPartners",
        "getDashboard",
        "createAgreement",
        "updateAgreement",
    ];
    return Object.fromEntries(
        names.map(name => [
            name,
            (...args: unknown[]) => (mockDb as Record<string, jest.Mock>)[name]!(...args),
        ])
    );
});

const mockPrepareEmailCampaign = jest.fn();
jest.mock("@launchstack/pipelines/email", () => ({
    prepareEmailCampaign: (...args: unknown[]) => mockPrepareEmailCampaign(...args),
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

import { POST as POST_PROGRAMS, GET as GET_PROGRAMS } from "~/app/api/distribution/programs/route";
import { POST as POST_RUNS } from "~/app/api/distribution/runs/route";
import { GET as GET_PARTNER } from "~/app/api/distribution/partners/[id]/route";
import { PATCH as PATCH_RELATIONSHIP } from "~/app/api/distribution/relationships/[id]/route";
import { POST as POST_OUTREACH } from "~/app/api/distribution/outreach/route";
import { POST as POST_IMPORT } from "~/app/api/distribution/import/route";

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
    partnerKinds: ["importer"],
    constraints: null,
    knownPartnerDomains: ["existing-importer.de"],
    status: "active",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue(ctx);
    mockIsMeteringEnforced.mockReturnValue(false);
});

describe("programs", () => {
    it("creates a program from a valid body and serialises bigint", async () => {
        mockDb.createProgram.mockResolvedValue(program);
        const res = await POST_PROGRAMS(
            req("/api/distribution/programs", "POST", {
                name: "EU coffee",
                offering: "Roasted coffee",
                targetTerritories: [{ country: "de" }],
                partnerKinds: ["importer"],
            })
        );
        expect(res.status).toBe(201);
        const body = (await res.json()) as { program: { companyId: string; id: string } };
        expect(body.program.id).toBe("prog-1");
        expect(body.program.companyId).toBe("42");
        expect(mockDb.createProgram).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: 42n, userId: "user-1" })
        );
        // Country code was upper-cased by the schema.
        expect(mockDb.createProgram.mock.calls[0]![0].input.targetTerritories).toEqual([
            { country: "DE" },
        ]);
    });

    it("rejects a program without territories or kinds", async () => {
        const res = await POST_PROGRAMS(
            req("/api/distribution/programs", "POST", {
                name: "x",
                offering: "y",
                targetTerritories: [],
                partnerKinds: [],
            })
        );
        expect(res.status).toBe(400);
        expect(mockDb.createProgram).not.toHaveBeenCalled();
    });

    it("returns 401 passthrough when the workspace context fails", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response("no", { status: 401 }),
        });
        const res = await GET_PROGRAMS();
        expect(res.status).toBe(401);
    });
});

describe("runs", () => {
    it("creates a run row and sends the event with a string companyId", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.createRun.mockResolvedValue({ id: "run-1", status: "queued", companyId: 42n });
        const res = await POST_RUNS(
            req("/api/distribution/runs", "POST", {
                programId: "prog-1",
                options: { maxCandidates: 5 },
            })
        );
        expect(res.status).toBe(202);
        expect(mockDb.createRun).toHaveBeenCalledWith(
            expect.objectContaining({
                programId: "prog-1",
                options: expect.objectContaining({ maxCandidates: 5 }),
            })
        );
        expect(mockInngestSend).toHaveBeenCalledWith({
            name: "distribution/run.requested",
            data: expect.objectContaining({
                runId: "run-1",
                programId: "prog-1",
                companyId: "42",
                userId: "user-1",
            }),
        });
    });

    it("refuses with 402 when metering is enforced and credits are short", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockIsMeteringEnforced.mockReturnValue(true);
        mockHasTokens.mockResolvedValue(false);
        const res = await POST_RUNS(req("/api/distribution/runs", "POST", { programId: "prog-1" }));
        expect(res.status).toBe(402);
        expect(mockDb.createRun).not.toHaveBeenCalled();
        expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it("refuses to run an archived program", async () => {
        mockDb.getProgram.mockResolvedValue({ ...program, status: "archived" });
        const res = await POST_RUNS(req("/api/distribution/runs", "POST", { programId: "prog-1" }));
        expect(res.status).toBe(409);
    });
});

describe("partners", () => {
    it("returns 404 rather than leaking a relationship from another company", async () => {
        mockDb.getRelationship.mockResolvedValue(null);
        const res = await GET_PARTNER(req("/api/distribution/partners/rel-9", "GET"), {
            params: Promise.resolve({ id: "rel-9" }),
        });
        expect(res.status).toBe(404);
        expect(mockDb.getRelationship).toHaveBeenCalledWith("rel-9", 42n);
    });
});

describe("relationship transitions", () => {
    it("maps an illegal stage move to 409 with the code", async () => {
        mockDb.getRelationship.mockResolvedValue({
            id: "rel-1",
            stage: "candidate",
            ownerUserId: null,
            nextAction: null,
            nextActionAt: null,
        });
        const err = Object.assign(new Error('Cannot move from "candidate" to "qualified".'), {
            code: "transition_not_allowed",
            status: 409,
        });
        mockDb.transitionStage.mockRejectedValue(err);
        const res = await PATCH_RELATIONSHIP(
            req("/api/distribution/relationships/rel-1", "PATCH", { stage: "qualified" }),
            { params: Promise.resolve({ id: "rel-1" }) }
        );
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "transition_not_allowed" });
    });

    it("rejects an empty patch", async () => {
        const res = await PATCH_RELATIONSHIP(
            req("/api/distribution/relationships/rel-1", "PATCH", {}),
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
        kind: "importer",
        stage,
        territory: { country: "DE" },
        dossier: {
            summary: "s",
            contactChannels: [
                { channel: "email", value: `import@${orgId}.example`, evidenceIds: [1] },
            ],
        },
    });

    it("never hands an excluded (existing) partner to the email vertical, and drafts for the rest", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.listExclusions.mockResolvedValue({
            domains: ["existing-importer.de", "engaged.example"],
            keys: [],
        });
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
            req("/api/distribution/outreach", "POST", {
                programId: "prog-1",
                relationshipIds: [
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
            campaignId: number;
            included: string[];
            skipped: Array<{ relationshipId: string; reason: string }>;
        };
        expect(body.campaignId).toBe(77);
        expect(body.included).toEqual(["rel-fresh"]);
        expect(body.skipped.map(s => s.relationshipId).sort()).toEqual([
            "rel-active",
            "rel-engaged",
            "rel-existing",
            "rel-missing",
        ]);

        const call = mockPrepareEmailCampaign.mock.calls[0]![0] as {
            recipients: Array<{ email: string }>;
        };
        expect(call.recipients.map(r => r.email)).toEqual(["import@fresh.example.example"]);
        expect(call.recipients.some(r => r.email.includes("existing-importer"))).toBe(false);
    });

    it("returns 422 and creates nothing when every candidate is excluded", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.listExclusions.mockResolvedValue({ domains: ["existing-importer.de"], keys: [] });
        mockDb.getRelationship.mockResolvedValue(
            relationship("rel-existing", "existing-importer.de")
        );
        mockDb.getOrg.mockResolvedValue({
            id: "existing-importer.de",
            name: "Existing",
            domain: "existing-importer.de",
        });
        const res = await POST_OUTREACH(
            req("/api/distribution/outreach", "POST", {
                programId: "prog-1",
                relationshipIds: ["rel-existing"],
            })
        );
        expect(res.status).toBe(422);
        expect(mockPrepareEmailCampaign).not.toHaveBeenCalled();
    });
});

describe("import", () => {
    it("validates rows and forwards them with the workspace's company", async () => {
        mockDb.getProgram.mockResolvedValue(program);
        mockDb.importPartners.mockResolvedValue({ created: 2, existing: 0, relationships: [] });
        const res = await POST_IMPORT(
            req("/api/distribution/import", "POST", {
                programId: "prog-1",
                rows: [
                    { name: "A", domain: "a.example", country: "DE", kind: "importer" },
                    { name: "B", kind: "retailer", territoryCountry: "nl" },
                ],
            })
        );
        expect(res.status).toBe(201);
        expect(mockDb.importPartners).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: 42n, programId: "prog-1", userId: "user-1" })
        );
        const bad = await POST_IMPORT(
            req("/api/distribution/import", "POST", {
                programId: "prog-1",
                rows: [{ name: "A", kind: "unicorn" }],
            })
        );
        expect(bad.status).toBe(400);
    });
});
