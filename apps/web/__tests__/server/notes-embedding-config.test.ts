import { DEFAULT_EMBEDDING_MODEL, resolveEmbeddingConfig } from "~/server/notes/embedding-config";

const KEYS = [
    "EMBEDDING_API_BASE_URL",
    "EMBEDDING_API_KEY",
    "EMBEDDING_MODEL",
    "AI_BASE_URL",
    "AI_API_KEY",
    "OPENAI_API_KEY",
] as const;

describe("notes embedding config", () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of KEYS) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    it("sends the configured model to the dedicated embedding endpoint", () => {
        // Gemini 404s on text-embedding-3-large; the note pipeline used to send it anyway.
        process.env.EMBEDDING_API_BASE_URL =
            "https://generativelanguage.googleapis.com/v1beta/openai";
        process.env.EMBEDDING_API_KEY = "k";
        process.env.EMBEDDING_MODEL = "gemini-embedding-001";

        expect(resolveEmbeddingConfig()).toEqual({
            apiKey: "k",
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
            model: "gemini-embedding-001",
        });
    });

    it("keeps the OpenAI default when the endpoint names no model", () => {
        process.env.EMBEDDING_API_BASE_URL = "https://api.openai.com/v1";
        process.env.EMBEDDING_API_KEY = "k";

        expect(resolveEmbeddingConfig().model).toBe(DEFAULT_EMBEDDING_MODEL);
    });

    it("never pairs EMBEDDING_MODEL with the global AI endpoint", () => {
        process.env.AI_BASE_URL = "https://api.example.com/v1";
        process.env.AI_API_KEY = "k";
        process.env.EMBEDDING_MODEL = "gemini-embedding-001";

        expect(resolveEmbeddingConfig().model).toBe(DEFAULT_EMBEDDING_MODEL);
    });
});
