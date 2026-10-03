/**
 * The shared note writer behind `POST /api/notes` and the follow-up notes
 * LaunchStack writes: the row it inserts, and the post-commit side effects
 * that log but never fail a save that already happened.
 */

import { SCOPE_EVERYTHING } from "~/lib/authz/scope-types";
import { documentNotes } from "~/server/db/schema";
import { afterNoteWrite, createNote, insertNoteRow } from "~/server/notes/create-note";
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

const RICH = { type: "doc", content: [{ type: "paragraph" }] };

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
});

describe("insertNoteRow", () => {
    it("stamps the workspace and fills the defaults the route always used", async () => {
        await insertNoteRow(fakeDb.db as never, {
            authUserId: "ada",
            companyId: BigInt(5),
            title: "Hello",
        });
        expect(fakeDb.insertedInto(documentNotes)).toEqual([
            {
                userId: "ada",
                documentId: null,
                companyId: "5",
                versionId: null,
                title: "Hello",
                content: null,
                contentRich: null,
                contentMarkdown: null,
                anchor: null,
                anchorStatus: "resolved",
                tags: [],
            },
        ]);
    });

    it("takes a version id as a number or a numeric string", async () => {
        await insertNoteRow(fakeDb.db as never, {
            authUserId: "ada",
            companyId: BigInt(5),
            documentId: "42",
            versionId: "99",
        });
        await insertNoteRow(fakeDb.db as never, {
            authUserId: "ada",
            companyId: BigInt(5),
            documentId: "42",
            versionId: 98,
        });
        expect(fakeDb.insertedInto(documentNotes).map(n => n.versionId)).toEqual([
            BigInt(99),
            BigInt(98),
        ]);
    });
});

describe("createNote", () => {
    it("inserts, queues the embedding and syncs links from the rich body", async () => {
        const note = await createNote(
            {
                authUserId: "ada",
                companyId: BigInt(5),
                documentId: "42",
                contentRich: RICH,
                contentMarkdown: "hi",
                tags: ["x"],
            },
            SCOPE_EVERYTHING
        );
        expect(note).toMatchObject({ id: 1000, companyId: "5", contentRich: RICH });
        expect(requestNoteEmbedding).toHaveBeenCalledWith(1000, "created", "5");
        expect(syncNoteLinks).toHaveBeenCalledWith({
            noteId: 1000,
            rich: RICH,
            companyId: "5",
            scope: SCOPE_EVERYTHING,
        });
    });
});

describe("afterNoteWrite", () => {
    it("never fails the save when the embedding or link sync fails", async () => {
        (requestNoteEmbedding as jest.Mock).mockRejectedValueOnce(new Error("outbox down"));
        (syncNoteLinks as jest.Mock).mockRejectedValueOnce(new Error("links down"));
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(
            afterNoteWrite({ id: 7, companyId: null, contentRich: null }, "updated", {
                companyId: BigInt(5),
                scope: SCOPE_EVERYTHING,
            })
        ).resolves.toBeUndefined();

        // A legacy row with no company falls back to the acting workspace.
        expect(requestNoteEmbedding).toHaveBeenCalledWith(7, "updated", "5");
        expect(errors).toHaveBeenCalledTimes(2);
        errors.mockRestore();
    });
});
