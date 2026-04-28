/**
 * Vector search for notes — backs the Notebook search bar, the Ask My Notes
 * agent, and the hybrid title-search upgrade in `GET /api/notes`. All paths
 * route through here so we keep one source of truth for embedding config and
 * scoping rules.
 */

import { sql } from "drizzle-orm";
import { OpenAIEmbeddings } from "@langchain/openai";

import { db, toRows } from "~/server/db/index";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  EMBEDDING_SHORT_DIM,
  resolveEmbeddingConfig,
} from "./embedding-config";

export type NoteSearchScope = "user" | "document" | "company";

export interface NoteSearchHit {
  noteId: number;
  title: string | null;
  contentMarkdown: string | null;
  documentId: string | null;
  companyId: string | null;
  anchor: unknown;
  anchorStatus: string | null;
  /** Cosine distance (0 = identical, 2 = opposite). Lower is better. */
  distance: number;
}

interface SearchArgs {
  userId: string;
  query: string;
  scope: NoteSearchScope;
  /** Required for `scope === "document"`. */
  documentId?: string;
  /** Required for `scope === "company"`. */
  companyId?: string;
  topK?: number;
}

type Row = {
  note_id: number;
  title: string | null;
  content_markdown: string | null;
  document_id: string | null;
  company_id: string | null;
  anchor: unknown;
  anchor_status: string | null;
  distance: number;
};

/**
 * Returns the top-K notes ranked by cosine distance against `query`. Always
 * scoped by `userId` — even `scope: "company"` AND-filters by the requester
 * to prevent reading another user's private notes.
 *
 * Returns an empty array (not an error) when no embedding key is configured —
 * callers should fall back to title ILIKE.
 */
export async function searchNotes(
  args: SearchArgs,
): Promise<NoteSearchHit[]> {
  const { userId, query, scope, topK = 8 } = args;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { apiKey, baseURL } = resolveEmbeddingConfig();
  if (!apiKey) return [];

  const client = new OpenAIEmbeddings({
    openAIApiKey: apiKey,
    modelName: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
    ...(baseURL ? { configuration: { baseURL } } : {}),
  });

  const embedding = await client.embedQuery(trimmed);
  if (!embedding || embedding.length !== EMBEDDING_DIM) return [];
  const short = embedding.slice(0, EMBEDDING_SHORT_DIM);

  const shortLiteral = sql.raw(`'[${short.join(",")}]'::vector(${EMBEDDING_SHORT_DIM})`);
  const fullLiteral = sql.raw(`'[${embedding.join(",")}]'::vector(${EMBEDDING_DIM})`);

  // Build scope predicate. `userId` is always part of the filter so we never
  // leak across owners, even when the broader scope is company-wide.
  const scopeFilter =
    scope === "document"
      ? sql`ne.document_id = ${args.documentId ?? ""}`
      : scope === "company"
      ? sql`ne.company_id = ${args.companyId ?? ""}`
      : sql`TRUE`;

  const rows = toRows<Row>(
    await db.execute<Row>(sql`
      SELECT
        ne.note_id,
        n.title,
        n.content_markdown,
        ne.document_id,
        ne.company_id,
        n.anchor,
        n.anchor_status,
        (ne.embedding <-> ${fullLiteral}) AS distance
      FROM pdr_ai_v2_document_note_embeddings ne
      JOIN pdr_ai_v2_document_notes n ON n.id = ne.note_id
      WHERE ne.user_id = ${userId}
        AND ${scopeFilter}
        AND ne.embedding IS NOT NULL
        AND ne.embedding_short IS NOT NULL
        AND COALESCE(n.anchor_status, 'resolved') <> 'orphaned'
      ORDER BY ne.embedding_short <-> ${shortLiteral}
      LIMIT ${topK}
    `),
  );

  return rows.map((r) => ({
    noteId: r.note_id,
    title: r.title,
    contentMarkdown: r.content_markdown,
    documentId: r.document_id,
    companyId: r.company_id,
    anchor: r.anchor,
    anchorStatus: r.anchor_status,
    distance: r.distance,
  }));
}
