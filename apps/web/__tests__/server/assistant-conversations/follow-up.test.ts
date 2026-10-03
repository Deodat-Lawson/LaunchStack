/**
 * The follow-up note after a save: written once, refreshed in place on a
 * re-save, never written from a stale run, and a model failure leaves the
 * saved conversation alone and the row saying `failed`.
 */

import {
    FOLLOW_UP_TAG,
    renderFollowUpNote,
    writeFollowUp,
    type FollowUpJob,
} from "~/server/assistant-conversations/follow-up";
import type { FollowUpContent } from "~/server/assistant-conversations/follow-up-model";
import { SCOPE_EVERYTHING } from "~/lib/authz/scope-types";
import { assistantConversations, documentNotes } from "~/server/db/schema";
import { requestNoteEmbedding } from "~/server/notes/embed-note";
import { syncNoteLinks } from "~/server/notes/wiki-links";

import { fakeDb } from "../../helpers/fake-db";

jest.mock("~/server/db", () => ({ db: jest.requireActual("../../helpers/fake-db").fakeDb.db }));
jest.mock("~/server/notes/embed-note", () => ({
    requestNoteEmbedding: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("~/server/notes/wiki-links", () => ({
    syncNoteLinks: jest.fn().mockResolvedValue(undefined),
}));
// The model seam is passed in per call; keep the real one (and its config) out.
jest.mock("~/server/assistant-conversations/follow-up-model", () => ({
    generateFollowUpContent: jest.fn(),
}));

const CONTENT: FollowUpContent = {
    summary: "The team chose usage pricing for the pilot.\n## not a heading",
    decisions: ["Charge per seat", "- Start in November"],
    actionItems: ["1. Draft the price page", "[ ] Email Globex by Friday", "   "],
    openQuestions: [],
};

function job(overrides: Partial<FollowUpJob> = {}): FollowUpJob {
    return {
        conversationRowId: 3,
        documentId: 40,
        companyId: BigInt(5),
        authUserId: "ada",
        title: "Pricing",
        family: "claude",
        contentHash: "h1",
        messages: [
            { role: "user", content: "Price?", at: null },
            { role: "assistant", content: "Per seat.", at: null },
        ],
        documentScope: () => Promise.resolve(SCOPE_EVERYTHING),
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
});

describe("renderFollowUpNote", () => {
    it("always has Summary, Decisions and Action items, as clean one-line bullets", () => {
        const markdown = renderFollowUpNote(CONTENT, "claude");
        expect(markdown).toContain(
            "## Summary\n\nThe team chose usage pricing for the pilot.\nnot a heading"
        );
        expect(markdown).toContain("## Decisions\n\n- Charge per seat\n- Start in November");
        expect(markdown).toContain(
            "## Action items\n\n- Draft the price page\n- Email Globex by Friday"
        );
        expect(markdown).not.toContain("Open questions");
        expect(markdown).toMatch(/^\*Written by LaunchStack from this conversation with Claude\./);
    });

    it("says when a section is empty, and adds Open questions only when there are some", () => {
        const markdown = renderFollowUpNote(
            { summary: "Short.", decisions: [], actionItems: [], openQuestions: ["Who signs?"] },
            "chatgpt"
        );
        expect(markdown).toContain("## Decisions\n\nNo decisions were made.");
        expect(markdown).toContain("## Action items\n\nNo action items.");
        expect(markdown).toContain("## Open questions\n\n- Who signs?");
        expect(markdown).toContain("with ChatGPT");
    });
});

describe("writeFollowUp", () => {
    it("writes the note, owned by the saver and attached to the conversation, then marks done", async () => {
        fakeDb.onSelect(assistantConversations, [{ contentHash: "h1", followUpNoteId: null }]);
        const generate = jest.fn().mockResolvedValue(CONTENT);

        await expect(writeFollowUp(job(), generate)).resolves.toBe("done");

        expect(generate).toHaveBeenCalledWith({
            title: "Pricing",
            family: "claude",
            messages: job().messages,
        });
        const [note] = fakeDb.insertedInto(documentNotes);
        expect(note).toMatchObject({
            userId: "ada",
            companyId: "5",
            documentId: "40",
            title: "Follow-up: Pricing",
            contentRich: null,
            tags: [FOLLOW_UP_TAG, "claude"],
        });
        expect(note!.contentMarkdown).toContain("## Summary");
        expect(note!.contentMarkdown).toContain("## Decisions");
        expect(note!.contentMarkdown).toContain("## Action items");

        expect(fakeDb.updatesOf(assistantConversations)).toEqual([
            { followUpNoteId: 1000, followUpStatus: "done", followUpError: null },
        ]);
        expect(requestNoteEmbedding).toHaveBeenCalledWith(1000, "created", "5");
        expect(syncNoteLinks).toHaveBeenCalledWith(
            expect.objectContaining({ noteId: 1000, rich: null, scope: SCOPE_EVERYTHING })
        );
    });

    it("refreshes the same note on a re-save and re-embeds it", async () => {
        fakeDb.onSelect(assistantConversations, [{ contentHash: "h2", followUpNoteId: 900 }]);
        fakeDb.onReturning(documentNotes, [{ id: 900, companyId: "5", contentRich: null }]);

        await expect(
            writeFollowUp(job({ contentHash: "h2" }), jest.fn().mockResolvedValue(CONTENT))
        ).resolves.toBe("done");

        expect(fakeDb.insertedInto(documentNotes)).toHaveLength(0);
        const [noteUpdate] = fakeDb.updatesOf(documentNotes);
        expect(noteUpdate).toMatchObject({
            title: "Follow-up: Pricing",
            contentRich: null,
            tags: [FOLLOW_UP_TAG, "claude"],
        });
        expect(noteUpdate!.contentMarkdown).toContain("## Action items");
        expect(fakeDb.updatesOf(assistantConversations)).toEqual([
            { followUpNoteId: 900, followUpStatus: "done", followUpError: null },
        ]);
        expect(requestNoteEmbedding).toHaveBeenCalledWith(900, "updated", "5");
    });

    it("writes a new note when the person deleted the earlier one", async () => {
        fakeDb.onSelect(assistantConversations, [{ contentHash: "h1", followUpNoteId: 900 }]);
        // The update matches no row: the note is gone.
        await expect(writeFollowUp(job(), jest.fn().mockResolvedValue(CONTENT))).resolves.toBe(
            "done"
        );
        expect(fakeDb.insertedInto(documentNotes)).toHaveLength(1);
        expect(requestNoteEmbedding).toHaveBeenCalledWith(1000, "created", "5");
    });

    it("on a model failure, keeps the conversation and records failed with the error", async () => {
        fakeDb.onSelect(assistantConversations, [{ contentHash: "h1", followUpNoteId: null }]);
        const generate = jest.fn().mockRejectedValue(new Error("upstream 503"));

        await expect(writeFollowUp(job(), generate)).resolves.toBe("failed");

        expect(fakeDb.insertedInto(documentNotes)).toHaveLength(0);
        expect(fakeDb.deletes).toHaveLength(0);
        // The only write is the status on the conversation's row — nothing to the document.
        expect(fakeDb.updates.map(u => u.table)).toEqual([assistantConversations]);
        expect(fakeDb.updatesOf(assistantConversations)).toEqual([
            { followUpStatus: "failed", followUpError: "upstream 503" },
        ]);
        expect(requestNoteEmbedding).not.toHaveBeenCalled();
    });

    it("records failed when the note cannot be written", async () => {
        fakeDb.onSelect(assistantConversations, [{ contentHash: "h1", followUpNoteId: null }]);
        fakeDb.onReturning(documentNotes, []);

        await expect(writeFollowUp(job(), jest.fn().mockResolvedValue(CONTENT))).resolves.toBe(
            "failed"
        );
        expect(fakeDb.updatesOf(assistantConversations)).toEqual([
            { followUpStatus: "failed", followUpError: "The follow-up note was not written" },
        ]);
    });

    it("writes nothing when a newer save changed the conversation meanwhile", async () => {
        // This run was generated from h1; the row has moved on to h2.
        fakeDb.onSelect(assistantConversations, [{ contentHash: "h2", followUpNoteId: 900 }]);

        await expect(writeFollowUp(job(), jest.fn().mockResolvedValue(CONTENT))).resolves.toBe(
            "stale"
        );

        expect(fakeDb.insertedInto(documentNotes)).toHaveLength(0);
        expect(fakeDb.updates).toHaveLength(0);
        expect(requestNoteEmbedding).not.toHaveBeenCalled();
    });

    it("still counts the note as written when its embedding cannot be queued", async () => {
        fakeDb.onSelect(assistantConversations, [{ contentHash: "h1", followUpNoteId: null }]);
        (requestNoteEmbedding as jest.Mock).mockRejectedValueOnce(new Error("outbox down"));

        await expect(writeFollowUp(job(), jest.fn().mockResolvedValue(CONTENT))).resolves.toBe(
            "done"
        );
        expect(fakeDb.updatesOf(assistantConversations)).toEqual([
            { followUpNoteId: 1000, followUpStatus: "done", followUpError: null },
        ]);
    });
});
