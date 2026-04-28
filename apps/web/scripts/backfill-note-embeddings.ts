/**
 * Backfill script for the Studio - Notes semantic search rollout.
 *
 * Walks every note in `pdr_ai_v2_document_notes` that has no row in
 * `pdr_ai_v2_document_note_embeddings` and runs the standard `embedNote`
 * pipeline against it. Use this once after deploying migration
 * `0014_note_links_and_user_id.sql` to give pre-existing notes vectors so
 * the Notebook search bar and Ask My Notes find them too.
 *
 * IDEMPOTENT: notes that already have embeddings are skipped. The embed
 * function itself replaces stale rows in place when content has changed,
 * so re-running on already-embedded notes is also safe.
 *
 * Run with:
 *   pnpm tsx scripts/backfill-note-embeddings.ts
 */

import "dotenv/config";
import { sql } from "drizzle-orm";

import { db } from "../src/server/db";
import { embedNote } from "../src/server/notes/embed-note";

type RowShape = { id: number } & Record<string, unknown>;

async function backfill() {
  console.log("[backfill-note-embeddings] Starting...");

  const result = await db.execute<RowShape>(sql`
    SELECT n.id
    FROM pdr_ai_v2_document_notes n
    LEFT JOIN pdr_ai_v2_document_note_embeddings ne ON ne.note_id = n.id
    WHERE ne.id IS NULL
    ORDER BY n.id ASC
  `);
  // Drizzle's pg execute() returns either { rows: [...] } or an array,
  // depending on the driver. Coerce.
  const rows: RowShape[] = Array.isArray(result)
    ? (result as RowShape[])
    : ((result as { rows?: RowShape[] }).rows ?? []);

  if (rows.length === 0) {
    console.log("[backfill-note-embeddings] No notes need embedding. Done.");
    return;
  }

  console.log(`[backfill-note-embeddings] Embedding ${rows.length} notes...`);
  let success = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await embedNote(r.id);
      success++;
      if (success % 25 === 0) {
        console.log(`  ${success}/${rows.length}`);
      }
    } catch (err) {
      failed++;
      console.error(`  note ${r.id} failed:`, err);
    }
  }

  console.log(
    `[backfill-note-embeddings] Done. success=${success} failed=${failed}`,
  );
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-note-embeddings] fatal:", err);
    process.exit(1);
  });
