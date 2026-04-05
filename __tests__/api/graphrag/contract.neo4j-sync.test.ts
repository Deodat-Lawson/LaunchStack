import { describe, it, expect } from "@jest/globals";
import { Neo4jSyncResultSchema } from "./contracts/gemma-schemas";

describe("Contract: Neo4j Sync Result", () => {
    it("sync result with dynamic relationship types conforms to schema", () => {
        const result = {
            entities: 5,
            mentions: 12,
            relationships: 8,
            dynamicRelTypes: ["CEO_OF", "HEADQUARTERED_IN", "ACQUIRED", "CO_OCCURS"],
            durationMs: 342,
        };
        expect(Neo4jSyncResultSchema.safeParse(result).success).toBe(true);
    });

    it("sync result with zero relationships conforms to schema", () => {
        const result = {
            entities: 0,
            mentions: 0,
            relationships: 0,
            dynamicRelTypes: [],
            durationMs: 0,
        };
        expect(Neo4jSyncResultSchema.safeParse(result).success).toBe(true);
    });

    it("sync result with only CO_OCCURS (BERT-only) conforms to schema", () => {
        const result = {
            entities: 10,
            mentions: 25,
            relationships: 15,
            dynamicRelTypes: ["CO_OCCURS"],
            durationMs: 150,
        };
        expect(Neo4jSyncResultSchema.safeParse(result).success).toBe(true);
    });

    it("rejects negative entity count", () => {
        const result = {
            entities: -1,
            mentions: 0,
            relationships: 0,
            dynamicRelTypes: [],
            durationMs: 0,
        };
        expect(Neo4jSyncResultSchema.safeParse(result).success).toBe(false);
    });

    it("rejects missing dynamicRelTypes field", () => {
        const result = {
            entities: 5,
            mentions: 12,
            relationships: 8,
            durationMs: 342,
        };
        expect(Neo4jSyncResultSchema.safeParse(result).success).toBe(false);
    });

    it("rejects non-integer entity count", () => {
        const result = {
            entities: 5.5,
            mentions: 12,
            relationships: 8,
            dynamicRelTypes: [],
            durationMs: 342,
        };
        expect(Neo4jSyncResultSchema.safeParse(result).success).toBe(false);
    });
});
