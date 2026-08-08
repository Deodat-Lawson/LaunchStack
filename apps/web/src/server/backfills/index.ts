import { type Backfill } from "@launchstack/core/db/backfills";
import { getTableName, sql } from "drizzle-orm";
// Product tables: notes live on the application side of the boundary.
import { documentNoteEmbeddings, documentNotes } from "~/server/db/schema";

import { embedNote } from "../notes/embed-note";
import { countUnrepairedDocuments, repairDocumentVersions } from "./document-version-repair";

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
 * Repair the document/version/job graph for pre-versioning rows.
 *
 * New uploads build this inline (server/services/document-creation.ts), so on a
 * database built from the current migrations there is nothing to do. It stays
 * registered because `api/documents/[id]/versions` still refuses to accept a
 * new version for a document with no `file_type` and points operators here.
 *
 * The work is deliberately NOT chunked: the repair runs as one transaction and
 * fails closed if any RLM row is left without a derivable version. A batched
 * run would commit a half-versioned graph, which the version-filtered
 * retrievers read as "these rows belong to no version" — worse than not having
 * run at all. See ./document-version-repair.ts, and its SQL twin
 * drizzle/0017_document_version_repair.sql.
 */
const documentVersionsBackfill: Backfill = {
  id: "2026-08-document-versions",
  description: "Repair v1 rows, current-version pointers and RLM version links",
  // Pure SQL — no embeddings, no LLM. Runnable with only DATABASE_URL.
  requiresEngine: false,

  estimate: ({ db }) => countUnrepairedDocuments(db),

  async step({ db }) {
    const remaining = await countUnrepairedDocuments(db);
    await repairDocumentVersions(db);
    // One pass handles every row, so there is never a resume point.
    return { cursor: null, processed: remaining };
  },
};

export const BACKFILLS: Backfill[] = [noteEmbeddings, documentVersionsBackfill];
