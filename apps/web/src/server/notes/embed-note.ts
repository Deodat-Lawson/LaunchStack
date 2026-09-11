/**
 * Embed a note's content into `documentNoteEmbeddings` so the hybrid
 * retriever can union notes with regular document chunks. One row per note;
 * re-running replaces the existing row in place so updates don't accumulate
 * stale vectors.
 *
 * Called fire-and-forget from the notes API after create/update. Swallows
 * errors internally — the note itself is already persisted when we reach
 * here, so an embedding failure must not break the user-facing save.
 */

import { eq } from "drizzle-orm";
import { document } from "@launchstack/store/schema";

import { db } from "~/server/db";
import { type NoteAnchor } from "~/server/db/schema";
import { documentNotes, documentNoteEmbeddings } from "~/server/db/schema";
import {
  createNotesEmbeddingsProvider,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_SHORT_DIM,
} from "./embedding-config";

/**
 * Build the exact text that gets embedded. Including the anchored quote in
 * addition to the note body is the single biggest quality lever — user
 * queries usually match the document's language, not the annotator's
 * paraphrase. Plays well with BM25 + vector ensemble.
 */
function buildEmbeddingText(args: {
  title: string | null;
  markdown: string | null;
  anchor: NoteAnchor | null;
}): string {
  const parts: string[] = [];
  if (args.title?.trim()) parts.push(args.title.trim());
  if (args.markdown?.trim()) parts.push(args.markdown.trim());
  const quote = args.anchor?.quote?.exact?.trim();
  if (quote) parts.push(`[quoted from document]\n${quote}`);
  return parts.join("\n\n");
}

/** Approximate GPT-tokens from char count — fine for bookkeeping. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function embedNote(noteId: number): Promise<void> {
  try {
    const [note] = await db
      .select()
      .from(documentNotes)
      .where(eq(documentNotes.id, noteId));
    if (!note) return;

    const anchor = (note.anchor as NoteAnchor | null) ?? null;
    const embeddingText = buildEmbeddingText({
      title: note.title,
      markdown: note.contentMarkdown ?? note.content ?? "",
      anchor,
    });

    if (!embeddingText.trim()) {
      // Nothing to embed — clear any prior vector so stale content can't
      // resurface in retrieval.
      await db
        .delete(documentNoteEmbeddings)
        .where(eq(documentNoteEmbeddings.noteId, noteId));
      return;
    }

    // Both halves or neither — see createNotesEmbeddingsProvider.
    const provider = createNotesEmbeddingsProvider();
    if (!provider) {
      console.warn(
        "[embedNote] no embedding endpoint configured (EMBEDDING_API_BASE_URL " +
          "+ EMBEDDING_API_KEY, or AI_BASE_URL + AI_API_KEY) — skipping",
      );
      return;
    }

    const embedding = await provider.embedQuery(embeddingText);
    if (!embedding || embedding.length !== EMBEDDING_DIM) {
      console.warn(
        `[embedNote] unexpected embedding length ${embedding?.length ?? "null"}`,
      );
      return;
    }
    const embeddingShort = embedding.slice(0, EMBEDDING_SHORT_DIM);

    await db
      .delete(documentNoteEmbeddings)
      .where(eq(documentNoteEmbeddings.noteId, noteId));

    await db.insert(documentNoteEmbeddings).values({
      noteId,
      userId: note.userId,
      documentId: note.documentId,
      companyId: note.companyId,
      versionId: note.versionId,
      content: embeddingText,
      tokenCount: approxTokens(embeddingText),
      embedding,
      embeddingShort,
      modelVersion: EMBEDDING_MODEL,
    });
  } catch (err) {
    // Rethrow so the outbox handler records the failure and retries with
    // backoff (ADR-003). The old fire-and-forget path swallowed this, which
    // silently left notes unsearchable.
    console.error("[embedNote] failed:", err);
    throw err;
  }
}

/** Parse a positive-integer id out of a string/number/bigint column value. */
function parsePositiveInt(
  value: string | number | bigint | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Durable replacement for the old fire-and-forget `embedNoteAsync`:
 * enqueues a `note.embedding.requested` outbox event that apps/worker
 * consumes with retries. The event id carries a per-edit fingerprint (the
 * note's `updatedAt` epoch-ms, falling back to `createdAt` for a fresh
 * note), so an edit that lands while a previous request is mid-handler
 * (`processing`) gets its OWN event instead of being absorbed — and lost —
 * by the in-flight row. The handler embeds the CURRENT note content, so
 * redelivery of any fingerprint converges; re-enqueueing an already
 * processed/dead fingerprint revives it via the store's upsert.
 */
export async function requestNoteEmbedding(
  noteId: number,
  reason: "created" | "updated",
  /**
   * Company to attribute the event to when neither the note row nor its
   * document yields one. The UI note-create paths write null `companyId`,
   * so routes pass the acting user's active company as this hint.
   */
  companyIdHint?: string | number | bigint | null,
): Promise<void> {
  const [note] = await db
    .select({
      companyId: documentNotes.companyId,
      documentId: documentNotes.documentId,
      createdAt: documentNotes.createdAt,
      updatedAt: documentNotes.updatedAt,
    })
    .from(documentNotes)
    .where(eq(documentNotes.id, noteId))
    .limit(1);
  if (!note) return;

  // Per-edit fingerprint: `updatedAt` is stamped on every update
  // ($onUpdate); a freshly created note only has `createdAt`. Epoch-ms
  // keeps the event id deterministic for a given edit, so producer retries
  // of the SAME edit converge while each new edit gets a new event.
  const fingerprint = String((note.updatedAt ?? note.createdAt).getTime());

  // Resolve the owning company: the note row first, then the anchored
  // document's row, then the caller-supplied hint. Without the fallbacks,
  // every UI-created note (null companyId) would silently never be embedded.
  let companyId = parsePositiveInt(note.companyId);
  if (companyId === null) {
    const documentId = parsePositiveInt(note.documentId);
    if (documentId !== null) {
      const [doc] = await db
        .select({ companyId: document.companyId })
        .from(document)
        .where(eq(document.id, documentId))
        .limit(1);
      companyId = parsePositiveInt(doc?.companyId);
    }
  }
  companyId ??= parsePositiveInt(companyIdHint);
  if (companyId === null) {
    // Never drop the event silently — this note will not be searchable until
    // a later edit manages to resolve a company.
    console.error(
      `[requestNoteEmbedding] could not resolve a company for note ${noteId} ` +
        `(row companyId "${note.companyId}", documentId "${note.documentId}", ` +
        `hint "${companyIdHint}") — embedding NOT enqueued`,
    );
    return;
  }

  const { DrizzleOutboxStore } = await import("@launchstack/engine");
  const { eventIds, PROTOCOL_VERSION } = await import("@launchstack/orchestration/pipeline-events");
  const { getEngine } = await import("~/server/engine");
  const engine = getEngine();
  const store = new DrizzleOutboxStore(engine.db, console);
  await store.enqueue([
    {
      eventId: eventIds.noteEmbeddingRequested(noteId, fingerprint),
      eventType: "note.embedding.requested",
      schemaVersion: PROTOCOL_VERSION,
      occurredAt: new Date().toISOString(),
      traceId: `note:${noteId}:${reason}`,
      companyId,
      payload: { noteId, reason },
    },
  ]);
}
