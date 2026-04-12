import { z } from "zod";

// Test the Zod schema shapes directly (not via parseServerEnv())
// These mirror the schemas defined in src/env.ts

const optionalString = () =>
    z.preprocess(
        (value: unknown) =>
            typeof value === "string" && value.trim().length === 0 ? undefined : value,
        z.string().min(1).optional()
    );

const extractionLlmSchemas = z.object({
    EXTRACTION_LLM_BASE_URL: optionalString(),
    EXTRACTION_LLM_MODEL: optionalString(),
});

const embeddingProviderSchema = z.enum(["bert", "openai-compatible"]).optional();
const embeddingDimensionsSchema = z.coerce.number().int().positive().optional();

const embeddingSchemas = z.object({
    EMBEDDING_PROVIDER: embeddingProviderSchema,
    EMBEDDING_API_URL: optionalString(),
    EMBEDDING_MODEL: optionalString(),
    EMBEDDING_DIMENSIONS: embeddingDimensionsSchema,
});

const backwardCompatSchemas = z.object({
    GEMMA_BASE_URL: optionalString(),
    GEMMA_MODEL: optionalString(),
});

describe("contract: env-vars", () => {
    describe("EXTRACTION_LLM_BASE_URL and EXTRACTION_LLM_MODEL", () => {
        it("parses valid values", () => {
            const result = extractionLlmSchemas.safeParse({
                EXTRACTION_LLM_BASE_URL: "http://localhost:11434/v1",
                EXTRACTION_LLM_MODEL: "gemma3:4b",
            });
            expect(result.success).toBe(true);
        });

        it("accepts undefined (optional)", () => {
            const result = extractionLlmSchemas.safeParse({
                EXTRACTION_LLM_BASE_URL: undefined,
                EXTRACTION_LLM_MODEL: undefined,
            });
            expect(result.success).toBe(true);
        });

        it("treats empty string as undefined (optional)", () => {
            const result = extractionLlmSchemas.safeParse({
                EXTRACTION_LLM_BASE_URL: "",
                EXTRACTION_LLM_MODEL: "",
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.EXTRACTION_LLM_BASE_URL).toBeUndefined();
                expect(result.data.EXTRACTION_LLM_MODEL).toBeUndefined();
            }
        });
    });

    describe("EMBEDDING_PROVIDER enum", () => {
        it("accepts 'bert'", () => {
            const result = embeddingProviderSchema.safeParse("bert");
            expect(result.success).toBe(true);
        });

        it("accepts 'openai-compatible'", () => {
            const result = embeddingProviderSchema.safeParse("openai-compatible");
            expect(result.success).toBe(true);
        });

        it("accepts undefined", () => {
            const result = embeddingProviderSchema.safeParse(undefined);
            expect(result.success).toBe(true);
        });

        it("rejects unknown provider value", () => {
            const result = embeddingProviderSchema.safeParse("anthropic");
            expect(result.success).toBe(false);
        });
    });

    describe("EMBEDDING_DIMENSIONS coercion", () => {
        it("coerces string '768' to number 768", () => {
            const result = embeddingDimensionsSchema.safeParse("768");
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe(768);
            }
        });

        it("coerces string '1536' to number 1536", () => {
            const result = embeddingDimensionsSchema.safeParse("1536");
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe(1536);
            }
        });

        it("accepts undefined", () => {
            const result = embeddingDimensionsSchema.safeParse(undefined);
            expect(result.success).toBe(true);
        });

        it("rejects zero", () => {
            const result = embeddingDimensionsSchema.safeParse("0");
            expect(result.success).toBe(false);
        });

        it("rejects negative number", () => {
            const result = embeddingDimensionsSchema.safeParse("-768");
            expect(result.success).toBe(false);
        });

        it("rejects non-integer float", () => {
            const result = embeddingDimensionsSchema.safeParse("768.5");
            expect(result.success).toBe(false);
        });
    });

    describe("Full embedding schema object", () => {
        it("parses all embedding vars correctly", () => {
            const result = embeddingSchemas.safeParse({
                EMBEDDING_PROVIDER: "openai-compatible",
                EMBEDDING_API_URL: "http://localhost:11434/v1",
                EMBEDDING_MODEL: "nomic-embed-text",
                EMBEDDING_DIMENSIONS: "768",
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.EMBEDDING_PROVIDER).toBe("openai-compatible");
                expect(result.data.EMBEDDING_DIMENSIONS).toBe(768);
            }
        });

        it("accepts all optional vars as undefined", () => {
            const result = embeddingSchemas.safeParse({});
            expect(result.success).toBe(true);
        });
    });

    describe("Backward compatibility: GEMMA_BASE_URL and GEMMA_MODEL", () => {
        it("parses valid Gemma values", () => {
            const result = backwardCompatSchemas.safeParse({
                GEMMA_BASE_URL: "http://localhost:11434/v1",
                GEMMA_MODEL: "gemma4:e4b",
            });
            expect(result.success).toBe(true);
        });

        it("accepts undefined (optional)", () => {
            const result = backwardCompatSchemas.safeParse({
                GEMMA_BASE_URL: undefined,
                GEMMA_MODEL: undefined,
            });
            expect(result.success).toBe(true);
        });
    });
});
