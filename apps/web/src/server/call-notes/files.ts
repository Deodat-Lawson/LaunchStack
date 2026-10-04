import { and, desc, eq, or, sql } from "drizzle-orm";

import type { DbClient } from "@launchstack/store/client";
import { CallNotesApplicationError } from "@launchstack/pipelines/call-notes";
import type { CallListQuery, WorkspaceCallNoteFile } from "@launchstack/pipelines/call-notes";
import { callNotesCalls, documentNotes } from "~/server/db/schema";
import { getEngine } from "~/server/engine";
import { createWebCallNotesMembershipStore } from "./application";

function previewText(content: string): string {
    const raw = content.replace(/\s+/g, " ").trim();
    return raw.length > 512 ? `${raw.slice(0, 509)}…` : raw;
}

/**
 * List the active user's visible Call Note files without reading transcript,
 * capture, or enrichment rows. The query is intentionally unbounded: the
 * workspace file collection is not the Calls history's 50-row convenience
 * view, so an older call remains openable from the rail and palette.
 */
export async function listWorkspaceCallNoteFiles(
    query: Pick<CallListQuery, "companyId" | "actorUserId">,
    db: DbClient = getEngine().db
): Promise<readonly WorkspaceCallNoteFile[]> {
    const role = await createWebCallNotesMembershipStore(db).getRole(
        query.companyId,
        query.actorUserId
    );
    if (!role) {
        throw new CallNotesApplicationError("forbidden", "Company membership is required");
    }
    const rows = await db
        .select({
            callId: callNotesCalls.id,
            noteId: documentNotes.id,
            indexedDocumentId: callNotesCalls.indexedDocumentId,
            visibility: callNotesCalls.noteVisibility,
            revision: callNotesCalls.currentNoteRevision,
            updatedAt:
                sql<string>`coalesce(${callNotesCalls.updatedAt}, ${callNotesCalls.createdAt})::text`.mapWith(
                    (value: string) => new Date(value)
                ),
            title: documentNotes.title,
            preview: sql<string>`left(coalesce(${documentNotes.contentMarkdown}, ${documentNotes.content}, ''), 513)`,
        })
        .from(callNotesCalls)
        .innerJoin(documentNotes, eq(documentNotes.id, callNotesCalls.documentNoteId))
        .where(
            and(
                eq(callNotesCalls.companyId, BigInt(query.companyId)),
                eq(documentNotes.companyId, query.companyId),
                eq(documentNotes.userId, callNotesCalls.noteOwnerUserId),
                or(
                    eq(callNotesCalls.noteVisibility, "company"),
                    and(
                        eq(callNotesCalls.noteVisibility, "private"),
                        eq(callNotesCalls.noteOwnerUserId, query.actorUserId)
                    )
                )
            )
        )
        .orderBy(
            desc(callNotesCalls.updatedAt),
            desc(callNotesCalls.createdAt),
            desc(callNotesCalls.id)
        );
    return rows.map(row => ({
        type: "call-note",
        callId: row.callId,
        noteId: row.noteId,
        documentId:
            row.visibility === "company" && row.indexedDocumentId !== null
                ? Number(row.indexedDocumentId)
                : null,
        title: row.title ?? "Untitled Call Note",
        visibility: row.visibility,
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
        preview: previewText(row.preview),
    }));
}
