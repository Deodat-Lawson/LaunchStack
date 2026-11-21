import { collectTopicSeed } from "~/server/vantage/weekly-review-topic-seed";
import type { WeeklyReviewAuthorityActor } from "~/server/vantage/weekly-review-authority";
import type { WeeklyReviewContext, WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";
const actor = {
    companyId: "1",
    userId: "owner",
    canMutate: true,
    documentScope: { kind: "everything" },
} as WeeklyReviewAuthorityActor;
it("offers an old explicit watch before the denied recent pool and pins its version", async () => {
    const guidance = {
        openQuestions: [],
        decisionChangers: [],
        keywords: [],
        people: [],
        metrics: [],
    };
    const query: WeeklyReviewQuery = jest.fn(async (sql, args = []) => {
        if (sql.includes("SELECT DISTINCT document_id")) return [{ id: "7" }];
        if (sql.startsWith("SELECT id,title,guidance"))
            return [{ id: "topic", title: "Readiness", guidance, status: "active", revision: 3 }];
        if (sql.startsWith("SELECT w.topic_id")) return [{ topic_id: "topic", document_id: "7" }];
        if (sql.includes("AND d.id=ANY")) {
            expect(args[2]).toEqual(["7"]);
            return [
                {
                    id: "7",
                    title: "Old watch",
                    category: "Product",
                    version: "70",
                    version_date: "2026-10-01T00:00:00.000Z",
                },
            ];
        }
        if (sql.includes("ORDER BY v.created_at")) return [];
        if (sql.includes("SELECT v.id::text AS version, body.text"))
            return [{ version: "70", text: "Old watched source ".repeat(20) }];
        throw Error(sql);
    });
    const context: WeeklyReviewContext = {
        actor,
        week: "2026-11-09",
        sources: [],
        role: "owner",
        preferenceVersion: 1,
        authorityEpoch: "9",
        mandatoryCoverage: { required: 0, included: 0 },
    };
    const seed = await collectTopicSeed(query, actor, context, {
        cutoff: "2026-11-15T00:00:00.000Z",
        asOf: "2026-11-15T00:00:00.000Z",
        policyRevision: 1,
        roleRevision: null,
        expectedActiveId: null,
        configuration: { provider: "seeds", scoped: false },
        carryover: "unavailable",
    });
    expect(seed.documents.map(document => [document.ref, document.reason])).toEqual([
        ["doc:7@70", "watch"],
    ]);
    expect(seed.manifest.topics[0]?.revision).toBe(3);
    expect(seed.manifest.offered[0]).not.toHaveProperty("text");
    const candidateCalls = (query as jest.Mock).mock.calls.filter(call =>
        String(call[0]).includes("FROM pdr_ai_v2_document d")
    );
    expect(
        candidateCalls.every(
            call => String(call[0]).includes("NOT EXISTS") && String(call[0]).includes("restricted")
        )
    ).toBe(true);
});
