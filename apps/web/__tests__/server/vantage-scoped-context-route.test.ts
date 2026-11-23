jest.mock("~/server/vantage/weekly-review-service", () => ({
    weeklyReviewEnabled: jest.fn(() => true),
    weeklyReviewDatabase: { transaction: jest.fn() },
    weeklyReviewServices: jest.fn(),
}));
jest.mock("~/app/api/vantage/reviews/_http", () => ({
    reviewActor: jest.fn(),
    reviewError: jest.fn((error: { code?: string; status?: number }) =>
        Response.json({ error: error.code }, { status: error.status ?? 500 })
    ),
}));
import { GET, POST, PATCH } from "~/app/api/vantage/reviews/context/route";
import { reviewActor } from "~/app/api/vantage/reviews/_http";
import {
    createWeeklyReviewAuthority,
    type WeeklyReviewAuthorityActor,
} from "~/server/vantage/weekly-review-authority";
import {
    weeklyReviewEnabled,
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
    jest.mocked(weeklyReviewEnabled).mockReturnValue(true);
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

describe("context metadata authorization (offline)", () => {
    const hiddenScope = {
        ...scope,
        qualification: "Private qualification",
        expectedParentHash: "c".repeat(64),
        requiredUnits: [{ id: "private-unit", start: 6, end: 9, excerptHash: "d".repeat(64) }],
    };
    function setupRead(canConfigure: boolean, readableIds: string[], legacy = false) {
        setup();
        let currentActor: WeeklyReviewAuthorityActor = {
            companyId: "1",
            userId: "actor",
            role: "member",
            canRead: true,
            canMutate: true,
            canConfigure,
            documentScope: {
                kind: "only",
                allowedCategories: [],
                deniedDocumentIds: [],
                allowedDocumentIds: readableIds.map(Number),
            },
        };
        let onLock = async () => {};
        jest.mocked(reviewActor).mockResolvedValue({
            ok: true,
            actor: { companyId: "1", userId: "actor" },
            ctx: { can: () => canConfigure },
        } as never);
        jest.mocked(weeklyReviewServices).mockReturnValue({
            authority: createWeeklyReviewAuthority(weeklyReviewDatabase, async () => currentActor),
        } as unknown as ReturnType<typeof weeklyReviewServices>);
        jest.mocked(weeklyReviewDatabase.transaction).mockImplementation(async work =>
            work(async sql => {
                if (sql.includes("FOR SHARE")) {
                    await onLock();
                    return [{ version: 1 }];
                }
                if (sql.includes("SELECT id,title,category"))
                    return ["1", "2", "3"].map(id => ({
                        id,
                        title: "Readable document " + id,
                        category: "",
                    }));
                if (sql.includes("weekly_review_policy"))
                    return [
                        {
                            architecture_document_id: "1",
                            required_document_ids: ["2", "3"],
                            ...(!legacy && {
                                required_source_scopes: { "1": scope, "2": hiddenScope },
                            }),
                            version: 2,
                        },
                    ];
                if (sql.includes("weekly_review_preferences"))
                    return [
                        {
                            star_document_ids: ["1", "2"],
                            ...(!legacy && {
                                star_source_scopes: { "1": scope, "2": hiddenScope },
                            }),
                            version: 3,
                        },
                    ];
                return [];
            })
        );
        return {
            setActor: (actor: WeeklyReviewAuthorityActor) => {
                currentActor = actor;
            },
            actor: currentActor,
            atLock: (callback: () => Promise<void>) => {
                onLock = callback;
            },
        };
    }
    beforeEach(() => jest.clearAllMocks());
    it.each([true, false])(
        "hides all metadata for an unreadable source with flags=%s",
        async enabled => {
            setupRead(false, []);
            jest.mocked(weeklyReviewEnabled).mockReturnValue(enabled);
            const response = await GET();
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                documents: [],
                enabled,
                scopedEvidenceEnabled: true,
                canConfigure: false,
                policy: null,
                preferences: {
                    star_document_ids: [],
                    star_source_scopes: {},
                    version: 3,
                    hasHiddenSources: true,
                },
            });
        }
    );
    it("hides administrative metadata from readable non-configurators", async () => {
        setupRead(false, ["1", "2"]);
        const body = await (await GET()).json();
        expect(body.policy).toBeNull();
        expect(body.preferences.star_source_scopes).toEqual({ "1": scope, "2": hiddenScope });
    });
    it.each([true, false])(
        "filters configurator policy and personal scopes by current readability with flags=%s",
        async enabled => {
            setupRead(true, ["1", "3"]);
            jest.mocked(weeklyReviewEnabled).mockReturnValue(enabled);
            const body = await (await GET()).json();
            expect(body.policy).toEqual({
                architecture_document_id: "1",
                required_document_ids: ["3"],
                required_source_scopes: { "1": scope },
                version: 2,
                hasHiddenSources: true,
            });
            expect(body.preferences).toEqual({
                star_document_ids: ["1"],
                star_source_scopes: { "1": scope },
                version: 3,
                hasHiddenSources: true,
            });
            expect(JSON.stringify(body)).not.toContain("Private qualification");
            expect(JSON.stringify(body)).not.toContain(hiddenScope.expectedParentHash);
            expect(JSON.stringify(body)).not.toContain(hiddenScope.requiredUnits[0]!.excerptHash);
        }
    );
    it("hides an unreadable architecture ID and retains readable legacy configuration", async () => {
        setupRead(true, ["3"], true);
        const body = await (await GET()).json();
        expect(body.policy).toEqual({
            architecture_document_id: null,
            required_document_ids: ["3"],
            required_source_scopes: {},
            version: 2,
            hasHiddenSources: true,
        });
        expect(body.preferences).toEqual({
            star_document_ids: [],
            star_source_scopes: {},
            version: 3,
            hasHiddenSources: true,
        });
    });
    it("keeps absent configuration rows null", async () => {
        setupRead(true, ["1"]);
        jest.mocked(weeklyReviewDatabase.transaction).mockImplementation(async work =>
            work(async sql => (sql.includes("FOR SHARE") ? [{ version: 1 }] : []))
        );
        const body = await (await GET()).json();
        expect(body.policy).toBeNull();
        expect(body.preferences).toBeNull();
    });
    it("reports fully readable configuration without hidden entries", async () => {
        setupRead(true, ["1", "2", "3"]);
        const body = await (await GET()).json();
        expect(body.policy.hasHiddenSources).toBe(false);
        expect(body.preferences.hasHiddenSources).toBe(false);
    });
    it("uses fresh configurator capability after the authority barrier", async () => {
        const f = setupRead(true, ["1", "2", "3"]);
        f.atLock(async () => {
            f.setActor({ ...f.actor, canConfigure: false });
        });
        const body = await (await GET()).json();
        expect(body.canConfigure).toBe(false);
        expect(body.policy).toBeNull();
    });
    it("rejects a reader revoked while waiting at the authority barrier", async () => {
        const f = setupRead(true, ["1", "2", "3"]);
        f.atLock(async () => {
            f.setActor({ ...f.actor, canRead: false });
        });
        const response = await GET();
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "review_access_denied" });
    });
    it("uses fresh source ACL after the authority barrier and reads metadata in that transaction", async () => {
        const f = setupRead(true, ["1", "2", "3"]);
        f.atLock(async () => {
            f.setActor({
                ...f.actor,
                documentScope: {
                    kind: "only",
                    allowedCategories: [],
                    deniedDocumentIds: [],
                    allowedDocumentIds: [],
                },
            });
        });
        const body = await (await GET()).json();
        expect(body.documents).toEqual([]);
        expect(body.policy.required_source_scopes).toEqual({});
        expect(body.preferences.star_source_scopes).toEqual({});
        expect(body.policy.architecture_document_id).toBeNull();
        expect(body.policy.hasHiddenSources).toBe(true);
        expect(weeklyReviewDatabase.transaction).toHaveBeenCalledTimes(1);
    });
});
