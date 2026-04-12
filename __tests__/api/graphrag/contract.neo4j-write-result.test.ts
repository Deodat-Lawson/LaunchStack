import { Neo4jWriteResultSchema } from "./contracts/graphrag-schemas";

describe("contract: neo4j-write-result", () => {
    it("accepts a valid result with dynamic relationship types", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: 10,
            mentions: 25,
            relationships: 5,
            dynamicRelTypes: ["LED_BY", "ACQUIRED_BY", "PARTNERS_WITH"],
            durationMs: 142.5,
        });
        expect(result.success).toBe(true);
    });

    it("accepts a zero-count result", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: 0,
            mentions: 0,
            relationships: 0,
            dynamicRelTypes: [],
            durationMs: 0,
        });
        expect(result.success).toBe(true);
    });

    it("accepts a BERT-only result with CO_OCCURS", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: 8,
            mentions: 20,
            relationships: 3,
            dynamicRelTypes: ["CO_OCCURS"],
            durationMs: 88.0,
        });
        expect(result.success).toBe(true);
    });

    it("rejects negative entity count", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: -1,
            mentions: 0,
            relationships: 0,
            dynamicRelTypes: [],
            durationMs: 0,
        });
        expect(result.success).toBe(false);
    });

    it("rejects negative mention count", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: 0,
            mentions: -5,
            relationships: 0,
            dynamicRelTypes: [],
            durationMs: 0,
        });
        expect(result.success).toBe(false);
    });

    it("rejects negative relationship count", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: 0,
            mentions: 0,
            relationships: -2,
            dynamicRelTypes: [],
            durationMs: 0,
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing dynamicRelTypes field", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: 0,
            mentions: 0,
            relationships: 0,
            durationMs: 0,
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing durationMs field", () => {
        const result = Neo4jWriteResultSchema.safeParse({
            entities: 0,
            mentions: 0,
            relationships: 0,
            dynamicRelTypes: [],
        });
        expect(result.success).toBe(false);
    });
});
