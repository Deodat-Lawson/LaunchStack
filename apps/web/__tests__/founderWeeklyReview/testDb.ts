import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as coreSchema from "@launchstack/core/db/schema";
import type { DbClient } from "@launchstack/core/db";

const rootDir = join(__dirname, "..", "..");
const migrationsDir = join(rootDir, "drizzle");

function buildSearchPathSql(schemaName: string): string {
    return `SET search_path TO "${schemaName}", public`;
}

async function listMigrationFiles(): Promise<string[]> {
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => entry.name)
        .sort();
}

function normalizeSqlMigrationBody(body: string): string {
    return body.replace(/^\uFEFF/, "");
}

async function bootstrapIsolatedSchema(
    client: Sql,
    schemaName: string
): Promise<void> {
    await client.unsafe(buildSearchPathSql(schemaName));
    await client.unsafe(`
        CREATE TABLE IF NOT EXISTS "pdr_ai_v2_company" (
            "id" serial PRIMARY KEY,
            "name" varchar(256) NOT NULL,
            "slug" varchar(64),
            "description" text,
            "industry" varchar(256),
            "swatch" integer NOT NULL DEFAULT 1,
            "embedding_index_key" varchar(128),
            "active_embedding_index_key" varchar(128),
            "pending_embedding_index_key" varchar(128),
            "reindex_status" varchar(16) NOT NULL DEFAULT 'STABLE',
            "reindex_job_id" text,
            "reindex_started_at" timestamptz,
            "reindex_completed_at" timestamptz,
            "reindex_error" text,
            "embedding_openai_api_key" text,
            "embedding_huggingface_api_key" text,
            "embedding_ollama_base_url" varchar(1024),
            "embedding_ollama_model" varchar(256),
            "employerPasskey" varchar(256) NOT NULL DEFAULT '',
            "employeePasskey" varchar(256) NOT NULL DEFAULT '',
            "numberOfEmployees" varchar(256) NOT NULL,
            "use_uploadthing" boolean NOT NULL DEFAULT true,
            "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" timestamptz
        );

        CREATE TABLE IF NOT EXISTS "pdr_ai_v2_users" (
            "id" serial PRIMARY KEY,
            "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
            "role" varchar(256) NOT NULL,
            "last_active_at" timestamptz,
            "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document" (
            "id" serial PRIMARY KEY,
            "company_id" bigint REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
            "url" varchar(256),
            "category" varchar(256),
            "title" varchar(256),
            "ocr_enabled" boolean DEFAULT false,
            "ocr_processed" boolean DEFAULT false,
            "ocr_metadata" jsonb,
            "ocr_job_id" varchar(256),
            "ocr_provider" varchar(50),
            "ocr_confidence_score" integer,
            "ocr_cost_cents" integer,
            "mime_type" varchar(128),
            "source_archive_name" varchar(256),
            "file_type" varchar(128),
            "current_version_id" bigint,
            "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" timestamptz
        );

        CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_versions" (
            "id" serial PRIMARY KEY,
            "document_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
            "version_number" integer NOT NULL,
            "url" varchar(512) NOT NULL,
            "mime_type" varchar(128) NOT NULL,
            "file_size" bigint,
            "uploaded_by" varchar(256),
            "changelog" text,
            "ocr_job_id" varchar(256),
            "ocr_provider" varchar(50),
            "ocr_processed" boolean DEFAULT false,
            "ocr_metadata" jsonb,
            "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE ("document_id", "version_number")
        );

        CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_context_chunks" (
            "id" serial PRIMARY KEY,
            "document_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
            "version_id" bigint REFERENCES "pdr_ai_v2_document_versions"("id") ON DELETE CASCADE,
            "structure_id" bigint,
            "content" text NOT NULL,
            "token_count" integer NOT NULL DEFAULT 0,
            "char_count" integer NOT NULL DEFAULT 0,
            "embedding" vector(1536),
            "content_hash" varchar(64),
            "semantic_type" varchar(50),
            "page_number" integer,
            "line_start" integer,
            "line_end" integer,
            "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" timestamptz
        );

        CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_structure" (
            "id" serial PRIMARY KEY,
            "document_id" bigint NOT NULL REFERENCES "pdr_ai_v2_document"("id") ON DELETE CASCADE,
            "version_id" bigint,
            "ordering" integer NOT NULL DEFAULT 0,
            "title" text,
            "path" varchar(256)
        );

        CREATE TABLE IF NOT EXISTS "pdr_ai_v2_document_retrieval_chunks" (
            "id" bigint PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS "company" (
            "id" serial PRIMARY KEY,
            "name" varchar(256) NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "document" (
            "id" serial PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS "ocr_jobs" (
            "id" varchar(256) PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS "file_uploads" (
            "id" serial PRIMARY KEY,
            "user_id" varchar(256) NOT NULL,
            "filename" varchar(256) NOT NULL,
            "mime_type" varchar(128) NOT NULL,
            "file_data" text NOT NULL,
            "file_size" integer NOT NULL,
            "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

export interface FounderWeeklyReviewTestSession {
    db: DbClient;
    close(): Promise<void>;
}

export interface FounderWeeklyReviewTestDatabase {
    schemaName: string;
    db: DbClient;
    createSession(): Promise<FounderWeeklyReviewTestSession>;
    close(): Promise<void>;
}

async function createSession(
    connectionString: string,
    schemaName: string
): Promise<FounderWeeklyReviewTestSession> {
    const client = postgres(connectionString, { max: 1 });
    await client.unsafe(buildSearchPathSql(schemaName));
    return {
        db: drizzle(client, { schema: coreSchema }),
        close: () => client.end({ timeout: 5 }),
    };
}

export async function createFounderWeeklyReviewTestDatabase(): Promise<FounderWeeklyReviewTestDatabase> {
    const connectionString =
        process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error(
            "LAUNCHSTACK_TEST_DATABASE_URL or DATABASE_URL is required for founder weekly review integration tests."
        );
    }

    const adminClient = postgres(connectionString, { max: 1 });
    const schemaName = `lau5_${randomUUID().replace(/-/g, "")}`;
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await adminClient.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    await adminClient.unsafe(buildSearchPathSql(schemaName));
    await bootstrapIsolatedSchema(adminClient, schemaName);

    const migrationFiles = await listMigrationFiles();
    for (const fileName of migrationFiles) {
        const body = normalizeSqlMigrationBody(
            await readFile(join(migrationsDir, fileName), "utf8")
        );
        await adminClient.begin(async (tx) => {
            await tx.unsafe(buildSearchPathSql(schemaName));
            await tx.unsafe(body);
        });
    }

    const primary = await createSession(connectionString, schemaName);

    return {
        schemaName,
        db: primary.db,
        createSession: () => createSession(connectionString, schemaName),
        async close() {
            await primary.close();
            await adminClient.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
            await adminClient.end({ timeout: 5 });
        },
    };
}
