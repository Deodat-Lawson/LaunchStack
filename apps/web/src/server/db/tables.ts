import { getTableName, sql } from "drizzle-orm";
import {
  document,
  documentContextChunks,
  documentEmbeddings768,
  documentEmbeddings1024,
  documentMetadata,
  documentNoteEmbeddings,
  documentNotes,
  documentRetrievalChunks,
  documentStructure,
  trendSearchCache,
} from "@launchstack/core/db/schema";

/**
 * Physical table identifiers for hand-written SQL.
 *
 * Some queries — ANN search with a runtime-selected dimension table, the
 * reindex UPDATE — cannot be expressed in the query builder and must name
 * tables literally. Deriving those names from the schema instead of hardcoding
 * `"pdr_ai_v2_..."` strings means the table prefix lives in exactly one place
 * (packages/core/src/db/schema/helpers.ts) and the compiler catches a rename.
 *
 * Note this makes the CODE side of a prefix change a one-line edit, but not the
 * database side: `drizzle-kit generate` cannot tell a mass rename from a
 * drop-and-recreate, so it prompts per table and fails in a non-TTY. Changing
 * the prefix needs a hand-written `ALTER TABLE ... RENAME TO` migration.
 *
 * Use `T.*` inside sql`` templates; use `NAME.*` where a bare string is needed.
 */

const ident = <T extends { _: unknown }>(table: T) =>
  sql.identifier(getTableName(table as never));

export const NAME = {
  document: getTableName(document),
  contextChunks: getTableName(documentContextChunks),
  retrievalChunks: getTableName(documentRetrievalChunks),
  structure: getTableName(documentStructure),
  metadata: getTableName(documentMetadata),
  notes: getTableName(documentNotes),
  noteEmbeddings: getTableName(documentNoteEmbeddings),
  embeddings768: getTableName(documentEmbeddings768),
  embeddings1024: getTableName(documentEmbeddings1024),
  trendSearchCache: getTableName(trendSearchCache),
} as const;

export const T = {
  document: ident(document),
  contextChunks: ident(documentContextChunks),
  retrievalChunks: ident(documentRetrievalChunks),
  structure: ident(documentStructure),
  metadata: ident(documentMetadata),
  notes: ident(documentNotes),
  noteEmbeddings: ident(documentNoteEmbeddings),
  embeddings768: ident(documentEmbeddings768),
  embeddings1024: ident(documentEmbeddings1024),
  trendSearchCache: ident(trendSearchCache),
} as const;
