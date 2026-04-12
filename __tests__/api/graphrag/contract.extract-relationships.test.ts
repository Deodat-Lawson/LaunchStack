import {
    ExtractRelationshipsResponseSchema,
    ExtractionEntitySchema,
    ExtractionRelationshipSchema,
} from "./contracts/graphrag-schemas";

const validEntity = { name: "Apple", type: "ORGANIZATION" as const };
const validRelationship = { source: "Apple", target: "Tim Cook", type: "LED_BY", detail: "CEO" };

describe("contract: extract-relationships", () => {
    describe("ExtractionEntitySchema", () => {
        it("accepts all valid entity types", () => {
            const types = ["PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "EVENT", "OTHER"] as const;
            for (const type of types) {
                const result = ExtractionEntitySchema.safeParse({ name: "Test", type });
                expect(result.success).toBe(true);
            }
        });

        it("rejects empty name", () => {
            const result = ExtractionEntitySchema.safeParse({ name: "", type: "PERSON" });
            expect(result.success).toBe(false);
        });

        it("rejects invalid entity type", () => {
            const result = ExtractionEntitySchema.safeParse({ name: "Apple", type: "COMPANY" });
            expect(result.success).toBe(false);
        });
    });

    describe("ExtractionRelationshipSchema", () => {
        it("accepts a valid SCREAMING_SNAKE_CASE relationship", () => {
            const result = ExtractionRelationshipSchema.safeParse(validRelationship);
            expect(result.success).toBe(true);
        });

        it("accepts single-word uppercase type", () => {
            const result = ExtractionRelationshipSchema.safeParse({ ...validRelationship, type: "OWNS" });
            expect(result.success).toBe(true);
        });

        it("rejects lowercase type", () => {
            const result = ExtractionRelationshipSchema.safeParse({ ...validRelationship, type: "led_by" });
            expect(result.success).toBe(false);
        });

        it("rejects mixed-case type", () => {
            const result = ExtractionRelationshipSchema.safeParse({ ...validRelationship, type: "Led_By" });
            expect(result.success).toBe(false);
        });

        it("rejects empty source", () => {
            const result = ExtractionRelationshipSchema.safeParse({ ...validRelationship, source: "" });
            expect(result.success).toBe(false);
        });

        it("rejects empty target", () => {
            const result = ExtractionRelationshipSchema.safeParse({ ...validRelationship, target: "" });
            expect(result.success).toBe(false);
        });
    });

    describe("ExtractRelationshipsResponseSchema", () => {
        it("accepts a valid single-chunk response", () => {
            const result = ExtractRelationshipsResponseSchema.safeParse({
                results: [
                    {
                        text: "Apple is led by Tim Cook.",
                        entities: [validEntity, { name: "Tim Cook", type: "PERSON" }],
                        relationships: [validRelationship],
                        dropped_relationships: [],
                    },
                ],
                total_entities: 2,
                total_relationships: 1,
                total_dropped: 0,
            });
            expect(result.success).toBe(true);
        });

        it("accepts a valid multi-chunk response", () => {
            const result = ExtractRelationshipsResponseSchema.safeParse({
                results: [
                    {
                        text: "Chunk 1.",
                        entities: [validEntity],
                        relationships: [validRelationship],
                        dropped_relationships: [],
                    },
                    {
                        text: "Chunk 2.",
                        entities: [{ name: "Microsoft", type: "ORGANIZATION" }],
                        relationships: [{ source: "Microsoft", target: "Satya Nadella", type: "LED_BY", detail: "CEO" }],
                        dropped_relationships: [],
                    },
                ],
                total_entities: 2,
                total_relationships: 2,
                total_dropped: 0,
            });
            expect(result.success).toBe(true);
        });

        it("accepts an empty response", () => {
            const result = ExtractRelationshipsResponseSchema.safeParse({
                results: [],
                total_entities: 0,
                total_relationships: 0,
                total_dropped: 0,
            });
            expect(result.success).toBe(true);
        });

        it("accepts dropped_relationships", () => {
            const result = ExtractRelationshipsResponseSchema.safeParse({
                results: [
                    {
                        text: "Some text.",
                        entities: [validEntity],
                        relationships: [],
                        dropped_relationships: [validRelationship],
                    },
                ],
                total_entities: 1,
                total_relationships: 0,
                total_dropped: 1,
            });
            expect(result.success).toBe(true);
        });

        it("rejects invalid entity type in results", () => {
            const result = ExtractRelationshipsResponseSchema.safeParse({
                results: [
                    {
                        text: "Some text.",
                        entities: [{ name: "Apple", type: "COMPANY" }],
                        relationships: [],
                        dropped_relationships: [],
                    },
                ],
                total_entities: 1,
                total_relationships: 0,
                total_dropped: 0,
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing total_relationships field", () => {
            const result = ExtractRelationshipsResponseSchema.safeParse({
                results: [],
                total_entities: 0,
                total_dropped: 0,
            });
            expect(result.success).toBe(false);
        });
    });
});
