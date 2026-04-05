import { describe, it, expect } from "@jest/globals";
import {
    GemmaExtractionResponseSchema,
    GemmaEntitySchema,
    GemmaRelationshipSchema,
    GemmaChunkResultSchema,
} from "./contracts/gemma-schemas";

describe("Contract: POST /extract-relationships", () => {
    it("single-chunk response conforms to GemmaExtractionResponseSchema", () => {
        const response = {
            results: [
                {
                    text: "Apple was founded by Steve Jobs.",
                    entities: [
                        { name: "Apple", type: "ORGANIZATION" },
                        { name: "Steve Jobs", type: "PERSON" },
                    ],
                    relationships: [
                        { source: "Steve Jobs", target: "Apple", type: "FOUNDED", detail: "Co-founder" },
                    ],
                    dropped_relationships: [],
                },
            ],
            total_entities: 2,
            total_relationships: 1,
            total_dropped: 0,
        };
        expect(GemmaExtractionResponseSchema.safeParse(response).success).toBe(true);
    });

    it("multi-chunk response conforms to schema", () => {
        const response = {
            results: [
                {
                    text: "Tim Cook is CEO of Apple.",
                    entities: [
                        { name: "Tim Cook", type: "PERSON" },
                        { name: "Apple", type: "ORGANIZATION" },
                    ],
                    relationships: [
                        { source: "Tim Cook", target: "Apple", type: "CEO_OF", detail: "Current CEO" },
                    ],
                    dropped_relationships: [],
                },
                {
                    text: "Apple is headquartered in Cupertino.",
                    entities: [
                        { name: "Apple", type: "ORGANIZATION" },
                        { name: "Cupertino", type: "LOCATION" },
                    ],
                    relationships: [
                        { source: "Apple", target: "Cupertino", type: "HEADQUARTERED_IN", detail: "HQ location" },
                    ],
                    dropped_relationships: [],
                },
            ],
            total_entities: 3,
            total_relationships: 2,
            total_dropped: 0,
        };
        expect(GemmaExtractionResponseSchema.safeParse(response).success).toBe(true);
    });

    it("empty response conforms to schema (Gemma unavailable)", () => {
        const response = {
            results: [],
            total_entities: 0,
            total_relationships: 0,
            total_dropped: 0,
        };
        expect(GemmaExtractionResponseSchema.safeParse(response).success).toBe(true);
    });

    it("response with dropped relationships conforms to schema", () => {
        const response = {
            results: [
                {
                    text: "Tim Cook is CEO of Apple.",
                    entities: [
                        { name: "Tim Cook", type: "PERSON" },
                        { name: "Apple", type: "ORGANIZATION" },
                    ],
                    relationships: [
                        { source: "Tim Cook", target: "Apple", type: "CEO_OF", detail: "Current CEO" },
                    ],
                    dropped_relationships: [
                        { source: "Tim Cook", target: "CEO_OF", type: "WORKS_FOR", detail: "field bleed error" },
                    ],
                },
            ],
            total_entities: 2,
            total_relationships: 1,
            total_dropped: 1,
        };
        expect(GemmaExtractionResponseSchema.safeParse(response).success).toBe(true);
    });

    it("rejects relationship type that is not SCREAMING_SNAKE_CASE", () => {
        const badRel = { source: "A", target: "B", type: "ceo_of", detail: "test" };
        expect(GemmaRelationshipSchema.safeParse(badRel).success).toBe(false);
    });

    it("rejects relationship type with spaces", () => {
        const badRel = { source: "A", target: "B", type: "CEO OF", detail: "test" };
        expect(GemmaRelationshipSchema.safeParse(badRel).success).toBe(false);
    });

    it("rejects entity with empty name", () => {
        const badEntity = { name: "", type: "PERSON" };
        expect(GemmaEntitySchema.safeParse(badEntity).success).toBe(false);
    });

    it("rejects entity with invalid type", () => {
        const badEntity = { name: "Apple", type: "COMPANY" };
        expect(GemmaEntitySchema.safeParse(badEntity).success).toBe(false);
    });

    it("rejects relationship with empty source", () => {
        const badRel = { source: "", target: "B", type: "CEO_OF", detail: "test" };
        expect(GemmaRelationshipSchema.safeParse(badRel).success).toBe(false);
    });

    it("rejects relationship with empty target", () => {
        const badRel = { source: "A", target: "", type: "CEO_OF", detail: "test" };
        expect(GemmaRelationshipSchema.safeParse(badRel).success).toBe(false);
    });

    it("accepts relationship types with numbers", () => {
        const rel = { source: "A", target: "B", type: "VERSION_2_OF", detail: "test" };
        expect(GemmaRelationshipSchema.safeParse(rel).success).toBe(true);
    });
});
