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

async function lexicalFixture(
    options: {
        question?: string;
        watched?: string[];
        carryover?: string[];
        changed?: string[];
        textBytes?: number;
        denied?: number[];
        count?: number;
        fixed?: string;
    } = {}
) {
    const rows = Array.from({ length: options.count ?? 71 }, (_, index) => ({
        id: String(index + 1),
        version: String(index + 1),
        category: "Corpus",
        title: `Document ${index + 1}`,
        lexical_key: `corpus/${String(index + 1).padStart(3, "0")}`,
        version_date: options.changed?.includes(String(index + 1))
            ? "2026-11-12T00:00:00Z"
            : "2026-11-08T00:00:00Z",
    })).reverse();
    const texts = new Map(
        rows.map(row => [
            row.version,
            (row.id === "11" ? "Gearbox spindle release. " : "Office scheduling. ").padEnd(
                options.textBytes ?? 500,
                "x"
            ),
        ])
    );
    const requested: string[] = [];
    let loadedBytes = 0;
    const query: WeeklyReviewQuery = jest.fn(async (sql, args = []) => {
        if (sql.includes("SELECT DISTINCT document_id"))
            return (options.watched ?? []).map(id => ({ id }));
        if (sql.startsWith("SELECT id,title,guidance"))
            return [
                {
                    id: "topic",
                    title: "Review",
                    status: "active",
                    revision: 1,
                    guidance: {
                        openQuestions: options.question ? [options.question] : [],
                        decisionChangers: [],
                        keywords: [],
                        people: [],
                        metrics: [],
                    },
                },
            ];
        if (sql.startsWith("SELECT w.topic_id"))
            return (options.watched ?? []).map(id => ({ topic_id: "topic", document_id: id }));
        if (sql.includes("AND d.id=ANY"))
            return rows.filter(row => (args[2] as string[]).includes(row.id));
        if (sql.includes("ORDER BY v.created_at")) return rows;
        if (sql.includes("SELECT v.id::text AS version, body.text")) {
            const versions = args[0] as string[];
            requested.push(...versions);
            return versions.flatMap(version => {
                const text = texts.get(version)!;
                if (Buffer.byteLength(text) > Number(args[1])) return [];
                loadedBytes += Buffer.byteLength(text);
                return [{ version, text }];
            });
        }
        throw Error(sql);
    });
    const current = {
        ...actor,
        documentScope: options.denied
            ? {
                  kind: "except" as const,
                  deniedCategories: [],
                  allowedDocumentIds: [],
                  deniedDocumentIds: options.denied,
              }
            : actor.documentScope,
    };
    const context: WeeklyReviewContext = {
        actor: current,
        week: "2026-11-09",
        sources: options.fixed
            ? [
                  {
                      kind: "document",
                      id: options.fixed,
                      version: options.fixed,
                      hash: "a".repeat(64),
                      ref: "unit:approved-fixed",
                      title: "Approved fixed scope",
                      text: "Only approved fixed text.",
                      audience: "company",
                      purpose: "workspace-required",
                  },
              ]
            : [],
        role: "owner",
        preferenceVersion: 1,
        authorityEpoch: "9",
        mandatoryCoverage: { required: 0, included: 0 },
    };
    const seed = await collectTopicSeed(query, current, context, {
        cutoff: "2026-11-16T00:00:00Z",
        asOf: "2026-11-16T00:00:00Z",
        policyRevision: 1,
        roleRevision: null,
        expectedActiveId: null,
        configuration: { provider: "seeds", scoped: false },
        carryover: options.carryover
            ? { priorRunId: "prior", reviewVersion: 1, seedIds: options.carryover }
            : "unavailable",
    });
    return { seed, requested, loadedBytes };
}

it("offers the question match at recency rank 61 while retaining watches, carryover and lane", async () => {
    const { seed, requested } = await lexicalFixture({
        question: "Which gearbox spindle release?",
        watched: ["1"],
        carryover: ["2"],
        changed: ["71", "70", "69"],
    });
    expect(seed.documents.slice(0, 3).map(document => [document.id, document.reason])).toEqual([
        ["1", "watch"],
        ["2", "carryover"],
        ["11", "question"],
    ]);
    expect(seed.documents).toHaveLength(50);
    expect(seed.documents.slice(-3).map(document => document.id)).toEqual(["71", "70", "69"]);
    expect(seed.manifest.lane).toHaveLength(3);
    expect(requested).toHaveLength(71);
});

it("filters denied metadata before lexical body reads and keeps no-match recency", async () => {
    const denied = await lexicalFixture({ question: "Gearbox spindle", denied: [11] });
    expect(denied.requested).not.toContain("11");
    expect(denied.seed.documents.some(document => document.id === "11")).toBe(false);
    const irrelevant = await lexicalFixture({ question: "Zebrafish quantum" });
    expect(irrelevant.seed.documents.map(document => document.id)).toEqual(
        Array.from({ length: 50 }, (_, index) => String(71 - index))
    );
    expect(irrelevant.seed.documents.every(document => document.reason === "recency")).toBe(true);
});

it("keeps original fifty parents when the 2 MB lexical probe cap is exhausted", async () => {
    const result = await lexicalFixture({ question: "Gearbox spindle", textBytes: 40000 });
    expect(result.loadedBytes).toBe(2000000);
    expect(result.seed.documents.map(document => document.id)).toEqual(
        Array.from({ length: 50 }, (_, index) => String(71 - index))
    );
});

it("bounds the pre-offer candidate pool to 256 canonical parents", async () => {
    const result = await lexicalFixture({ question: "Gearbox spindle", count: 300 });
    expect(result.requested).toHaveLength(256);
    expect(new Set(result.requested).size).toBe(256);
    expect(result.loadedBytes).toBeLessThanOrEqual(2000000);
    expect(result.seed.documents).toHaveLength(50);
});

it("does not read a fixed parent's raw body while using question guidance", async () => {
    const { seed, requested } = await lexicalFixture({ question: "Gearbox spindle", fixed: "11" });
    expect(requested).not.toContain("11");
    expect(seed.documents.some(document => document.id === "11")).toBe(false);
    expect(seed.manifest.fixed.map(source => source.ref)).toEqual(["unit:approved-fixed"]);
});

it("uses only the original fifty recency bodies when topic guidance is empty", async () => {
    const { seed, requested } = await lexicalFixture();
    expect(requested).toHaveLength(50);
    expect(seed.documents.every(document => document.reason === "recency")).toBe(true);
    expect(seed.documents.some(document => document.id === "11")).toBe(false);
});
