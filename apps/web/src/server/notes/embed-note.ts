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
import { OpenAIEmbeddings } from "@langchain/openai";

import { db } from "~/server/db";
import { type NoteAnchor } from "~/server/db/schema";
import { documentNotes, documentNoteEmbeddings } from "~/server/db/schema";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_SHORT_DIM,
  resolveEmbeddingConfig,
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

    // Both halves or neither — see resolveEmbeddingConfig.
    const { apiKey, baseURL } = resolveEmbeddingConfig();
    if (!apiKey || !baseURL) {
      console.warn(
        "[embedNote] no embedding endpoint configured (EMBEDDING_API_BASE_URL " +
          "+ EMBEDDING_API_KEY, or AI_BASE_URL + AI_API_KEY) — skipping",
      );
      return;
    }

    const client = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      configuration: { baseURL },
    });

    const [embedding] = await client.embedDocuments([embeddingText]);
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

/**
 * Durable replacement for the old fire-and-forget `embedNoteAsync`:
 * enqueues a `note.embedding.requested` outbox event that apps/worker
 * consumes with retries. The event id is stable per note, so rapid
 * successive edits collapse into one pending embed of the latest content.
 */
export async function requestNoteEmbedding(
  noteId: number,
  reason: "created" | "updated",
): Promise<void> {
  const [note] = await db
    .select({ companyId: documentNotes.companyId })
    .from(documentNotes)
    .where(eq(documentNotes.id, noteId))
    .limit(1);
  if (!note) return;
  const companyId = Number(note.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    console.error(
      `[requestNoteEmbedding] note ${noteId} has non-numeric companyId "${note.companyId}"`,
    );
    return;
  }

  const { DrizzleOutboxStore } = await import("@launchstack/adapters");
  const { eventIds, PROTOCOL_VERSION } = await import("@launchstack/protocol");
  const { getEngine } = await import("~/server/engine");
  const engine = getEngine();
  const store = new DrizzleOutboxStore(engine.db, console);
  await store.enqueue([
    {
      eventId: eventIds.noteEmbeddingRequested(noteId),
      eventType: "note.embedding.requested",
      schemaVersion: PROTOCOL_VERSION,
      occurredAt: new Date().toISOString(),
      traceId: `note:${noteId}:${reason}`,
      companyId,
      payload: { noteId, reason },
    },
  ]);
}
