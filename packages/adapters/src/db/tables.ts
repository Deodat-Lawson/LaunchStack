/**
 * Physical table identifiers for hand-written SQL — engine tables only.
 *
 * Some retrieval queries (ANN search against a runtime-selected dimension
 * table, the reindex UPDATE) cannot be expressed in the query builder and must
 * name tables literally. Deriving those names from the schema instead of
 * hardcoding `"pdr_ai_v2_..."` keeps the table prefix in exactly one place
 * (./schema/helpers.ts) and lets the compiler catch a rename.
 *
 * This is the engine counterpart to apps/web's `~/server/db/tables`, which
 * merges these with product tables (documentNotes, trendSearchCache, …). The
 * engine cannot import those — a retriever over a product table belongs on the
 * product side — so this registry deliberately covers only the engine set.
 *
 * Use `T.*` inside sql`` templates; use `NAME.*` where a bare string is needed.
 */

import { getTableName, sql } from "drizzle-orm";

import {
  document,
  documentContextChunks,
  documentEmbeddings768,
  documentEmbeddings1024,
  documentMetadata,
  documentRetrievalChunks,
  documentStructure,
} from "./schema";

const ident = <T extends { _: unknown }>(table: T) =>
  sql.identifier(getTableName(table as never));

export const NAME = {
  document: getTableName(document),
  contextChunks: getTableName(documentContextChunks),
  retrievalChunks: getTableName(documentRetrievalChunks),
  structure: getTableName(documentStructure),
  metadata: getTableName(documentMetadata),
  embeddings768: getTableName(documentEmbeddings768),
  embeddings1024: getTableName(documentEmbeddings1024),
} as const;

export const T = {
  document: ident(document),
  contextChunks: ident(documentContextChunks),
  retrievalChunks: ident(documentRetrievalChunks),
  structure: ident(documentStructure),
  metadata: ident(documentMetadata),
  embeddings768: ident(documentEmbeddings768),
  embeddings1024: ident(documentEmbeddings1024),
} as const;
