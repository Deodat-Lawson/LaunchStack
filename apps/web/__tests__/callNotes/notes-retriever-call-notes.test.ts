const mockExecute = jest.fn();
jest.mock("~/server/db/index", () => ({
    db: { execute: (...args: unknown[]) => mockExecute(...args) },
    toRows: (value: unknown) => value,
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { createCompanyNotesRetriever } from "~/lib/tools/rag/retrievers/notes-retriever";

const embeddings = {
    embedQuery: jest.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.01)),
};

type RetrieverRow = {
    note_id: number;
    note_user_id: string;
    note_company_id: string | null;
    document_id: string | null;
    company_id: string | null;
    version_id: string | null;
    content: string;
    title: string | null;
    content_markdown: string | null;
    anchor: unknown;
    anchor_status: string | null;
    distance: number;
    call_id: string | null;
    call_company_id: string | null;
    call_status: string | null;
    call_document_note_id: number | null;
    call_owner_user_id: string | null;
    call_visibility: string | null;
    call_knowledge_included: boolean | null;
    call_revision: number | null;
};

function ordinaryNote(overrides: Partial<RetrieverRow> = {}): RetrieverRow {
    return {
        note_id: 10,
        note_user_id: "ordinary-owner",
        note_company_id: "42",
        document_id: "123",
        company_id: "42",
        version_id: "7",
        content: "Ordinary note content",
        title: "Ordinary note",
        content_markdown: "Ordinary note content",
        anchor: null,
        anchor_status: "resolved",
        distance: 0.1,
        call_id: null,
        call_company_id: null,
        call_status: null,
        call_document_note_id: null,
        call_owner_user_id: null,
        call_visibility: null,
        call_knowledge_included: null,
        call_revision: null,
        ...overrides,
    };
}

function callNote(overrides: Partial<RetrieverRow> = {}): RetrieverRow {
    return ordinaryNote({
        note_id: 20,
        note_user_id: "call-owner",
        note_company_id: "42",
        document_id: null,
        version_id: null,
        content: "Accepted canonical Call Note",
        title: "Customer call",
        call_id: "call-20",
        call_company_id: "42",
        call_status: "completed",
        call_document_note_id: 20,
        call_owner_user_id: "call-owner",
        call_visibility: "company",
        call_knowledge_included: true,
        call_revision: 4,
        ...overrides,
    });
}

async function retrieve(rows: RetrieverRow[]) {
    mockExecute.mockResolvedValueOnce(rows);
    return createCompanyNotesRetriever(42, embeddings, 10)._getRelevantDocuments("customer");
}

describe("company NotesRetriever Call Note eligibility", () => {
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

    it("returns an eligible current company Call Note with canonical identity", async () => {
        const [result] = await retrieve([callNote()]);

        expect(result?.pageContent).toContain("Accepted canonical Call Note");
        expect(result?.metadata).toMatchObject({
            source: "call_note",
            noteId: 20,
            callId: "call-20",
            revision: 4,
            companyId: "42",
        });
    });

    it.each([
        ["knowledge disabled", { call_knowledge_included: false }],
        ["private", { call_visibility: "private" }],
        ["active", { call_status: "active" }],
        ["finalizing", { call_status: "finalizing" }],
        ["failed", { call_status: "failed" }],
        ["zero revision", { call_revision: 0 }],
    ] as const)("excludes a %s Call Note projection", async (_label, overrides) => {
        const results = await retrieve([callNote(overrides)]);

        expect(results).toEqual([]);
    });

    it.each([
        ["wrong canonical note", { call_document_note_id: 999 }],
        ["wrong owner", { call_owner_user_id: "different-owner" }],
        ["wrong Call company", { call_company_id: "99" }],
        ["wrong note company", { note_company_id: "99" }],
        ["wrong projection company", { company_id: "99" }],
    ] as const)("fails closed for %s identity", async (_label, overrides) => {
        const results = await retrieve([callNote(overrides)]);

        expect(results).toEqual([]);
    });

    it("keeps the company filter and live Call eligibility predicates in SQL", async () => {
        await retrieve([]);

        const query = mockExecute.mock.calls[0]?.[0] as SQL;
        const compiled = new PgDialect().sqlToQuery(query).sql;
        expect(compiled).toContain("LEFT JOIN");
        expect(compiled).toContain("call_notes_calls");
        expect(compiled).toContain("knowledge_included");
        expect(compiled).toContain("note_visibility");
        expect(compiled).toContain("current_note_revision");
        expect(compiled).toContain("ne.company_id");
    });
});
