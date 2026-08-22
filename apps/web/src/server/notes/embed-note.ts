/**
 * Embed a note's content into `documentNoteEmbeddings` so the hybrid
 * retriever can union notes with regular document chunks. Embedding is
 * computed outside the final transaction, then the canonical note and any
 * associated Call are locked and revalidated before atomic replacement.
 */

import { eq } from "drizzle-orm";

import { document } from "@launchstack/core/db/schema";
import type { EmbeddingsProvider } from "@launchstack/core/embeddings";

import { db } from "~/server/db";
import {
  callNotesCalls,
  documentNoteEmbeddings,
  documentNotes,
  type NoteAnchor,
} from "~/server/db/schema";
import {
  resolveNoteEmbeddingRuntime,
  type NoteEmbeddingRuntime,
} from "./embedding-config";

/** Build the exact text that gets embedded for both snapshots and writes. */
export function buildEmbeddingText(args: {
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

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface NoteEmbeddingSource {
  id: number;
  userId: string;
  companyId: string | null;
  documentId: string | null;
  versionId: bigint | null;
  title: string | null;
  content: string | null;
  contentMarkdown: string | null;
  anchor: unknown;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface CallNoteEmbeddingState {
  id: string;
  companyId: bigint;
  status: "active" | "finalizing" | "completed" | "failed";
  documentNoteId: number | null;
  noteOwnerUserId: string | null;
  noteVisibility: "company" | "private";
  knowledgeIncluded: boolean;
  currentNoteRevision: number;
}

export interface NoteEmbeddingSnapshot {
  note: NoteEmbeddingSource;
  call: CallNoteEmbeddingState | null;
}

export interface NoteEmbeddingProjection {
  content: string;
  tokenCount: number;
  embedding: number[];
  embeddingShort: number[];
  modelVersion: string;
}

export type NoteEmbeddingWriteResult = "written" | "missing" | "stale" | "ineligible";
export type NoteEmbeddingCleanupResult = "removed" | "missing" | "stale";

export interface NoteEmbeddingStore {
  loadSnapshot(noteId: number): Promise<NoteEmbeddingSnapshot | null>;
  removeProjection(noteId: number): Promise<void>;
  removeIfCurrent(snapshot: NoteEmbeddingSnapshot): Promise<NoteEmbeddingCleanupResult>;
  replaceIfCurrent(
    snapshot: NoteEmbeddingSnapshot,
    projection: NoteEmbeddingProjection,
  ): Promise<NoteEmbeddingWriteResult>;
}

function noteSelection() {
  return {
    id: documentNotes.id,
    userId: documentNotes.userId,
    companyId: documentNotes.companyId,
    documentId: documentNotes.documentId,
    versionId: documentNotes.versionId,
    title: documentNotes.title,
    content: documentNotes.content,
    contentMarkdown: documentNotes.contentMarkdown,
    anchor: documentNotes.anchor,
    createdAt: documentNotes.createdAt,
    updatedAt: documentNotes.updatedAt,
  };
}

function callSelection() {
  return {
    id: callNotesCalls.id,
    companyId: callNotesCalls.companyId,
    status: callNotesCalls.status,
    documentNoteId: callNotesCalls.documentNoteId,
    noteOwnerUserId: callNotesCalls.noteOwnerUserId,
    noteVisibility: callNotesCalls.noteVisibility,
    knowledgeIncluded: callNotesCalls.knowledgeIncluded,
    currentNoteRevision: callNotesCalls.currentNoteRevision,
  };
}

function sourceIdentity(note: NoteEmbeddingSource): string {
  return JSON.stringify({
    userId: note.userId,
    companyId: note.companyId,
    documentId: note.documentId,
    versionId: note.versionId?.toString() ?? null,
    updatedAt: note.updatedAt?.toISOString() ?? null,
    embeddingText: buildEmbeddingText({
      title: note.title,
      markdown: note.contentMarkdown ?? note.content ?? "",
      anchor: (note.anchor as NoteAnchor | null) ?? null,
    }),
  });
}

function callIdentity(call: CallNoteEmbeddingState | null): string | null {
  if (!call) return null;
  return JSON.stringify({
    id: call.id,
    companyId: call.companyId.toString(),
    status: call.status,
    documentNoteId: call.documentNoteId,
    noteOwnerUserId: call.noteOwnerUserId,
    noteVisibility: call.noteVisibility,
    knowledgeIncluded: call.knowledgeIncluded,
    currentNoteRevision: call.currentNoteRevision,
  });
}

export function isEligibleCallNote(snapshot: NoteEmbeddingSnapshot): boolean {
  const { note, call } = snapshot;
  if (!call) return true;
  return (
    call.status === "completed" &&
    call.knowledgeIncluded &&
    call.noteVisibility === "company" &&
    call.documentNoteId === note.id &&
    call.noteOwnerUserId === note.userId &&
    call.companyId.toString() === note.companyId &&
    call.currentNoteRevision > 0
  );
}

export function evaluateEmbeddingFreshness(
  expected: NoteEmbeddingSnapshot,
  current: NoteEmbeddingSnapshot | null,
): NoteEmbeddingWriteResult {
  if (!current) return "missing";
  if (current.call && !isEligibleCallNote(current)) return "ineligible";
  if (
    sourceIdentity(expected.note) !== sourceIdentity(current.note) ||
    callIdentity(expected.call) !== callIdentity(current.call)
  ) {
    return "stale";
  }
  return "written";
}

class DrizzleNoteEmbeddingStore implements NoteEmbeddingStore {
  async loadSnapshot(noteId: number): Promise<NoteEmbeddingSnapshot | null> {
    const [note] = await db
      .select(noteSelection())
      .from(documentNotes)
      .where(eq(documentNotes.id, noteId))
      .limit(1);
    if (!note) return null;

    const [call] = await db
      .select(callSelection())
      .from(callNotesCalls)
      .where(eq(callNotesCalls.documentNoteId, noteId))
      .limit(1);
    return { note, call: call ?? null };
  }

  async removeProjection(noteId: number): Promise<void> {
    await db.delete(documentNoteEmbeddings).where(eq(documentNoteEmbeddings.noteId, noteId));
  }

  async removeIfCurrent(snapshot: NoteEmbeddingSnapshot): Promise<NoteEmbeddingCleanupResult> {
    return db.transaction(async tx => {
      const [note] = await tx
        .select(noteSelection())
        .from(documentNotes)
        .where(eq(documentNotes.id, snapshot.note.id))
        .limit(1)
        .for("update");

      if (!note) {
        await tx
          .delete(documentNoteEmbeddings)
          .where(eq(documentNoteEmbeddings.noteId, snapshot.note.id));
        return "missing";
      }

      const [call] = await tx
        .select(callSelection())
        .from(callNotesCalls)
        .where(eq(callNotesCalls.documentNoteId, snapshot.note.id))
        .limit(1)
        .for("update");
      const current: NoteEmbeddingSnapshot = { note, call: call ?? null };

      // A newer source or eligibility transition owns the projection now.
      // The stale cleanup must not erase what that newer event wrote.
      if (evaluateEmbeddingFreshness(snapshot, current) === "stale") return "stale";

      await tx
        .delete(documentNoteEmbeddings)
        .where(eq(documentNoteEmbeddings.noteId, snapshot.note.id));
      return "removed";
    });
  }

  async replaceIfCurrent(
    snapshot: NoteEmbeddingSnapshot,
    projection: NoteEmbeddingProjection,
  ): Promise<NoteEmbeddingWriteResult> {
    return db.transaction(async tx => {
      // All compliant workers lock the canonical note first and its Call
      // second. The note row is the serialization mutex for per-note replace.
      const [note] = await tx
        .select(noteSelection())
        .from(documentNotes)
        .where(eq(documentNotes.id, snapshot.note.id))
        .limit(1)
        .for("update");

      if (!note) {
        await tx
          .delete(documentNoteEmbeddings)
          .where(eq(documentNoteEmbeddings.noteId, snapshot.note.id));
        return "missing";
      }

      const [call] = await tx
        .select(callSelection())
        .from(callNotesCalls)
        .where(eq(callNotesCalls.documentNoteId, snapshot.note.id))
        .limit(1)
        .for("update");
      const current: NoteEmbeddingSnapshot = { note, call: call ?? null };
      const freshness = evaluateEmbeddingFreshness(snapshot, current);

      if (freshness !== "written") {
        // Call Note projections fail closed. Ordinary notes retain their last
        // good vector while the newer canonical update/event converges.
        if (freshness !== "stale" || snapshot.call !== null || current.call !== null) {
          await tx
            .delete(documentNoteEmbeddings)
            .where(eq(documentNoteEmbeddings.noteId, snapshot.note.id));
        }
        return freshness;
      }

      await tx
        .delete(documentNoteEmbeddings)
        .where(eq(documentNoteEmbeddings.noteId, snapshot.note.id));
      await tx.insert(documentNoteEmbeddings).values({
        noteId: note.id,
        userId: note.userId,
        documentId: note.documentId,
        companyId: note.companyId,
        versionId: note.versionId,
        content: projection.content,
        tokenCount: projection.tokenCount,
        embedding: projection.embedding,
        embeddingShort: projection.embeddingShort,
        modelVersion: projection.modelVersion,
      });
      return "written";
    });
  }
}

async function embedOne(embeddings: EmbeddingsProvider, text: string): Promise<number[] | undefined> {
  if (embeddings.embedDocuments) {
    const [embedding] = await embeddings.embedDocuments([text]);
    return embedding;
  }
  return embeddings.embedQuery(text);
}

export interface EmbedNoteDependencies {
  store?: NoteEmbeddingStore;
  runtime?: NoteEmbeddingRuntime | null;
}

export async function embedNoteWithDependencies(
  noteId: number,
  dependencies: EmbedNoteDependencies = {},
): Promise<NoteEmbeddingWriteResult | "skipped"> {
  const store = dependencies.store ?? new DrizzleNoteEmbeddingStore();
  const snapshot = await store.loadSnapshot(noteId);
  if (!snapshot) {
    await store.removeProjection(noteId);
    return "missing";
  }
  if (snapshot.call && !isEligibleCallNote(snapshot)) {
    const cleanup = await store.removeIfCurrent(snapshot);
    return cleanup === "stale" ? "stale" : "ineligible";
  }

  const embeddingText = buildEmbeddingText({
    title: snapshot.note.title,
    markdown: snapshot.note.contentMarkdown ?? snapshot.note.content ?? "",
    anchor: (snapshot.note.anchor as NoteAnchor | null) ?? null,
  });
  if (!embeddingText.trim()) {
    const cleanup = await store.removeIfCurrent(snapshot);
    return cleanup === "stale" ? "stale" : "skipped";
  }

  const runtime =
    dependencies.runtime === undefined ? resolveNoteEmbeddingRuntime() : dependencies.runtime;
  if (!runtime) {
    console.warn(
      "[embedNote] no legacy note embedding endpoint configured (EMBEDDING_API_BASE_URL + " +
      "EMBEDDING_API_KEY, or AI_BASE_URL + AI_API_KEY) — skipping",
    );
    return "skipped";
  }

  const embedding = await embedOne(runtime.embeddings, embeddingText);
  if (!embedding || embedding.length !== runtime.index.dimension) {
    console.warn(`[embedNote] unexpected embedding length ${embedding?.length ?? "null"}`);
    return "skipped";
  }

  return store.replaceIfCurrent(snapshot, {
    content: embeddingText,
    tokenCount: approxTokens(embeddingText),
    embedding,
    embeddingShort: embedding.slice(0, runtime.index.shortDimension),
    modelVersion: runtime.index.model,
  });
}

export async function embedNote(noteId: number): Promise<void> {
  try {
    await embedNoteWithDependencies(noteId);
  } catch (err) {
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
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Enqueue the existing durable note embedding event. */
export async function requestNoteEmbedding(
  noteId: number,
  reason: "created" | "updated",
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

  const fingerprint = String((note.updatedAt ?? note.createdAt).getTime());

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
    console.error(
      `[requestNoteEmbedding] could not resolve a company for note ${noteId} ` +
        `(row companyId "${note.companyId}", documentId "${note.documentId}", ` +
        `hint "${companyIdHint}") — embedding NOT enqueued`,
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
