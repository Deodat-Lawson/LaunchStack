/**
 * Retriever for user-authored sticky notes on documents.
 *
 * Mirrors VectorRetriever's shape so note hits can be unioned into the
 * ensemble retriever without bespoke plumbing. Queries `documentNoteEmbeddings`
 * by cosine distance on `embedding_short` (Matryoshka-sliced), with a strict
 * scope filter on `documentId` / `companyId` and — in multi-doc mode — the
 * set of docs the user is asking about.
 *
 * Produces LangChain `Document`s with `source: "note"` and a back-reference
 * to the note id, so downstream consumers can render the note's title +
 * anchor quote in citations.
 */

import { sql } from "drizzle-orm";
import {
  BaseRetriever,
  type BaseRetrieverInput,
} from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";

import { db, toRows } from "~/server/db/index";
import type { EmbeddingsProvider, SearchScope } from "../types";

interface NotesRetrieverConfig extends BaseRetrieverInput {
  embeddings: EmbeddingsProvider;
  topK?: number;
  searchScope: SearchScope;
}

interface SingleDocConfig extends NotesRetrieverConfig {
  documentId: number;
  searchScope: "document";
}
interface CompanyConfig extends NotesRetrieverConfig {
  companyId: number | string;
  searchScope: "company";
}
interface MultiDocConfig extends NotesRetrieverConfig {
  documentIds: number[];
  searchScope: "multi-document";
}

type NotesRetrieverFields = SingleDocConfig | CompanyConfig | MultiDocConfig;

type NoteRow = {
  note_id: number;
  document_id: string | null;
  company_id: string | null;
  version_id: string | null;
  content: string;
  title: string | null;
  content_markdown: string | null;
  anchor: unknown;
  anchor_status: string | null;
  distance: number;
};

export class NotesRetriever extends BaseRetriever {
  lc_namespace = ["rag", "retrievers", "notes"];

  private embeddings: EmbeddingsProvider;
  private topK: number;
  private searchScope: SearchScope;
  private documentId?: number;
  private companyId?: number | string;
  private documentIds?: number[];

  constructor(fields: NotesRetrieverFields) {
    super(fields);
    this.embeddings = fields.embeddings;
    this.topK = fields.topK ?? 5;
    this.searchScope = fields.searchScope;
    if (fields.searchScope === "document") this.documentId = fields.documentId;
    else if (fields.searchScope === "company") this.companyId = fields.companyId;
    else if (fields.searchScope === "multi-document")
      this.documentIds = fields.documentIds;
  }

  async _getRelevantDocuments(
    query: string,
    _run?: CallbackManagerForRetrieverRun,
  ): Promise<Document[]> {
    try {
      const embedding = await this.embeddings.embedQuery(query);
      const short = embedding.slice(0, 512);
      const shortLiteral = sql.raw(`'[${short.join(",")}]'::vector(512)`);
      const fullLiteral = sql.raw(`'[${embedding.join(",")}]'::vector(1536)`);

      // Build scope predicate. documentId/companyId columns on the notes
      // tables are varchars (user-supplied strings), so we coerce and compare
      // with a text literal. Note: casting the runtime int to text keeps this
      // safe against injection since we only accept numeric inputs.
      const where = this.buildWhere();
      if (!where) return [];

      const rows = toRows<NoteRow>(
        await db.execute<NoteRow>(sql`
          SELECT
            ne.note_id,
            ne.document_id,
            ne.company_id,
            ne.version_id,
            ne.content,
            n.title,
            n.content_markdown,
            n.anchor,
            n.anchor_status,
            (ne.embedding <-> ${fullLiteral}) as distance
          FROM pdr_ai_v2_document_note_embeddings ne
          JOIN pdr_ai_v2_document_notes n ON n.id = ne.note_id
          WHERE ${where}
            AND ne.embedding IS NOT NULL
            AND ne.embedding_short IS NOT NULL
            AND COALESCE(n.anchor_status, 'resolved') <> 'orphaned'
          ORDER BY ne.embedding_short <-> ${shortLiteral}
          LIMIT ${this.topK}
        `),
      );

      return rows.map((r) => {
        const snippet = (r.title ? `${r.title}\n\n` : "") + (r.content ?? "");
        return new Document({
          pageContent: snippet,
          metadata: {
            source: "note",
            noteId: r.note_id,
            documentId: r.document_id,
            companyId: r.company_id,
            versionId: r.version_id,
            title: r.title,
            anchor: r.anchor,
            anchorStatus: r.anchor_status,
            distance: r.distance,
            searchScope: this.searchScope,
          },
        });
      });
    } catch (err) {
      console.error("[NotesRetriever] error:", err);
      return [];
    }
  }

  private buildWhere(): ReturnType<typeof sql> | null {
    if (this.searchScope === "document" && this.documentId !== undefined) {
      const asText = String(this.documentId);
      return sql`ne.document_id = ${asText}`;
    }
    if (this.searchScope === "company" && this.companyId !== undefined) {
      const asText = String(this.companyId);
      return sql`ne.company_id = ${asText}`;
    }
    if (
      this.searchScope === "multi-document" &&
      this.documentIds?.length
    ) {
      const list = this.documentIds.map((n) => String(n));
      return sql`ne.document_id = ANY(${list})`;
    }
    return null;
  }
}

export function createDocumentNotesRetriever(
  documentId: number,
  embeddings: EmbeddingsProvider,
  topK = 5,
): NotesRetriever {
  return new NotesRetriever({
    documentId,
    embeddings,
    topK,
    searchScope: "document",
  });
}

export function createCompanyNotesRetriever(
  companyId: number | string,
  embeddings: EmbeddingsProvider,
  topK = 5,
): NotesRetriever {
  return new NotesRetriever({
    companyId,
    embeddings,
    topK,
    searchScope: "company",
  });
}

export function createMultiDocNotesRetriever(
  documentIds: number[],
  embeddings: EmbeddingsProvider,
  topK = 5,
): NotesRetriever {
  return new NotesRetriever({
    documentIds,
    embeddings,
    topK,
    searchScope: "multi-document",
  });
}
