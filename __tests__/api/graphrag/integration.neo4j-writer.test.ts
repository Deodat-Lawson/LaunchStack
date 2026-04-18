/**
 * Integration tests for Neo4jDirectWriter implementation.
 *
 * Mocks getNeo4jSession to validate Cypher queries, parameters, and
 * error handling without requiring a running Neo4j instance.
 *
 * Run: pnpm test -- integration.neo4j-writer
 */

import type {
    Neo4jDocumentGraphInput,
    Neo4jEntityInput,
    Neo4jMentionInput,
    Neo4jRelationshipInput,
} from "~/lib/graph/neo4j-direct-writer";

// ── Mock neo4j-client before importing implementation ─────────────────────

const mockRun = jest.fn().mockResolvedValue({ records: [] });
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockSession = { run: mockRun, close: mockClose };

jest.mock("~/lib/graph/neo4j-client", () => ({
    getNeo4jSession: jest.fn(() => mockSession),
}));

import { Neo4jDirectWriterImpl } from "~/lib/graph/neo4j-direct-writer-impl";

// ── Fixtures ──────────────────────────────────────────────────────────────

const COMPANY = "test-company";

function makeEntity(overrides: Partial<Neo4jEntityInput> = {}): Neo4jEntityInput {
    return {
        name: "microsoft",
        displayName: "Microsoft",
        label: "ORG",
        confidence: 0.95,
        mentionCount: 3,
        companyId: COMPANY,
        embedding: Array.from({ length: 768 }, (_, i) => i * 0.001),
        ...overrides,
    };
}

function makeRelationship(overrides: Partial<Neo4jRelationshipInput> = {}): Neo4jRelationshipInput {
    return {
        sourceName: "satya nadella",
        sourceLabel: "PER",
        targetName: "microsoft",
        targetLabel: "ORG",
        relationType: "CEO_OF",
        weight: 0.9,
        evidenceCount: 1,
        detail: "Satya Nadella is CEO of Microsoft",
        documentId: 1,
        companyId: COMPANY,
        ...overrides,
    };
}

function makeMention(overrides: Partial<Neo4jMentionInput> = {}): Neo4jMentionInput {
    return {
        entityName: "microsoft",
        entityLabel: "ORG",
        sectionId: 10,
        documentId: 1,
        confidence: 0.95,
        companyId: COMPANY,
        ...overrides,
    };
}

function makeDocGraph(overrides: Partial<Neo4jDocumentGraphInput> = {}): Neo4jDocumentGraphInput {
    return {
        document: { id: 1, name: "test.pdf", companyId: COMPANY, uploadedAt: "2026-01-01T00:00:00Z" },
        sectionIds: [10, 11],
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Integration: Neo4jDirectWriter", () => {
    let writer: Neo4jDirectWriterImpl;

    beforeEach(() => {
        writer = new Neo4jDirectWriterImpl();
        mockRun.mockClear();
        mockClose.mockClear();
        mockRun.mockResolvedValue({ records: [] });
    });

    // ─── writeEntities ────────────────────────────────────────────────────

    it("writeEntities creates Entity nodes with all required properties", async () => {
        const entity = makeEntity();
        const count = await writer.writeEntities([entity], COMPANY);

        expect(count).toBe(1);
        expect(mockRun).toHaveBeenCalledTimes(1);

        const [cypher, params] = mockRun.mock.calls[0]!;
        expect(cypher).toContain("MERGE (n:Entity {name: e.name, label: e.label, companyId: e.companyId})");
        expect(cypher).toContain("n.displayName");
        expect(cypher).toContain("n.confidence");
        expect(cypher).toContain("n.mentionCount");
        expect(cypher).toContain("n.embedding");

        const passed = params.entities[0];
        expect(passed.name).toBe("microsoft");
        expect(passed.displayName).toBe("Microsoft");
        expect(passed.label).toBe("ORG");
        expect(passed.confidence).toBe(0.95);
        expect(passed.mentionCount).toBe(3);
        expect(passed.companyId).toBe(COMPANY);
        expect(passed.embedding).toHaveLength(768);

        expect(mockClose).toHaveBeenCalled();
    });

    it("writeEntities is idempotent — calling twice produces same node count", async () => {
        const entities = [makeEntity()];
        const count1 = await writer.writeEntities(entities, COMPANY);
        const count2 = await writer.writeEntities(entities, COMPANY);

        expect(count1).toBe(1);
        expect(count2).toBe(1);
        // Both calls use MERGE, so Neo4j would not create duplicates
        for (const call of mockRun.mock.calls) {
            expect(call[0]).toContain("MERGE");
        }
    });

    it("writeEntities preserves existing embedding when new is null", async () => {
        const entity = makeEntity({ embedding: undefined });
        await writer.writeEntities([entity], COMPANY);

        const [cypher, params] = mockRun.mock.calls[0]!;
        // ON MATCH uses CASE to preserve existing embedding
        expect(cypher).toContain("CASE WHEN e.embedding IS NOT NULL THEN e.embedding ELSE n.embedding END");
        expect(params.entities[0].embedding).toBeNull();
    });

    // ─── writeRelationships ───────────────────────────────────────────────

    it("writeRelationships creates dynamic Cypher types, not RELATES_TO", async () => {
        const rels = [makeRelationship({ relationType: "CEO_OF" })];
        const types = await writer.writeRelationships(rels, COMPANY);

        expect(types).toEqual(["CEO_OF"]);
        const [cypher] = mockRun.mock.calls[0]!;
        expect(cypher).toContain("MERGE (src)-[rel:CEO_OF]->(tgt)");
        expect(cypher).not.toContain("RELATES_TO");
    });

    it("writeRelationships returns distinct type strings", async () => {
        const rels = [
            makeRelationship({ relationType: "CEO_OF" }),
            makeRelationship({ relationType: "ACQUIRED", sourceName: "microsoft", sourceLabel: "ORG", targetName: "github", targetLabel: "ORG" }),
            makeRelationship({ relationType: "CEO_OF" }),
        ];
        const types = await writer.writeRelationships(rels, COMPANY);

        expect(types.sort()).toEqual(["ACQUIRED", "CEO_OF"]);
    });

    it("writeRelationships skips and warns on invalid relationType", async () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        const rels = [
            makeRelationship({ relationType: "ceo of" }),
            makeRelationship({ relationType: "VALID_TYPE" }),
        ];
        const types = await writer.writeRelationships(rels, COMPANY);

        expect(types).toEqual(["VALID_TYPE"]);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Skipping invalid relationType"),
        );
        warnSpy.mockRestore();
    });

    // ─── writeMentions ────────────────────────────────────────────────────

    it("writeMentions creates Section nodes and MENTIONED_IN edges", async () => {
        const mentions = [makeMention()];
        const count = await writer.writeMentions(mentions, COMPANY);

        expect(count).toBe(1);
        // First call: MERGE Section nodes
        expect(mockRun.mock.calls[0]![0]).toContain("MERGE (s:Section {id: m.sectionId, documentId: m.documentId})");
        // Second call: MERGE MENTIONED_IN edges
        expect(mockRun.mock.calls[1]![0]).toContain("MERGE (e)-[r:MENTIONED_IN]->(s)");
        expect(mockRun.mock.calls[1]![0]).toContain("r.confidence");
    });

    // ─── writeDocumentGraph ───────────────────────────────────────────────

    it("writeDocumentGraph creates Document node with CONTAINS edges", async () => {
        const doc = makeDocGraph();
        await writer.writeDocumentGraph(doc, COMPANY);

        // First call: MERGE Document node
        const [docCypher, docParams] = mockRun.mock.calls[0]!;
        expect(docCypher).toContain("MERGE (d:Document {id: $id, companyId: $companyId})");
        expect(docParams.id).toBe(1);
        expect(docParams.name).toBe("test.pdf");
        expect(docParams.uploadedAt).toBe("2026-01-01T00:00:00Z");

        // Second call: CONTAINS edges
        const [containsCypher, containsParams] = mockRun.mock.calls[1]!;
        expect(containsCypher).toContain("MERGE (d)-[:CONTAINS]->(s)");
        expect(containsParams.sectionIds).toEqual([10, 11]);
    });

    // ─── ensureIndexes ────────────────────────────────────────────────────

    it("ensureIndexes creates entity-embeddings vector index", async () => {
        await writer.ensureIndexes();

        const [cypher] = mockRun.mock.calls[0]!;
        expect(cypher).toContain("CREATE VECTOR INDEX `entity-embeddings` IF NOT EXISTS");
        expect(cypher).toContain("768");
        expect(cypher).toContain("cosine");
    });

    it("ensureIndexes is idempotent — calling twice does not error", async () => {
        await writer.ensureIndexes();
        await writer.ensureIndexes();

        expect(mockRun).toHaveBeenCalledTimes(2);
        // Both calls use IF NOT EXISTS
        for (const call of mockRun.mock.calls) {
            expect(call[0]).toContain("IF NOT EXISTS");
        }
    });

    // ─── graceful degradation ─────────────────────────────────────────────

    it("all methods return gracefully when Neo4j is unreachable", async () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        mockRun.mockRejectedValue(new Error("Connection refused"));

        const entities = [makeEntity()];
        const rels = [makeRelationship()];
        const mentions = [makeMention()];
        const doc = makeDocGraph();

        expect(await writer.writeEntities(entities, COMPANY)).toBe(0);
        expect(await writer.writeRelationships(rels, COMPANY)).toEqual([]);
        expect(await writer.writeMentions(mentions, COMPANY)).toBe(0);
        await expect(writer.writeDocumentGraph(doc, COMPANY)).resolves.toBeUndefined();
        await expect(writer.ensureIndexes()).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
