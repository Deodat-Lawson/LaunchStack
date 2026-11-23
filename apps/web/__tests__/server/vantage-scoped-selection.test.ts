import {
    createWeeklyReviewAuthority,
    sourceHash,
    type WeeklyReviewAuthorityActor,
} from "~/server/vantage/weekly-review-authority";
import {
    configuredSourceScopes,
    retainedSourceScopes,
    type WeeklyReviewSourceScope,
} from "~/server/vantage/weekly-review-scoped-selection";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

function setup(text = "Relevant evidence. " + "x".repeat(30000)) {
    const state = {
        text,
        chunks: 1,
        createdAt: "2026-11-10T00:00:00.000Z",
        restricted: false,
        policyScopes: {} as Record<string, WeeklyReviewSourceScope>,
        stars: [] as string[],
        starScopes: {} as Record<string, WeeklyReviewSourceScope>,
        epoch: "1",
        canConfigure: true,
        denied: false,
    };
    const scope: WeeklyReviewSourceScope = {
        version: "10",
        expectedParentHash: sourceHash(text),
        qualification: "Review only the approved relevant evidence span.",
        requiredUnits: [
            { id: "evidence", start: 0, end: 18, excerptHash: sourceHash(text.slice(0, 18)) },
        ],
    };
    state.policyScopes["1"] = scope;
    const calls: string[] = [];
    const parameters: unknown[][] = [];
    const query: WeeklyReviewQuery = async (sql, params = []) => {
        calls.push(sql);
        parameters.push(params);
        if (
            sql.includes("set_config") ||
            sql.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_epochs")
        )
            return [];
        if (sql.includes("SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs"))
            return [{ version: state.epoch }];
        if (sql.includes("FROM pdr_ai_v2_vantage_weekly_review_policy"))
            return [
                {
                    architecture_document_id: "1",
                    required_document_ids: [],
                    required_source_scopes: state.policyScopes,
                    version: 1,
                },
            ];
        if (sql.includes("FROM pdr_ai_v2_vantage_weekly_review_preferences"))
            return [
                {
                    star_document_ids: state.stars,
                    star_source_scopes: state.starScopes,
                    version: 1,
                },
            ];
        if (sql.includes("FROM pdr_ai_v2_document_settings"))
            return state.restricted ? [{ restricted: 1 }] : [];
        if (sql.includes("pdr_ai_v2_document_context_chunks")) {
            if (sql.includes("AS chunk_count"))
                return [
                    {
                        chunk_count: state.chunks,
                        text_bytes: Buffer.byteLength(state.text),
                        text_chars: state.text.length,
                    },
                ];
            return [{ id: "100", content: state.text }];
        }
        if (sql.includes("FROM pdr_ai_v2_document d")) {
            if (sql.includes("NOT (d.id=ANY")) return [];
            return [
                {
                    id: "1",
                    title: "Architecture",
                    category: "Shared",
                    version_id: "10",
                    version_created_at: state.createdAt,
                },
            ];
        }
        throw Error("Unexpected SQL " + sql);
    };
    const actor: WeeklyReviewAuthorityActor = {
        companyId: "1",
        userId: "actor",
        role: "admin",
        canRead: true,
        canMutate: true,
        documentScope: { kind: "everything" },
    };
    return {
        state,
        scope,
        calls,
        parameters,
        query,
        actor,
        authority: (enabled = true, internal = true) =>
            createWeeklyReviewAuthority(
                { transaction: work => work(query) },
                async () => ({
                    ...actor,
                    canConfigure: state.canConfigure,
                    documentScope: state.denied
                        ? {
                              kind: "except",
                              deniedDocumentIds: [1],
                              allowedDocumentIds: [],
                              deniedCategories: [],
                          }
                        : actor.documentScope,
                }),
                { internalRetrievalV1: internal, scopedEvidenceV2: enabled }
            ),
    };
}

describe("scoped weekly review service acquisition (offline)", () => {
    it("validates actual parent and excerpt hashes and administrative capability", async () => {
        const f = setup();
        f.scope.requiredUnits[0]!.excerptHash = "0".repeat(64);
        await expect(
            f.authority().validateCompanySources(f.query, f.actor, "1", [], { "1": f.scope })
        ).rejects.toThrow("source_authority_changed");
        f.state.canConfigure = false;
        await expect(
            f.authority().validateCompanySources(f.query, f.actor, "1", [], { "1": f.scope })
        ).rejects.toThrow("review_configuration_denied");
    });
    it("rejects personal scopes that narrow a company-required parent", async () => {
        const f = setup();
        f.state.stars = ["1"];
        await expect(
            f.authority().validatePreferenceSources(f.query, f.actor, ["1"], { "1": f.scope })
        ).rejects.toThrow("personal_scope_cannot_narrow_required");
    });
    it("requires both feature flags to save new scopes", async () => {
        const f = setup();
        await expect(
            f
                .authority(true, false)
                .validateCompanySources(f.query, f.actor, "1", [], { "1": f.scope })
        ).rejects.toThrow("scoped_evidence_disabled");
    });
    it("retains omitted scope maps for surviving IDs and rejects explicit unrelated IDs", () => {
        const f = setup();
        expect(retainedSourceScopes({ "1": f.scope, "2": f.scope }, ["1"])).toEqual({
            "1": f.scope,
        });
        expect(() => configuredSourceScopes({ "2": f.scope }, ["1"])).toThrow(
            "invalid_source_scopes"
        );
    });
});

describe("topic-first configuration budget preview", () => {
    const scopedFixture = (bytes: number, unitChars = 6000) => {
        const f = setup("x".repeat(bytes));
        f.scope.requiredUnits = Array.from({ length: Math.ceil(bytes / unitChars) }, (_, index) => {
            const start = index * unitChars;
            const end = Math.min(start + unitChars, bytes);
            return {
                id: "approved-" + index,
                start,
                end,
                excerptHash: sourceHash(f.state.text.slice(start, end)),
            };
        });
        return f;
    };
    it.each([
        [73072, 6000, 13],
        [80000, 5000, 16],
    ])("accepts %i bytes with %i-character units (%i units)", async (bytes, chars, count) => {
        const f = scopedFixture(bytes, chars);
        const sources = await f
            .authority()
            .validateCompanySources(f.query, f.actor, "1", [], { "1": f.scope });
        expect(sources).toHaveLength(count);
        expect(sources.reduce((n, source) => n + Buffer.byteLength(source.text), 0)).toBe(bytes);
    });
    it("rejects fixed evidence beyond 80000 bytes", async () => {
        const f = scopedFixture(80001);
        await expect(
            f.authority().validateCompanySources(f.query, f.actor, "1", [], { "1": f.scope })
        ).rejects.toThrow("mandatory_context_budget_exceeded");
    });
    it("retains source access denial for a near-cap configuration", async () => {
        const f = scopedFixture(73072);
        f.state.denied = true;
        await expect(
            f.authority().validateCompanySources(f.query, f.actor, "1", [], { "1": f.scope })
        ).rejects.toThrow("source_access_denied");
    });
});
