jest.mock("~/server/vantage/weekly-review-service", () => ({
    weeklyReviewEnabled: jest.fn(() => true),
    scopedEvidenceV2Enabled: jest.fn(() => true),
    weeklyReviewDatabase: { transaction: jest.fn() },
    weeklyReviewServices: jest.fn(),
}));
jest.mock("~/app/api/vantage/reviews/_http", () => ({
    reviewActor: jest.fn(),
    reviewError: jest.fn((error: { code?: string; status?: number }) =>
        Response.json({ error: error.code }, { status: error.status ?? 500 })
    ),
}));
import { POST, PATCH } from "~/app/api/vantage/reviews/context/route";
import { reviewActor } from "~/app/api/vantage/reviews/_http";
import {
    scopedEvidenceV2Enabled,
    weeklyReviewDatabase,
    weeklyReviewServices,
} from "~/server/vantage/weekly-review-service";

const scope = {
    version: "10",
    expectedParentHash: "a".repeat(64),
    qualification: "Approved relevant spans",
    requiredUnits: [{ id: "unit", start: 0, end: 5, excerptHash: "b".repeat(64) }],
};
function setup() {
    const writes: unknown[][] = [];
    const validateCompanySources = jest.fn(async () => []);
    const validatePreferenceSources = jest.fn(async () => []);
    jest.mocked(weeklyReviewServices).mockReturnValue({
        authority: { validateCompanySources, validatePreferenceSources },
    } as unknown as ReturnType<typeof weeklyReviewServices>);
    jest.mocked(reviewActor).mockResolvedValue({
        ok: true,
        actor: { companyId: "1", userId: "actor" },
        ctx: { can: () => true },
    } as never);
    jest.mocked(scopedEvidenceV2Enabled).mockReturnValue(true);
    jest.mocked(weeklyReviewDatabase.transaction).mockImplementation(async work =>
        work(async (sql, params = []) => {
            if (sql.includes("SELECT version,required_source_scopes"))
                return [{ version: 2, required_source_scopes: { "1": scope, "2": scope } }];
            if (sql.includes("SELECT version,star_source_scopes"))
                return [{ version: 2, star_source_scopes: { "1": scope, "2": scope } }];
            if (
                sql.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_policy") ||
                sql.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_preferences")
            ) {
                writes.push(params);
                return [{ version: 3 }];
            }
            return [];
        })
    );
    return { writes, validateCompanySources, validatePreferenceSources };
}
const request = (body: unknown) =>
    new Request("http://localhost/api/vantage/reviews/context", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
    });
describe("scoped context configuration routes (offline)", () => {
    beforeEach(() => jest.clearAllMocks());
    it("preserves surviving company scopes on an ID-only save and drops removed IDs", async () => {
        const f = setup();
        const response = await POST(
            request({ expectedVersion: 2, architectureDocumentId: "1", requiredDocumentIds: [] })
        );
        expect(response.status).toBe(200);
        expect(f.validateCompanySources).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Object),
            "1",
            [],
            { "1": scope }
        );
        expect(JSON.parse(String(f.writes[0]![4]))).toEqual({ "1": scope });
    });
    it("preserves surviving personal scopes when the field is omitted", async () => {
        const f = setup();
        const response = await PATCH(request({ expectedVersion: 2, starDocumentIds: ["1"] }));
        expect(response.status).toBe(200);
        expect(f.validatePreferenceSources).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Object),
            ["1"],
            { "1": scope }
        );
        expect(JSON.parse(String(f.writes[0]![4]))).toEqual({ "1": scope });
    });
    it("rejects scopes for IDs outside the pending configuration", async () => {
        const f = setup();
        const response = await POST(
            request({
                expectedVersion: 2,
                architectureDocumentId: "1",
                requiredDocumentIds: [],
                requiredSourceScopes: { "2": scope },
            })
        );
        expect(response.status).toBe(400);
        expect(f.writes).toHaveLength(0);
        expect(f.validateCompanySources).not.toHaveBeenCalled();
    });
    it("requires the scoped feature for new explicit scopes", async () => {
        const f = setup();
        jest.mocked(scopedEvidenceV2Enabled).mockReturnValue(false);
        const response = await PATCH(
            request({
                expectedVersion: 2,
                starDocumentIds: ["1"],
                starSourceScopes: { "1": scope },
            })
        );
        expect(response.status).toBe(404);
        expect(f.writes).toHaveLength(0);
    });
    it("checks settings.manage before a company scope update", async () => {
        const f = setup();
        jest.mocked(reviewActor).mockResolvedValue({
            ok: true,
            actor: { companyId: "1", userId: "actor" },
            ctx: { can: () => false },
        } as never);
        const response = await POST(
            request({
                expectedVersion: 2,
                architectureDocumentId: "1",
                requiredDocumentIds: [],
                requiredSourceScopes: { "1": scope },
            })
        );
        expect(response.status).toBe(403);
        expect(f.writes).toHaveLength(0);
        expect(f.validateCompanySources).not.toHaveBeenCalled();
    });
});
