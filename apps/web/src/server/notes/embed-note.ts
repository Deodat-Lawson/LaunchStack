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
import {
  documentNotes,
  documentNoteEmbeddings,
  type NoteAnchor,
} from "@launchstack/core/db/schema";
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

    const { apiKey, baseURL } = resolveEmbeddingConfig();
    if (!apiKey) {
      console.warn("[embedNote] no embedding API key configured — skipping");
      return;
    }

    const client = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      ...(baseURL ? { configuration: { baseURL } } : {}),
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
    console.error("[embedNote] failed:", err);
  }
}

/**
 * Fire-and-forget wrapper for the common case where a route wants to update
 * a note and return immediately without blocking on embedding latency.
 */
export function embedNoteAsync(noteId: number): void {
  void embedNote(noteId);
}
