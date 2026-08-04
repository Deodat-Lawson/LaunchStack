import { type Backfill } from "@launchstack/core/db/backfills";
import { getTableName, sql } from "drizzle-orm";
import {
  documentContextChunks,
  documentMetadata,
  documentNoteEmbeddings,
  documentNotes,
  documentPreviews,
  documentRetrievalChunks,
  documentStructure,
} from "@launchstack/core/db/schema";

import { embedNote } from "../notes/embed-note";

/**
 * The backfill registry.
 *
 * Add an entry here instead of writing a one-off script. Entries are
 * resumable, recorded in the `data_backfills` ledger, and invoked explicitly —
 * never on container boot.
 */

const notes = () => getTableName(documentNotes);
const embeddings = () => getTableName(documentNoteEmbeddings);

/** Notes with no embedding row, after `id > cursor`. */
const pendingNotesSql = (after: number, limit?: number) => sql`
  SELECT n.id
    FROM ${sql.identifier(notes())} n
    LEFT JOIN ${sql.identifier(embeddings())} ne ON ne.note_id = n.id
   WHERE ne.id IS NULL
     AND n.id > ${after}
   ORDER BY n.id ASC
   ${limit === undefined ? sql`` : sql`LIMIT ${limit}`}
`;

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

/**
 * Give notes that predate the semantic-search rollout their vectors.
 *
 * Still useful after the squash: any embedding-model or dimension change
 * leaves existing notes without usable vectors, and re-running this is how you
 * repopulate them.
 */
const noteEmbeddings: Backfill = {
  id: "2026-08-note-embeddings",
  description: "Embed notes that have no row in document_note_embeddings",

  async estimate({ db, cursor }) {
    const after = typeof cursor === "number" ? cursor : 0;
    const rows = rowsOf<{ n: number }>(
      await db.execute(sql`SELECT count(*)::int AS n FROM (${pendingNotesSql(after)}) t`),
    );
    return rows[0]?.n ?? 0;
  },

  async step({ db, cursor, batchSize }) {
    // Keyset pagination on note id. The cursor is the last id handled, so an
    // interrupted run resumes instead of rescanning from zero.
    const after = typeof cursor === "number" ? cursor : 0;
    const rows = rowsOf<{ id: number }>(await db.execute(pendingNotesSql(after, batchSize)));

    if (rows.length === 0) return { cursor: null, processed: 0 };

    let processed = 0;
    let lastGood = after;
    for (const row of rows) {
      try {
        await embedNote(row.id);
      } catch (err) {
        // Stop at the last SUCCESSFUL id and fail loudly. Advancing past a
        // failed note would let the run finish and mark itself done while that
        // note stays unembedded forever — a re-run would never revisit it.
        throw new Error(
          `note ${row.id} failed to embed after ${processed} row(s) in this batch; ` +
            `cursor stays at ${lastGood} so a re-run retries from there. ` +
            `Cause: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      processed += 1;
      lastGood = row.id;
    }

    return { cursor: lastGood, processed };
  },
};

/**
 * Give pre-versioning documents a v1 `document_versions` row.
 *
 * New uploads create this inline (server/services/document-upload.ts), so on a
 * database built from the current migrations there is nothing to do. It stays
 * registered because `api/documents/[id]/versions` still refuses to accept a
 * new version for a document with no `file_type` and points operators here.
 *
 * Three things per document, in one transaction: create the v1 row, point the
 * document at it, and stamp `version_id` on the RLM rows that hang off it.
 * Skipping that last part would leave retrieval rows unversioned, which the
 * version-filtered retrievers treat as "belongs to no version".
 */
/** RLM tables carrying a nullable `version_id` that points at document_versions. */
const RLM_VERSIONED = [
  getTableName(documentStructure),
  getTableName(documentContextChunks),
  getTableName(documentRetrievalChunks),
  getTableName(documentMetadata),
  getTableName(documentPreviews),
];

const documentVersionsBackfill: Backfill = {
  id: "2026-08-document-versions",
  description: "Create a v1 version row for documents that predate versioning",
  // Pure SQL — no embeddings, no LLM. Runnable with only DATABASE_URL.
  requiresEngine: false,

  async estimate({ db }) {
    const rows = rowsOf<{ n: number }>(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM pdr_ai_v2_document WHERE current_version_id IS NULL`),
    );
    return rows[0]?.n ?? 0;
  },

  async step({ db, cursor, batchSize }) {
    const after = typeof cursor === "number" ? cursor : 0;
    const rows = rowsOf<{ id: number }>(
      await db.execute(sql`
        SELECT id FROM pdr_ai_v2_document
         WHERE current_version_id IS NULL AND id > ${after}
         ORDER BY id ASC LIMIT ${batchSize}`),
    );
    if (rows.length === 0) return { cursor: null, processed: 0 };

    let processed = 0;
    let lastGood = after;
    for (const row of rows) {
      try {
        // One transaction per document, so a partial failure never leaves a
        // document pointing at a version row that does not exist.
        await db.transaction(async (tx) => {
          const inserted = rowsOf<{ id: number }>(
            await tx.execute(sql`
              INSERT INTO pdr_ai_v2_document_versions
                (document_id, version_number, url, mime_type, uploaded_by)
              SELECT id, 1, url,
                     COALESCE(mime_type, 'application/octet-stream'), 'backfill'
                FROM pdr_ai_v2_document WHERE id = ${row.id}
              RETURNING id`),
          );
          const versionId = inserted[0]?.id;
          if (versionId === undefined) {
            throw new Error(`no version row created for document ${row.id}`);
          }
          await tx.execute(sql`
            UPDATE pdr_ai_v2_document
               SET current_version_id = ${versionId},
                   file_type = COALESCE(file_type, mime_type, 'application/octet-stream')
             WHERE id = ${row.id}`);

          // Stamp version_id on everything derived from this document. Only
          // rows where it IS NULL, so re-running cannot reassign a row that a
          // later version already owns.
          for (const table of RLM_VERSIONED) {
            await tx.execute(sql`
              UPDATE ${sql.identifier(table)}
                 SET version_id = ${versionId}
               WHERE document_id = ${row.id} AND version_id IS NULL`);
          }
        });
      } catch (err) {
        throw new Error(
          `document ${row.id} failed after ${processed} row(s) in this batch; ` +
            `cursor stays at ${lastGood} so a re-run retries from there. ` +
            `Cause: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      processed += 1;
      lastGood = row.id;
    }

    return { cursor: lastGood, processed };
  },
};

export const BACKFILLS: Backfill[] = [noteEmbeddings, documentVersionsBackfill];
