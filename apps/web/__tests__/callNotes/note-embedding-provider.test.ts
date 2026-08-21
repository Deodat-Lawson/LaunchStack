const mockEmbeddingClientOptions: Array<Record<string, unknown>> = [];
const mockVector = Array.from({ length: 1536 }, (_, index) => index / 1536);

jest.mock("@langchain/openai", () => ({
    OpenAIEmbeddings: jest.fn().mockImplementation((options: Record<string, unknown>) => {
        mockEmbeddingClientOptions.push(options);
        return {
            embedDocuments: jest.fn().mockResolvedValue([mockVector]),
            embedQuery: jest.fn().mockResolvedValue(mockVector),
        };
    }),
}));

jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/server/db/index", () => ({
    db: { execute: jest.fn().mockResolvedValue([]) },
    toRows: (value: unknown) => value,
}));

import {
    embedNoteWithDependencies,
    type NoteEmbeddingProjection,
    type NoteEmbeddingSnapshot,
    type NoteEmbeddingStore,
} from "~/server/notes/embed-note";
import { NOTE_EMBEDDING_INDEX, resolveNoteEmbeddingRuntime } from "~/server/notes/embedding-config";
import { searchNotes } from "~/server/notes/search";
import { db as mockedSearchDb } from "~/server/db/index";

const mockExecute = mockedSearchDb.execute as jest.Mock;

describe("legacy note embedding provider consistency", () => {
    const previousBaseUrl = process.env.EMBEDDING_API_BASE_URL;
    const previousKey = process.env.EMBEDDING_API_KEY;

    beforeAll(() => {
        process.env.EMBEDDING_API_BASE_URL = "https://embedding.example/v1";
        process.env.EMBEDDING_API_KEY = "test-key";
    });

    afterAll(() => {
        if (previousBaseUrl === undefined) delete process.env.EMBEDDING_API_BASE_URL;
        else process.env.EMBEDDING_API_BASE_URL = previousBaseUrl;
        if (previousKey === undefined) delete process.env.EMBEDDING_API_KEY;
        else process.env.EMBEDDING_API_KEY = previousKey;
    });

    beforeEach(() => {
        mockEmbeddingClientOptions.length = 0;
        mockExecute.mockClear();
    });

    it("uses the same fixed legacy model and dimensions for note writes and note queries", async () => {
        const snapshot: NoteEmbeddingSnapshot = {
            note: {
                id: 5,
                userId: "owner",
                companyId: "9",
                documentId: null,
                versionId: null,
                title: "Note",
                content: null,
                contentMarkdown: "Body",
                anchor: null,
                createdAt: new Date("2026-08-21T00:00:00.000Z"),
                updatedAt: null,
            },
            call: null,
        };
        let written: NoteEmbeddingProjection | null = null;
        const store: NoteEmbeddingStore = {
            loadSnapshot: async () => snapshot,
            removeProjection: async () => undefined,
            removeIfCurrent: async () => "removed",
            replaceIfCurrent: async (_expected, projection) => {
                written = projection;
                return "written";
            },
        };

        const writeRuntime = resolveNoteEmbeddingRuntime();
        expect(writeRuntime).not.toBeNull();
        await embedNoteWithDependencies(5, { store, runtime: writeRuntime });

        await searchNotes({
            userId: "owner",
            companyId: "9",
            query: "body",
            scope: "company",
        });

        expect(mockEmbeddingClientOptions).toHaveLength(2);
        expect(mockEmbeddingClientOptions).toEqual([
            expect.objectContaining({
                modelName: NOTE_EMBEDDING_INDEX.model,
                dimensions: NOTE_EMBEDDING_INDEX.dimension,
            }),
            expect.objectContaining({
                modelName: NOTE_EMBEDDING_INDEX.model,
                dimensions: NOTE_EMBEDDING_INDEX.dimension,
            }),
        ]);
        expect(written).toMatchObject({
            modelVersion: NOTE_EMBEDDING_INDEX.model,
            embeddingShort: mockVector.slice(0, NOTE_EMBEDDING_INDEX.shortDimension),
        });
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });
});
