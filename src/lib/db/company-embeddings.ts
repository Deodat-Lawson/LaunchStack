/**
 * Dynamic per-company embedding tables.
 *
 * Each company gets its own table with vector columns sized to match
 * the embedding model they chose. This avoids the 1536-dimension lock-in
 * and lets every provider use its native output dimensions.
 */

import { db } from "~/server/db";
import { sql } from "drizzle-orm";

/** Prefix used for all per-company embedding tables. */
const TABLE_PREFIX = "pdr_ai_v2_company";

export function getCompanyEmbeddingTableName(companyId: number): string {
    return `${TABLE_PREFIX}_${companyId}_embeddings`;
}

/**
 * Create the per-company embedding table with the correct vector dimension.
 * Safe to call multiple times — uses IF NOT EXISTS.
 */
export async function createCompanyEmbeddingTable(
    companyId: number,
    dimensions: number,
): Promise<void> {
    if (!Number.isInteger(companyId) || companyId <= 0) {
        throw new Error(`Invalid companyId: ${companyId}`);
    }
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new Error(`Invalid dimensions: ${dimensions}`);
    }

    const tableName = getCompanyEmbeddingTableName(companyId);

    // Table creation — must use raw SQL because dimensions are dynamic.
    // companyId and dimensions are validated integers above, safe to interpolate.
    await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
            id SERIAL PRIMARY KEY,
            document_id BIGINT NOT NULL REFERENCES pdr_ai_v2_document(id) ON DELETE CASCADE,
            chunk_type VARCHAR(32) NOT NULL,
            chunk_id BIGINT NOT NULL,
            content TEXT,
            embedding vector(${dimensions}),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `));

    // HNSW index for fast approximate nearest-neighbor search
    await db.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS ${tableName}_hnsw_idx
            ON ${tableName}
            USING hnsw (embedding vector_cosine_ops)
    `));

    // Lookup by document + chunk type
    await db.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS ${tableName}_doc_idx
            ON ${tableName} (document_id, chunk_type)
    `));
}

/**
 * Drop a company's embedding table. Used when the company changes
 * embedding models (dimensions change) or the company is deleted.
 */
export async function dropCompanyEmbeddingTable(companyId: number): Promise<void> {
    if (!Number.isInteger(companyId) || companyId <= 0) {
        throw new Error(`Invalid companyId: ${companyId}`);
    }
    const tableName = getCompanyEmbeddingTableName(companyId);
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${tableName} CASCADE`));
}

/**
 * Check whether the per-company embedding table exists.
 */
export async function companyEmbeddingTableExists(companyId: number): Promise<boolean> {
    const tableName = getCompanyEmbeddingTableName(companyId);
    const result = await db.execute<{ exists: boolean }>(
        sql`SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = ${tableName}
        ) as exists`
    );
    const rows = Array.isArray(result) ? result : [];
    return rows[0]?.exists === true;
}

/**
 * Insert embedding rows into a company's embedding table.
 */
export async function insertCompanyEmbeddings(
    companyId: number,
    dimensions: number,
    rows: Array<{
        documentId: number;
        chunkType: string;
        chunkId: number;
        content: string | null;
        embedding: number[];
    }>,
): Promise<void> {
    if (rows.length === 0) return;

    const tableName = getCompanyEmbeddingTableName(companyId);

    // Batch insert using raw SQL for dynamic table name
    for (const row of rows) {
        const embStr = `[${row.embedding.join(",")}]`;
        await db.execute(
            sql`INSERT INTO ${sql.raw(tableName)} (document_id, chunk_type, chunk_id, content, embedding)
                VALUES (${row.documentId}, ${row.chunkType}, ${row.chunkId}, ${row.content}, ${embStr}::vector(${sql.raw(String(dimensions))}))`
        );
    }
}

/**
 * Delete all embeddings for a specific document from a company's table.
 */
export async function deleteDocumentEmbeddings(
    companyId: number,
    documentId: number,
): Promise<void> {
    const tableName = getCompanyEmbeddingTableName(companyId);
    await db.execute(
        sql`DELETE FROM ${sql.raw(tableName)} WHERE document_id = ${documentId}`
    );
}

/**
 * Perform a vector similarity search on a company's embedding table.
 * Returns the top-K most similar embeddings by cosine distance.
 */
export async function searchCompanyEmbeddings(
    companyId: number,
    dimensions: number,
    queryEmbedding: number[],
    opts: {
        topK?: number;
        documentId?: number;
        chunkType?: string;
    } = {},
): Promise<
    Array<{
        id: number;
        document_id: number;
        chunk_type: string;
        chunk_id: number;
        content: string | null;
        distance: number;
    }>
> {
    const tableName = getCompanyEmbeddingTableName(companyId);
    const topK = opts.topK ?? 10;
    const embStr = `[${queryEmbedding.join(",")}]`;

    let whereClause = sql`1=1`;
    if (opts.documentId !== undefined) {
        whereClause = sql`${whereClause} AND e.document_id = ${opts.documentId}`;
    }
    if (opts.chunkType) {
        whereClause = sql`${whereClause} AND e.chunk_type = ${opts.chunkType}`;
    }

    const result = await db.execute<{
        id: number;
        document_id: number;
        chunk_type: string;
        chunk_id: number;
        content: string | null;
        distance: number;
    }>(
        sql`SELECT
                e.id,
                e.document_id,
                e.chunk_type,
                e.chunk_id,
                e.content,
                e.embedding <-> ${embStr}::vector(${sql.raw(String(dimensions))}) AS distance
            FROM ${sql.raw(tableName)} e
            WHERE ${whereClause}
            ORDER BY distance ASC
            LIMIT ${topK}`
    );

    return Array.isArray(result) ? result : [];
}
