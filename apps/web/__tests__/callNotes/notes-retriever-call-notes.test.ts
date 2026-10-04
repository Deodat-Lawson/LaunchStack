const mockExecute = jest.fn();
jest.mock("~/server/db/index", () => ({
    db: { execute: (...args: unknown[]) => mockExecute(...args) },
    toRows: (value: unknown) => value,
}));

import { createCompanyNotesRetriever } from "~/server/notes/notes-retriever";

const embeddings = {
    embedQuery: jest.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.01)),
};

type RetrieverRow = {
    note_id: number;
    document_id: string | null;
    company_id: string | null;
    version_id: string | null;
    content: string;
    title: string | null;
    content_markdown: string | null;
    anchor: unknown;
    anchor_status: string | null;
    distance: number;
};

function ordinaryNote(overrides: Partial<RetrieverRow> = {}): RetrieverRow {
    return {
        note_id: 10,
        document_id: "123",
        company_id: "42",
        version_id: "7",
        content: "Ordinary note content",
        title: "Ordinary note",
        content_markdown: "Ordinary note content",
        anchor: null,
        anchor_status: "resolved",
        distance: 0.1,
        ...overrides,
    };
}

async function retrieve(rows: RetrieverRow[]) {
    mockExecute.mockResolvedValueOnce(rows);
    return createCompanyNotesRetriever(42, embeddings, 10)._getRelevantDocuments("customer");
}

describe("company NotesRetriever ordinary notes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("preserves ordinary company Note behavior and metadata", async () => {
        const [result] = await retrieve([ordinaryNote()]);

        expect(result?.metadata).toMatchObject({
            source: "note",
            noteId: 10,
            documentId: "123",
            companyId: "42",
        });
        expect(result?.metadata).not.toHaveProperty("callId");
    });
});
