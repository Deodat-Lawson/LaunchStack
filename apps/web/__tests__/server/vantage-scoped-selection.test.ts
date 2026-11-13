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

const identity = {
    candidateId: "11111111-1111-4111-8111-111111111111",
    asOf: "2026-11-13T12:00:00.000Z",
};
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
    it("uses explicit exact spans and one frozen dependency per parent", async () => {
        const f = setup();
        const context = await f
            .authority()
            .collectWeeklyReviewContext(f.actor, "2026-11-09", identity);
        expect(context.sources).toHaveLength(1);
        expect(context.sources[0]!.text).toBe(f.state.text.slice(0, 18));
        expect(context.sources[0]!.ref).toMatch(/^unit:/);
        expect(context.dependencies).toHaveLength(1);
        expect(context.dependencies![0]!.kind).toBe("scoped-document");
        expect(context.scopedEvidence![0]!.coverage.state).toBe("relevant_spans_reviewed");
        expect(context.mandatoryCoverage).toEqual({ required: 1, included: 1 });
        expect(context.selectionDiagnostics!.budget.profile).toBe("scoped-v2");
        expect(f.calls.some(sql => sql.includes("sum(octet_length(content)) OVER()"))).toBe(true);
    });
    it("filters the exact scoped version at PostgreSQL timestamp precision", async () => {
        const f = setup();
        await f.authority().collectWeeklyReviewContext(f.actor, "2026-11-09", identity);
        const index = f.calls.findIndex(sql =>
            sql.includes("LEFT JOIN pdr_ai_v2_document_versions")
        );
        expect(index).toBeGreaterThanOrEqual(0);
        expect(f.calls[index]).toMatch(/v\.created_at\s*<=\s*\$4::timestamptz/);
        expect(f.parameters[index]![3]).toBe(identity.asOf);
    });
    it("keeps ID-only full-document acquisition when the scoped flag is off", async () => {
        const f = setup();
        await expect(
            f.authority(false).collectWeeklyReviewContext(f.actor, "2026-11-09", identity)
        ).rejects.toThrow("source_context_unavailable");
        const small = setup("Relevant evidence. More");
        const context = await small
            .authority(false)
            .collectWeeklyReviewContext(small.actor, "2026-11-09", identity);
        expect(context.sources[0]!.text).toBe(small.state.text);
        expect(context.scopedEvidence).toBeUndefined();
        expect(context.sources[0]!.ref).toBe("doc:1@10");
    });
    it.each(["bytes", "chunks"])(
        "rejects oversized %s before loading a parent body",
        async bound => {
            const f = setup();
            if (bound === "bytes") f.state.text = "x".repeat(128001);
            else f.state.chunks = 1025;
            await expect(
                f.authority().collectWeeklyReviewContext(f.actor, "2026-11-09", identity)
            ).rejects.toThrow("source_context_unavailable");
            expect(f.calls.some(sql => sql.includes("AS content FROM (SELECT id,content"))).toBe(
                false
            );
        }
    );
    it("rejects a configured version created after the captured cutoff", async () => {
        const f = setup();
        f.state.createdAt = "2026-11-14T00:00:00.000Z";
        await expect(
            f.authority().collectWeeklyReviewContext(f.actor, "2026-11-09", identity)
        ).rejects.toThrow("source_version_unavailable");
        expect(f.calls.some(sql => sql.includes("pdr_ai_v2_document_context_chunks"))).toBe(false);
    });
    it("rechecks the full frozen parent, including edits outside the approved span", async () => {
        const f = setup();
        const context = await f
            .authority()
            .collectWeeklyReviewContext(f.actor, "2026-11-09", identity);
        f.state.text += "changed outside scope";
        await expect(
            f
                .authority()
                .assertCurrentWeeklyReviewAuthority(f.query, f.actor, context.dependencies!, "read")
        ).rejects.toThrow("source_authority_changed");
    });
    it("reads approved frozen scopes after policy changes and flag disable, with current ACL", async () => {
        const f = setup();
        const context = await f
            .authority()
            .collectWeeklyReviewContext(f.actor, "2026-11-09", identity);
        const reorder = (value: unknown): unknown =>
            Array.isArray(value)
                ? value.map(reorder)
                : value && typeof value === "object"
                  ? Object.fromEntries(
                        Object.entries(value)
                            .reverse()
                            .map(([key, item]) => [key, reorder(item)])
                    )
                  : value;
        context.dependencies = reorder(context.dependencies) as typeof context.dependencies;
        f.state.policyScopes = {};
        f.state.epoch = "2";
        await expect(
            f
                .authority(false, false)
                .assertCurrentWeeklyReviewAuthority(f.query, f.actor, context.dependencies!, "read")
        ).resolves.toBeUndefined();
        f.state.denied = true;
        await expect(
            f
                .authority(false, false)
                .assertCurrentWeeklyReviewAuthority(f.query, f.actor, context.dependencies!, "read")
        ).rejects.toThrow("source_access_denied");
    });
    it("checks current company audience and the captured dispatch epoch", async () => {
        const f = setup();
        const context = await f
            .authority()
            .collectWeeklyReviewContext(f.actor, "2026-11-09", identity);
        f.state.restricted = true;
        await expect(
            f
                .authority()
                .assertCurrentWeeklyReviewAuthority(f.query, f.actor, context.dependencies!, "read")
        ).rejects.toThrow("required_context_audience");
        f.state.restricted = false;
        f.state.epoch = "2";
        await expect(
            f
                .authority()
                .assertCurrentWeeklyReviewAuthority(
                    f.query,
                    { ...f.actor, authorityEpoch: "1" },
                    context.dependencies!,
                    "dispatch"
                )
        ).rejects.toThrow("source_authority_changed");
    });
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
