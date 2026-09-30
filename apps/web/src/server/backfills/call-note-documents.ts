import { and, eq, gt, sql } from "drizzle-orm";

import { callNotesCalls } from "@launchstack/pipelines/schema";
import type { Backfill } from "@launchstack/store/backfills";
import { document } from "@launchstack/store/schema";
import { createWebCallNoteIndex } from "~/server/call-notes/document-index";
import { embedNote } from "~/server/notes/embed-note";

/** Migrate completed Calls to ordinary document ingestion; private notes stay unindexed. */
export const callNoteDocuments: Backfill = {
    id: "2026-09-call-note-documents",
    description: "Index completed company Call Notes as documents and remove legacy note vectors",

    async estimate({ db, cursor }) {
        const after = typeof cursor === "string" ? cursor : "";
        const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(callNotesCalls)
            .where(and(eq(callNotesCalls.status, "completed"), gt(callNotesCalls.id, after)));
        return row?.count ?? 0;
    },

    async step({ db, cursor, batchSize }) {
        // Restore provenance for every referenced document before any Call
        // cleanup can delete the only row that still identifies its ownership.
        // This includes private and non-completed Calls, not just the sync batch.
        // eslint-disable-next-line drizzle/enforce-update-with-where -- the WHERE follows .from(); the rule only recognises .set().where()
        await db
            .update(document)
            .set({
                ocrMetadata: sql`COALESCE(${document.ocrMetadata}, '{}'::jsonb) || jsonb_build_object('callNote', jsonb_build_object('callId', ${callNotesCalls.id}))`,
            })
            .from(callNotesCalls)
            .where(
                and(
                    eq(document.id, callNotesCalls.indexedDocumentId),
                    eq(document.companyId, callNotesCalls.companyId),
                    sql`${document.ocrMetadata}->'callNote' IS DISTINCT FROM jsonb_build_object('callId', ${callNotesCalls.id})`
                )
            );

        const after = typeof cursor === "string" ? cursor : "";
        const rows = await db
            .select({
                id: callNotesCalls.id,
                companyId: callNotesCalls.companyId,
                documentNoteId: callNotesCalls.documentNoteId,
            })
            .from(callNotesCalls)
            .where(and(eq(callNotesCalls.status, "completed"), gt(callNotesCalls.id, after)))
            .orderBy(callNotesCalls.id)
            .limit(batchSize);
        if (rows.length === 0) return { cursor: null, processed: 0 };

        const index = createWebCallNoteIndex({ db });
        for (const call of rows) {
            // The embedding path now removes Call-linked projections, including
            // legacy private ones, without invoking an embedding provider.
            if (call.documentNoteId !== null) await embedNote(call.documentNoteId);
            await index.sync({ companyId: call.companyId.toString(), callId: call.id });
        }
        // A failed row throws before a cursor is returned. The runner retries
        // this batch, and both projection cleanup and document sync are idempotent.
        return { cursor: rows[rows.length - 1]!.id, processed: rows.length };
    },
};
