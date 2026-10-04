import { DELETE, PUT } from "~/app/api/notes/[noteId]/route";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import {
    documentNotes as mockDocumentNotes,
    documentNoteEmbeddings as mockDocumentNoteEmbeddings,
    noteLinks as mockNoteLinks,
} from "~/server/db/schema";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: jest.fn(),
}));
jest.mock("~/server/notes/document-scope", () => ({
    isNoteDocumentVisible: jest.fn().mockResolvedValue(true),
}));
jest.mock("~/server/notes/embed-note", () => ({
    requestNoteEmbedding: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("~/server/notes/wiki-links", () => ({
    syncNoteLinks: jest.fn().mockResolvedValue(undefined),
}));

const initialNote = {
    id: 41,
    userId: "user-a",
    companyId: "5",
    documentId: null,
    versionId: null,
    title: "Meeting summary",
    content: "Original content",
    contentRich: null,
    contentMarkdown: "# Original content",
    anchor: null,
    anchorStatus: "resolved",
    tags: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: null,
};
let mockNote: typeof initialNote | null;
let mockCanonicalCallId: string | null;
let mockHasEmbedding: boolean;
let mockHasOutgoingLink: boolean;

jest.mock("~/server/db", () => ({
    db: {
        select: () => {
            const builder: Record<string, unknown> = {
                from: () => builder,
                leftJoin: () => builder,
                where: () =>
                    Promise.resolve(mockNote ? [{ ...mockNote, callId: mockCanonicalCallId }] : []),
            };
            return builder;
        },
        update: () => ({
            set: (changes: Partial<typeof initialNote>) => ({
                where: () => ({
                    returning: async () => {
                        if (!mockNote) return [];
                        mockNote = { ...mockNote, ...changes };
                        return [mockNote];
                    },
                }),
            }),
        }),
        delete: (table: unknown) => ({
            where: () => {
                if (table === mockDocumentNotes) {
                    return {
                        returning: async () => {
                            const deleted = mockNote;
                            mockNote = null;
                            return deleted ? [deleted] : [];
                        },
                    };
                }
                if (table === mockDocumentNoteEmbeddings) mockHasEmbedding = false;
                if (table === mockNoteLinks) mockHasOutgoingLink = false;
                return Promise.resolve();
            },
        }),
    },
}));

function request(method: "DELETE" | "PUT") {
    return new Request("http://localhost/api/notes/41", {
        method,
        ...(method === "PUT"
            ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ contentMarkdown: "# Updated content" }),
              }
            : {}),
    });
}

const params = { params: Promise.resolve({ noteId: "41" }) };

describe("canonical Call Notes through the generic notes API", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockNote = { ...initialNote };
        mockCanonicalCallId = null;
        mockHasEmbedding = true;
        mockHasOutgoingLink = true;
        (requireWorkspaceContext as jest.Mock).mockResolvedValue({
            success: true,
            data: makeWorkspaceContext({ role: "member" }),
        });
    });

    it.each(["DELETE", "PUT"] as const)(
        "refuses %s of a Call's canonical note without changing the note or its derived data",
        async method => {
            mockCanonicalCallId = "canonical-call";

            const response = await (method === "DELETE" ? DELETE : PUT)(request(method), params);

            expect(response.status).toBe(409);
            expect(await response.json()).toEqual({ error: "Call Notes are managed from Calls" });
            expect(mockNote).toEqual(initialNote);
            expect(mockHasEmbedding).toBe(true);
            expect(mockHasOutgoingLink).toBe(true);
        }
    );

    it("still deletes an ordinary note and its derived data", async () => {
        const response = await DELETE(request("DELETE"), params);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(mockNote).toBeNull();
        expect(mockHasEmbedding).toBe(false);
        expect(mockHasOutgoingLink).toBe(false);
    });

    it("still saves content changes to an ordinary note", async () => {
        const response = await PUT(request("PUT"), params);

        expect(response.status).toBe(200);
        expect(mockNote?.contentMarkdown).toBe("# Updated content");
    });

    it.each(["DELETE", "PUT"] as const)(
        "keeps %s of a missing note indistinguishable from not found",
        async method => {
            mockNote = null;
            mockCanonicalCallId = "another-users-call";

            const response = await (method === "DELETE" ? DELETE : PUT)(request(method), params);

            expect(response.status).toBe(404);
            expect(await response.json()).toEqual({ error: "Note not found" });
            expect(mockHasEmbedding).toBe(true);
            expect(mockHasOutgoingLink).toBe(true);
        }
    );
});
