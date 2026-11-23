jest.mock("~/server/vantage/weekly-review-service", () => ({
    weeklyReviewDatabase: { transaction: jest.fn() },
    weeklyReviewServices: jest.fn(),
    weeklyReviewEnabled: jest.fn(() => false),
}));
jest.mock("~/app/api/vantage/reviews/_http", () => ({
    reviewActor: jest.fn(),
    reviewError: jest.fn((error: { code?: string; status?: number }) =>
        Response.json({ error: error.code }, { status: error.status ?? 500 })
    ),
}));
import {
    compileScopedEvidence,
    hashScopedText,
} from "@launchstack/pipelines/vantage/scoped-evidence";
import { GET as evidenceGET } from "~/app/api/vantage/reviews/[id]/evidence/route";
import { GET as sourceGET } from "~/app/api/vantage/reviews/context/source/route";
import { PATCH } from "~/app/api/vantage/reviews/context/route";
import { reviewActor } from "~/app/api/vantage/reviews/_http";
import {
    weeklyReviewDatabase,
    weeklyReviewServices,
    weeklyReviewEnabled,
} from "~/server/vantage/weekly-review-service";
import { inspectContextSource } from "~/server/vantage/weekly-review-evidence-inspection";
import { WeeklyReviewConflict, type WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";
import type { WeeklyReviewAuthorityActor } from "~/server/vantage/weekly-review-authority";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-11-01T00:00:00.000Z";
const text = "Exact frozen excerpt and remaining canonical text";
const scope = {
    version: "10",
    expectedParentHash: hashScopedText(text),
    qualification: "Selected evidence",
    requiredUnits: [{ id: "u", start: 0, end: 20, excerptHash: hashScopedText(text.slice(0, 20)) }],
};
const prepared = compileScopedEvidence(
    {
        actorId: "actor",
        companyId: "1",
        documentId: "7",
        version: "10",
        asOf: at,
        expectedParentHash: hashScopedText(text),
        selectedUnitIds: ["u"],
    },
    {
        companyId: "1",
        documentId: "7",
        version: "10",
        versionDate: at,
        availableAt: at,
        title: "Original title",
        purpose: "personal-star",
        chunks: [{ id: "c", ordinal: 0, text }],
        originalCompleteness: "unknown",
    },
    {
        actorId: "actor",
        companyId: "1",
        documentId: "7",
        version: "10",
        authorized: true,
        purpose: "personal-star",
        audience: "actor",
        companyReadable: false,
        aclRevision: "1",
        authorityRevision: "1",
        finiteScope: { qualification: scope.qualification, requiredUnits: scope.requiredUnits },
    }
);
const frozen = {
    inputSnapshot: {
        scopedEvidence: [prepared.dependency],
        sources: prepared.modelFacingProjection.sources,
    },
};
const source = prepared.modelFacingProjection.sources[0]!;
const actor: WeeklyReviewAuthorityActor = {
    companyId: "1",
    userId: "actor",
    role: "owner",
    canRead: true,
    canMutate: true,
    canConfigure: true,
    documentScope: { kind: "everything" },
};
function auth(current = actor) {
    jest.mocked(reviewActor).mockResolvedValue({
        ok: true,
        actor: { companyId: current.companyId, userId: current.userId },
        ctx: {
            role: current.role,
            can: (permission: string) =>
                permission === "settings.manage"
                    ? current.canConfigure
                    : permission === "documents.edit"
                      ? current.canMutate
                      : current.canRead,
            documentScope: async () => current.documentScope,
        },
    } as never);
}
const evidenceRequest = (ref = source.ref) =>
    new Request(
        `http://localhost/api/vantage/reviews/${id}/evidence?ref=${encodeURIComponent(ref)}`
    );
describe("authorized frozen evidence inspection (offline)", () => {
    const get = jest.fn();
    beforeEach(() => {
        jest.clearAllMocks();
        auth();
        get.mockResolvedValue({ evidence: frozen });
        jest.mocked(weeklyReviewServices).mockReturnValue({ repository: { get } } as never);
    });
    it("returns exact stored excerpt and proof with creation flags off", async () => {
        const response = await evidenceGET(evidenceRequest(), { params: Promise.resolve({ id }) });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.text).toBe(text.slice(0, 20));
        expect(body.version).toBe("10");
        expect(body.scope).toMatchObject({
            parentVersion: "10",
            parentHash: scope.expectedParentHash,
            start: 0,
            end: 20,
            anchors: prepared.dependency.units[0]!.anchors,
        });
        expect(body.originalCompleteness).toBe("unknown");
        expect(get).toHaveBeenCalledWith({ companyId: "1", userId: "actor" }, id);
        expect(weeklyReviewDatabase.transaction).not.toHaveBeenCalled();
    });
    it.each(["source_access_denied", "review_not_found"])(
        "preserves repository denial %s before evidence disclosure",
        async code => {
            get.mockRejectedValue(new WeeklyReviewConflict(code, 403));
            const response = await evidenceGET(evidenceRequest(), {
                params: Promise.resolve({ id }),
            });
            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({ error: code });
        }
    );
    it("rejects unknown refs and versions instead of resolving source heads", async () => {
        const response = await evidenceGET(evidenceRequest("doc:7@11"), {
            params: Promise.resolve({ id }),
        });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "evidence_not_found" });
    });
    it("rejects malformed requests before repository access", async () => {
        const response = await evidenceGET(evidenceRequest(), {
            params: Promise.resolve({ id: "invalid" }),
        });
        expect(response.status).toBe(400);
        expect(get).not.toHaveBeenCalled();
    });
    it("returns unavailable for legacy records without a frozen snapshot", async () => {
        get.mockResolvedValue({ evidence: {} });
        const response = await evidenceGET(evidenceRequest(), { params: Promise.resolve({ id }) });
        expect(response.status).toBe(409);
    });
    it("rejects inconsistent frozen proof", async () => {
        get.mockResolvedValue({
            evidence: {
                inputSnapshot: { ...frozen.inputSnapshot, sources: [{ ...source, version: "11" }] },
            },
        });
        expect(
            (await evidenceGET(evidenceRequest(), { params: Promise.resolve({ id }) })).status
        ).toBe(409);
    });
});

function databaseFixture(
    options: {
        document?: boolean;
        restricted?: boolean;
        missingPin?: boolean;
        tooManyChunks?: boolean;
        oversized?: boolean;
        changed?: boolean;
        noPin?: boolean;
        raceOversized?: boolean;
    } = {}
) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const query: WeeklyReviewQuery = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("set_config") || sql.startsWith("INSERT")) return [];
        if (sql.includes("FOR SHARE")) return [{ version: 1 }];
        if (sql.includes("FROM pdr_ai_v2_document WHERE"))
            return options.document === false
                ? []
                : [{ id: "7", title: "Current readable title", category: "Finance" }];
        if (sql.includes("document_settings")) return options.restricted ? [{ restricted: 1 }] : [];
        if (sql.includes("weekly_review_preferences"))
            return [
                {
                    star_document_ids: ["7"],
                    star_source_scopes: options.noPin ? {} : { "7": scope },
                    version: 3,
                },
            ];
        if (sql.includes("weekly_review_policy"))
            return [
                {
                    architecture_document_id: "7",
                    required_document_ids: ["7"],
                    required_source_scopes: { "7": scope },
                    version: 2,
                },
            ];
        if (sql.includes("SELECT id FROM pdr_ai_v2_document_versions"))
            return params[1] === "99" || (options.missingPin && params[1] === "10")
                ? []
                : [{ id: params[1] }];
        if (sql.includes("AS chunk_count"))
            return [
                {
                    chunk_count: options.tooManyChunks ? 1025 : 1,
                    text_bytes: options.oversized ? 128001 : Buffer.byteLength(text),
                },
            ];
        if (sql.startsWith("SELECT id,CASE WHEN count"))
            return [
                {
                    id: "c",
                    content: options.raceOversized
                        ? null
                        : options.changed
                          ? text.replace("Exact", "Other")
                          : text,
                },
            ];
        if (sql.includes("SELECT id,created_at"))
            return [
                { id: "11", created_at: at },
                { id: "10", created_at: at },
            ];
        throw Error("Unexpected query " + sql);
    });
    jest.mocked(weeklyReviewDatabase.transaction).mockImplementation(async work => work(query));
    return { query, calls };
}
const inspect = (
    current = actor,
    version?: string,
    purpose: "personal-star" | "company-architecture" = "personal-star"
) =>
    inspectContextSource(weeklyReviewDatabase, actor, async () => current, {
        documentId: "7",
        purpose,
        ...(version ? { version } : {}),
    });
describe("exact source pin inspection (offline)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auth();
    });
    it("keeps deleted pin visible and permits explicit new-version preview", async () => {
        const f = databaseFixture({ missingPin: true });
        const missing = await inspect();
        expect(missing.pin).toEqual({ status: "missing_version", scope });
        expect(missing.preview).toBeNull();
        expect(missing.versions[0]!.version).toBe("11");
        expect(f.calls.some(call => call.sql.startsWith("SELECT id,CASE WHEN count"))).toBe(false);
        const replacement = await inspect(actor, "11");
        expect(replacement.pin?.status).toBe("missing_version");
        expect(replacement.preview).toMatchObject({
            version: "11",
            text,
            parentHash: hashScopedText(text),
            originalCompleteness: "unknown",
            offsetEncoding: "utf16_half_open",
        });
    });
    it("uses pinned exact version even when a newer head exists", async () => {
        const f = databaseFixture();
        const result = await inspect();
        expect(result.pin?.status).toBe("valid");
        expect(result.preview?.version).toBe("10");
        expect(
            f.calls
                .filter(call => call.sql.startsWith("SELECT id,CASE WHEN count"))
                .map(call => call.params[1])
        ).toEqual(["10"]);
    });
    it("keeps ID-only configuration unpinned without selecting latest", async () => {
        databaseFixture({ noPin: true });
        const result = await inspect();
        expect(result.pin).toBeNull();
        expect(result.preview).toBeNull();
    });
    it("rejects an unavailable explicit version", async () => {
        databaseFixture();
        await expect(inspect(actor, "99")).rejects.toMatchObject({
            code: "source_version_unavailable",
        });
    });
    it.each([false, true])(
        "checks ACL before pin/version metadata for inaccessible or outside-company source (%s)",
        async outsideCompany => {
            const f = databaseFixture({ document: !outsideCompany });
            const denied = {
                ...actor,
                documentScope: {
                    kind: "only" as const,
                    allowedCategories: [],
                    deniedDocumentIds: [],
                    allowedDocumentIds: [],
                },
            };
            await expect(inspect(denied)).rejects.toMatchObject({
                code: "source_access_denied",
                status: 403,
            });
            expect(
                f.calls.some(call =>
                    /weekly_review_preferences|document_versions|context_chunks/.test(call.sql)
                )
            ).toBe(false);
        }
    );
    it.each(["canRead", "canMutate", "canConfigure"] as const)(
        "requires current %s permission for administrative preview",
        async permission => {
            const f = databaseFixture();
            await expect(
                inspect({ ...actor, [permission]: false }, undefined, "company-architecture")
            ).rejects.toMatchObject({ status: 403 });
            expect(f.calls.some(call => call.sql.includes("document_versions"))).toBe(false);
        }
    );
    it("keeps required context company-readable and permits own restricted personal preview", async () => {
        databaseFixture({ restricted: true });
        await expect(inspect(actor, undefined, "company-architecture")).rejects.toMatchObject({
            code: "required_context_audience",
        });
        const result = await inspect({ ...actor, canConfigure: false });
        expect(result.pin?.status).toBe("valid");
    });
    it.each([{ oversized: true }, { tooManyChunks: true }])(
        "bounds acquisition before body transfer %j",
        async options => {
            const f = databaseFixture(options);
            const result = await inspect();
            expect(result.pin?.status).toBe("unavailable");
            expect(result.preview).toBeNull();
            expect(f.calls.some(call => call.sql.startsWith("SELECT id,CASE WHEN count"))).toBe(
                false
            );
        }
    );
    it("rechecks the body-query bound after a concurrent replacement", async () => {
        databaseFixture({ raceOversized: true });
        expect((await inspect()).pin?.status).toBe("unavailable");
    });
    it("reports changed canonical content without silently reapproving", async () => {
        databaseFixture({ changed: true });
        expect((await inspect()).pin?.status).toBe("content_changed");
    });
    it("validates source route inputs before database access", async () => {
        const response = await sourceGET(
            new Request(
                "http://localhost/api/vantage/reviews/context/source?documentId=7&purpose=personal-star&version=latest"
            )
        );
        expect(response.status).toBe(400);
        expect(weeklyReviewDatabase.transaction).not.toHaveBeenCalled();
    });
    it("reconstructs current actor inside the epoch transaction with flags off", async () => {
        databaseFixture({ missingPin: true });
        const response = await sourceGET(
            new Request(
                "http://localhost/api/vantage/reviews/context/source?documentId=7&purpose=personal-star"
            )
        );
        expect(response.status).toBe(200);
        expect(reviewActor).toHaveBeenCalledTimes(2);
        expect((await response.json()).pin.status).toBe("missing_version");
    });
});

describe("same-document invalid pin recovery uses normal mutation validation (offline)", () => {
    const validatePreferenceSources = jest.fn();
    const writes: unknown[][] = [];
    beforeEach(() => {
        jest.clearAllMocks();
        auth();
        writes.length = 0;
        jest.mocked(weeklyReviewEnabled).mockReturnValue(true);
        validatePreferenceSources.mockResolvedValue([]);
        jest.mocked(weeklyReviewServices).mockReturnValue({
            authority: { validatePreferenceSources },
        } as never);
        jest.mocked(weeklyReviewDatabase.transaction).mockImplementation(async work =>
            work(async (sql, params = []) => {
                if (sql.startsWith("SELECT version,star_source_scopes"))
                    return [{ version: 3, star_source_scopes: { "7": scope } }];
                if (sql.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_preferences")) {
                    writes.push(params);
                    return [{ version: 4 }];
                }
                return [];
            })
        );
    });
    const save = (starSourceScopes: unknown, expectedVersion = 3) =>
        PATCH(
            new Request("http://localhost/api/vantage/reviews/context", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedVersion, starDocumentIds: ["7"], starSourceScopes }),
            })
        );
    it("clears a deleted pin while keeping its document selected", async () => {
        expect((await save({})).status).toBe(200);
        expect(validatePreferenceSources).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Object),
            ["7"],
            {}
        );
        expect(writes[0]![2]).toBe('["7"]');
        expect(writes[0]![4]).toBe("{}");
    });
    it("reapproves an explicit replacement version through source validation", async () => {
        const replacement = { ...scope, version: "11" };
        expect((await save({ "7": replacement })).status).toBe(200);
        expect(validatePreferenceSources).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Object),
            ["7"],
            { "7": replacement }
        );
    });
    it("retains capacity rejection when clearing a pin", async () => {
        validatePreferenceSources.mockRejectedValue(
            new WeeklyReviewConflict("source_context_unavailable")
        );
        expect((await save({})).status).toBe(409);
        expect(writes).toHaveLength(0);
    });
    it("rejects stale configuration before validating a replacement", async () => {
        expect((await save({}, 2)).status).toBe(409);
        expect(validatePreferenceSources).not.toHaveBeenCalled();
        expect(writes).toHaveLength(0);
    });
    it("requires the creation switch for replacement scope approval", async () => {
        jest.mocked(weeklyReviewEnabled).mockReturnValue(false);
        expect((await save({ "7": { ...scope, version: "11" } })).status).toBe(404);
        expect(validatePreferenceSources).not.toHaveBeenCalled();
        expect(writes).toHaveLength(0);
    });
});
