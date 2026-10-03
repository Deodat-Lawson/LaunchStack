/**
 * Writing a note row, and what has to follow every write.
 *
 * A note is persisted first; its embedding (ADR-003 outbox) and its wiki-link
 * rows are post-commit side effects. Those may fail — the outbox enqueue, a
 * link sync — but must never fail the save that already happened: they log
 * loudly and the embedding catches up on the next edit. Every note writer
 * goes through here so that rule lives in one place: `POST /api/notes`, and
 * the follow-up note LaunchStack writes after an assistant saves a
 * conversation (`~/server/assistant-conversations/follow-up`).
 *
 * Bodies: the editor sends `contentRich` (Tiptap JSON, the source of truth
 * for editing) and `contentMarkdown` (its projection, the embedding input).
 * A note written on the server sends markdown only and leaves `contentRich`
 * null — the editor parses the markdown when the note is opened, the same as
 * for the notes the agent captures.
 */

import type { JSONContent } from "@tiptap/react";

import type { DocumentScope } from "~/lib/authz/scope-types";
import { db } from "~/server/db";
import { documentNotes } from "~/server/db/schema";
import { requestNoteEmbedding } from "~/server/notes/embed-note";
import { syncNoteLinks } from "~/server/notes/wiki-links";

export type DocumentNoteRow = typeof documentNotes.$inferSelect;

/** Anything that can run a Drizzle insert/update: `db` or a transaction. */
type NoteWriter = Pick<typeof db, "insert" | "update">;

export interface NewNote {
    /** The author (auth user id); only they can list or edit it. */
    authUserId: string;
    /** The workspace the note belongs to. */
    companyId: bigint;
    /** The document it is attached to; validated by the caller. */
    documentId?: string | null;
    versionId?: number | string | null;
    title?: string | null;
    content?: string | null;
    contentRich?: unknown;
    contentMarkdown?: string | null;
    anchor?: unknown;
    anchorStatus?: string | null;
    tags?: string[];
}

/** Insert the row only. Use inside a transaction, then {@link afterNoteWrite} once it commits. */
export async function insertNoteRow(
    writer: NoteWriter,
    note: NewNote
): Promise<DocumentNoteRow | undefined> {
    const [row] = await writer
        .insert(documentNotes)
        .values({
            userId: note.authUserId,
            documentId: note.documentId ?? null,
            companyId: String(note.companyId),
            versionId:
                note.versionId !== undefined && note.versionId !== null
                    ? BigInt(note.versionId)
                    : null,
            title: note.title ?? null,
            content: note.content ?? null,
            contentRich: note.contentRich ?? null,
            contentMarkdown: note.contentMarkdown ?? null,
            anchor: note.anchor ?? null,
            anchorStatus: note.anchorStatus ?? "resolved",
            tags: note.tags ?? [],
        })
        .returning();
    return row;
}

/**
 * The post-commit side effects of creating or updating a note: queue its
 * embedding and re-sync its outgoing wiki links. Never throws.
 */
export async function afterNoteWrite(
    note: Pick<DocumentNoteRow, "id" | "companyId" | "contentRich">,
    reason: "created" | "updated",
    context: { companyId: bigint; scope: DocumentScope }
): Promise<void> {
    try {
        // The writers here always stamp the active workspace, so the hint is
        // only a guard for legacy rows that came back with a null companyId.
        await requestNoteEmbedding(note.id, reason, note.companyId ?? String(context.companyId));
    } catch (err) {
        console.error(
            `[notes] requestNoteEmbedding failed for note ${note.id} (note saved; embedding deferred to next edit):`,
            err
        );
    }
    await syncNoteLinks({
        noteId: note.id,
        rich: (note.contentRich as JSONContent | null) ?? null,
        companyId: note.companyId,
        scope: context.scope,
    }).catch(err => console.error("[syncNoteLinks] failed:", err));
}

/** Create a note and run its side effects. The caller has validated the target. */
export async function createNote(
    note: NewNote,
    scope: DocumentScope
): Promise<DocumentNoteRow | undefined> {
    const row = await insertNoteRow(db, note);
    if (row) await afterNoteWrite(row, "created", { companyId: note.companyId, scope });
    return row;
}
