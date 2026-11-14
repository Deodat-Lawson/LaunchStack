import { searchInternalEvidence } from "~/server/vantage/weekly-review-internal-search";
import type { WeeklyReviewAuthorityActor } from "~/server/vantage/weekly-review-authority";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

jest.mock("@launchstack/llm/embeddings", () => ({
    embed: jest.fn(() => {
        throw new Error("paid embeddings forbidden");
    }),
}));

const actor: WeeklyReviewAuthorityActor = {
    companyId: "1",
    userId: "synthetic",
    role: "admin",
    canRead: true,
    canMutate: true,
    documentScope: { kind: "everything" },
};
const cutoff = "2026-11-14T00:00:00Z";
const options = { queries: ["revenue definition"], excludeIds: ["9"] };
const row = (id = 1) => ({
    id,
    version_id: id + 10,
    title: `Synthetic ${id}`,
    category: "Finance",
    available_at: cutoff,
    matched_query_indexes: [0],
});

describe("bounded internal SQL search", () => {
    it("uses one parameterized metadata-only statement with acquisition limits", async () => {
        const query = jest.fn(async () => [row()]);
        const result = await searchInternalEvidence(query, actor, cutoff, {
            ...options,
            queries: ["revenue'; DROP TABLE x; --", "definition"],
        });
        expect(result).toMatchObject({
            scanLimit: 64,
            returnedLimit: 16,
            queryCount: 2,
            candidates: [{ id: "1", version: "11", matchedQueryIndexes: [0] }],
        });
        expect(query).toHaveBeenCalledTimes(1);
        const [text, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
        expect(text).toContain("eligible AS MATERIALIZED");
        expect(text).toContain("bounded_chunks AS MATERIALIZED");
        expect(text).toContain("LIMIT 64");
        expect(text).toContain("LIMIT 129");
        expect(text).toContain("octet_length(c.content)<=24000");
        expect(text).toContain("version_id=e.version_id");
        expect(text).not.toContain("DROP TABLE");
        expect(parameters).toEqual([
            "1",
            cutoff,
            ["9"],
            JSON.stringify([["revenue", "drop", "table"], ["definition"]]),
        ]);
        const embeddings = jest.requireMock("@launchstack/llm/embeddings");
        expect(embeddings.embed).not.toHaveBeenCalled();
    });

    it("returns aggregate denials without document identities or titles", async () => {
        const result = await searchInternalEvidence(
            async () => [row(1), { ...row(2), title: "private title" }],
            {
                ...actor,
                documentScope: {
                    kind: "only",
                    allowedCategories: [],
                    allowedDocumentIds: [1],
                    deniedDocumentIds: [],
                },
            },
            cutoff,
            options
        );
        expect(result.deniedCount).toBe(1);
        expect(result.candidates.map(candidate => candidate.id)).toEqual(["1"]);
        expect(JSON.stringify(result)).not.toContain("private title");
    });

    it("caps returned candidates while checking the entire 64-row scan", async () => {
        const result = await searchInternalEvidence(
            async () => Array.from({ length: 64 }, (_, index) => row(index + 1)),
            actor,
            cutoff,
            options
        );
        expect(result.candidates).toHaveLength(16);
    });

    it("keeps query errors distinguishable from no hits", async () => {
        await expect(
            searchInternalEvidence(async () => [], actor, cutoff, options)
        ).resolves.toMatchObject({ candidates: [], deniedCount: 0 });
        const failure = new Error("synthetic SQL timeout");
        await expect(
            searchInternalEvidence(
                async () => {
                    throw failure;
                },
                actor,
                cutoff,
                options
            )
        ).rejects.toBe(failure);
    });

    it("honors cancellation before and after its only database call", async () => {
        const controller = new AbortController();
        const query = jest.fn(async () => {
            controller.abort();
            return [row()];
        });
        await expect(
            searchInternalEvidence(query, actor, cutoff, options, controller.signal)
        ).rejects.toThrow("retrieval_acquisition_cancelled");
        expect(query).toHaveBeenCalledTimes(1);
        await expect(
            searchInternalEvidence(query, actor, cutoff, options, controller.signal)
        ).rejects.toThrow("retrieval_acquisition_cancelled");
        expect(query).toHaveBeenCalledTimes(1);
    });

    it.each([
        { queries: ["a", "b", "c"] },
        { queries: ["x".repeat(161)] },
        { excludeIds: ["1); DROP TABLE x"] },
        { excludeIds: ["9223372036854775808"] },
        { limit: 17 },
    ])("rejects invalid bounds before SQL %j", async invalid => {
        const query = jest.fn();
        await expect(
            searchInternalEvidence(query, actor, cutoff, { ...options, ...invalid })
        ).rejects.toThrow("invalid_internal_search");
        expect(query).not.toHaveBeenCalled();
    });

    it("avoids SQL with no useful tokens or a zero returned limit", async () => {
        const query = jest.fn();
        await searchInternalEvidence(query, actor, cutoff, { queries: ["?!"], excludeIds: [] });
        await searchInternalEvidence(query, actor, cutoff, { ...options, limit: 0 });
        expect(query).not.toHaveBeenCalled();
    });

    it("rejects an adapter returning more than the server-side bound", async () => {
        const query: WeeklyReviewQuery = async () =>
            Array.from({ length: 65 }, (_, index) => row(index + 1));
        await expect(searchInternalEvidence(query, actor, cutoff, options)).rejects.toThrow(
            "source_context_unavailable"
        );
    });
});
