/**
 * Integration tests for entity resolution via vector index (R6).
 *
 * Mocks getNeo4jSession to validate the resolution logic: vector queries,
 * ALIAS_OF creation, threshold gating, and graceful degradation.
 *
 * Run: pnpm test -- integration.entity-resolution
 */

import type { Neo4jEntityInput } from "~/lib/graph/neo4j-direct-writer";

// ── Mock neo4j-client ─────────────────────────────────────────────────────

const mockRun = jest.fn();
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockSession = { run: mockRun, close: mockClose };

jest.mock("~/lib/graph/neo4j-client", () => ({
    getNeo4jSession: jest.fn(() => mockSession),
}));

import { resolveEntities } from "~/lib/graph/neo4j-direct-writer-impl";

// ── Helpers ───────────────────────────────────────────────────────────────

const COMPANY = "test-company";

function makeEmbedding(base: number): number[] {
    return Array.from({ length: 768 }, (_, i) => base + i * 0.0001);
}

function makeEntity(overrides: Partial<Neo4jEntityInput> = {}): Neo4jEntityInput {
    return {
        name: "microsoft",
        displayName: "Microsoft",
        label: "ORG",
        confidence: 0.95,
        mentionCount: 5,
        companyId: COMPANY,
        embedding: makeEmbedding(0.1),
        ...overrides,
    };
}

/** Builds a mock Neo4j result with records that have a .get() method. */
function mockVectorResult(rows: Array<{ name: string; label: string; mentionCount: number; score: number }>) {
    return {
        records: rows.map((row) => ({
            get: (key: string) => row[key as keyof typeof row],
        })),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Integration: Entity Resolution", () => {
    const originalEnv = process.env.ENTITY_RESOLUTION_THRESHOLD;

    beforeEach(() => {
        mockRun.mockClear();
        mockClose.mockClear();
        delete process.env.ENTITY_RESOLUTION_THRESHOLD;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.ENTITY_RESOLUTION_THRESHOLD = originalEnv;
        } else {
            delete process.env.ENTITY_RESOLUTION_THRESHOLD;
        }
    });

    it("merges entities with cosine similarity above threshold", async () => {
        // Vector query returns a near-duplicate
        mockRun
            .mockResolvedValueOnce(mockVectorResult([
                { name: "microsoft corp", label: "ORG", mentionCount: 2, score: 0.96 },
            ]))
            .mockResolvedValue({ records: [] }); // ALIAS_OF merge

        const entity = makeEntity({ mentionCount: 5 });
        await resolveEntities([entity], COMPANY);

        // First call: vector query
        const [vectorCypher, vectorParams] = mockRun.mock.calls[0]!;
        expect(vectorCypher).toContain("db.index.vector.queryNodes");
        expect(vectorCypher).toContain("entity-embeddings");
        expect(vectorParams.companyId).toBe(COMPANY);
        expect(vectorParams.name).toBe("microsoft");
        expect(vectorParams.embedding).toHaveLength(768);

        // Second call: ALIAS_OF merge
        const [aliasCypher, aliasParams] = mockRun.mock.calls[1]!;
        expect(aliasCypher).toContain("MERGE (alias)-[:ALIAS_OF]->(canonical)");
        // "microsoft corp" (mentionCount 2) is alias, "microsoft" (mentionCount 5) is canonical
        expect(aliasParams.aliasName).toBe("microsoft corp");
        expect(aliasParams.canonicalName).toBe("microsoft");
    });

    it("creates ALIAS_OF from alias to canonical (higher mentionCount is canonical)", async () => {
        mockRun
            .mockResolvedValueOnce(mockVectorResult([
                { name: "msft", label: "ORG", mentionCount: 2, score: 0.92 },
            ]))
            .mockResolvedValue({ records: [] });

        const entity = makeEntity({ name: "microsoft", mentionCount: 10 });
        await resolveEntities([entity], COMPANY);

        const [, aliasParams] = mockRun.mock.calls[1]!;
        // Entity has higher mentionCount → it's canonical
        expect(aliasParams.aliasName).toBe("msft");
        expect(aliasParams.canonicalName).toBe("microsoft");
    });

    it("canonical defaults to existing node (candidate) on tie", async () => {
        mockRun
            .mockResolvedValueOnce(mockVectorResult([
                { name: "existing-entity", label: "ORG", mentionCount: 5, score: 0.90 },
            ]))
            .mockResolvedValue({ records: [] });

        // Same mentionCount as candidate → tie → candidate (existing) wins
        const entity = makeEntity({ name: "new-entity", mentionCount: 5 });
        await resolveEntities([entity], COMPANY);

        const [, aliasParams] = mockRun.mock.calls[1]!;
        // New entity becomes alias, existing becomes canonical on tie
        expect(aliasParams.aliasName).toBe("new-entity");
        expect(aliasParams.canonicalName).toBe("existing-entity");
    });

    it("skips resolution when vector index doesn't exist", async () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        mockRun.mockRejectedValueOnce(new Error("There is no such index: 'entity-embeddings'"));

        const entity = makeEntity();
        await resolveEntities([entity], COMPANY);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Vector index"),
            expect.any(String),
        );
        // Only the failed vector query call — no ALIAS_OF merge attempted
        expect(mockRun).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
    });

    it("respects ENTITY_RESOLUTION_THRESHOLD env var", async () => {
        process.env.ENTITY_RESOLUTION_THRESHOLD = "0.99";

        // Vector query returns candidate but the threshold is passed as param
        mockRun.mockResolvedValueOnce(mockVectorResult([]));

        const entity = makeEntity();
        await resolveEntities([entity], COMPANY);

        const [, params] = mockRun.mock.calls[0]!;
        expect(params.threshold).toBe(0.99);
    });

    it("skips entities without embeddings during resolution", async () => {
        const entityNoEmbed = makeEntity({ embedding: undefined });
        const entityEmptyEmbed = makeEntity({ name: "other", embedding: [] });

        await resolveEntities([entityNoEmbed, entityEmptyEmbed], COMPANY);

        // Neither entity has a valid embedding → no Neo4j calls at all
        expect(mockRun).not.toHaveBeenCalled();
    });
});
