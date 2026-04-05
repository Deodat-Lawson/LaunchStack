import { describe, it, expect } from "@jest/globals";
import {
    EntityWithEmbeddingSchema,
    ExtractEntitiesEnhancedResponseSchema,
} from "./contracts/gemma-schemas";

describe("Contract: POST /extract-entities?include_embeddings=true", () => {
    it("entity with 768-dim embedding conforms to schema", () => {
        const entity = {
            text: "Microsoft",
            label: "ORG",
            score: 0.98,
            embedding: Array(768).fill(0.01),
        };
        expect(EntityWithEmbeddingSchema.safeParse(entity).success).toBe(true);
    });

    it("rejects entity with wrong embedding dimension", () => {
        const entity = {
            text: "Microsoft",
            label: "ORG",
            score: 0.98,
            embedding: Array(512).fill(0.01),
        };
        expect(EntityWithEmbeddingSchema.safeParse(entity).success).toBe(false);
    });

    it("rejects entity with empty embedding", () => {
        const entity = {
            text: "Microsoft",
            label: "ORG",
            score: 0.98,
            embedding: [],
        };
        expect(EntityWithEmbeddingSchema.safeParse(entity).success).toBe(false);
    });

    it("full enhanced response conforms to schema", () => {
        const response = {
            results: [
                {
                    text: "Tim Cook is CEO of Apple.",
                    entities: [
                        {
                            text: "Tim Cook",
                            label: "PER",
                            score: 0.95,
                            embedding: Array(768).fill(0.02),
                        },
                        {
                            text: "Apple",
                            label: "ORG",
                            score: 0.99,
                            embedding: Array(768).fill(-0.01),
                        },
                    ],
                },
            ],
            total_entities: 2,
        };
        expect(ExtractEntitiesEnhancedResponseSchema.safeParse(response).success).toBe(true);
    });

    it("empty enhanced response conforms to schema", () => {
        const response = {
            results: [],
            total_entities: 0,
        };
        expect(ExtractEntitiesEnhancedResponseSchema.safeParse(response).success).toBe(true);
    });

    it("rejects score outside 0-1 range", () => {
        const entity = {
            text: "Microsoft",
            label: "ORG",
            score: 1.5,
            embedding: Array(768).fill(0.01),
        };
        expect(EntityWithEmbeddingSchema.safeParse(entity).success).toBe(false);
    });
});
