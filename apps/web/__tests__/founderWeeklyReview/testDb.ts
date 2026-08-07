import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as coreSchema from "@launchstack/core/db/schema";
import * as featuresSchema from "@launchstack/features/schema";
import type { DbClient } from "@launchstack/core/db";

const webDir = join(__dirname, "..", "..");
const repoRoot = join(webDir, "..", "..");

/**
 * The two migration sets, in the order `db:migrate` applies them: engine first,
 * then product. The product set has foreign keys into engine tables, so
 * applying apps/web/drizzle alone fails on the first one.
 */
const MIGRATION_SETS = [
    join(repoRoot, "packages", "core", "drizzle"),
    join(webDir, "drizzle"),
];

interface JournalEntry {
    idx: number;
    tag: string;
}

/**
 * Migration files in journal order, not filename order — the journal is what
 * the real runner (packages/core/scripts/migrate.mjs) reads, so these tests
 * apply exactly the SQL, in exactly the order, that a deploy applies.
 */
async function listMigrationFiles(dir: string): Promise<string[]> {
    const journal = JSON.parse(
        await readFile(join(dir, "meta", "_journal.json"), "utf8")
    ) as { entries?: JournalEntry[] };
    return [...(journal.entries ?? [])]
        .sort((a, b) => a.idx - b.idx)
        .map((entry) => join(dir, `${entry.tag}.sql`));
}

function withDatabase(connectionString: string, databaseName: string): string {
    const url = new URL(connectionString);
    url.pathname = `/${databaseName}`;
    return url.toString();
}

export interface FounderWeeklyReviewTestSession {
    db: DbClient;
    close(): Promise<void>;
}

export interface FounderWeeklyReviewTestDatabase {
    databaseName: string;
    db: DbClient;
    createSession(): Promise<FounderWeeklyReviewTestSession>;
    close(): Promise<void>;
}

async function createSession(
    connectionString: string
): Promise<FounderWeeklyReviewTestSession> {
    const client = postgres(connectionString, { max: 1 });
    return {
        db: drizzle(client, { schema: { ...coreSchema, ...featuresSchema } }),
        close: () => client.end({ timeout: 5 }),
    };
}

/**
 * Spins up a throwaway database and migrates it with both sets.
 *
 * A database rather than a `search_path` schema: generated migrations qualify
 * every foreign key as `"public"."…"`, so a per-schema sandbox would resolve
 * those references to the wrong (empty) schema. Isolating at the database level
 * is what lets these suites run the real migration SQL unmodified.
 */
export async function createFounderWeeklyReviewTestDatabase(): Promise<FounderWeeklyReviewTestDatabase> {
    const connectionString =
        process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error(
            "LAUNCHSTACK_TEST_DATABASE_URL or DATABASE_URL is required for founder weekly review integration tests."
        );
    }

    const databaseName = `lau6_${randomUUID().replace(/-/g, "")}`;
    const maintenance = postgres(connectionString, { max: 1 });

    try {
        // CREATE DATABASE cannot run inside a transaction block, hence `unsafe`
        // on a plain connection rather than `begin`.
        await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
    } catch (error) {
        await maintenance.end({ timeout: 5 });
        throw new Error(
            `could not create the throwaway test database "${databaseName}": ` +
                `${(error as Error).message}\n` +
                `These suites need a role with CREATEDB on the server behind ` +
                `LAUNCHSTACK_TEST_DATABASE_URL / DATABASE_URL.`
        );
    }

    const testUrl = withDatabase(connectionString, databaseName);
    const admin = postgres(testUrl, { max: 1 });

    try {
        for (const dir of MIGRATION_SETS) {
            for (const file of await listMigrationFiles(dir)) {
                const body = await readFile(file, "utf8");
                await admin.begin(async (tx) => {
                    await tx.unsafe(body);
                });
            }
        }
    } catch (error) {
        await admin.end({ timeout: 5 });
        await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
        await maintenance.end({ timeout: 5 });
        throw error;
    }

    const primary = await createSession(testUrl);

    return {
        databaseName,
        db: primary.db,
        createSession: () => createSession(testUrl),
        async close() {
            await primary.close();
            await admin.end({ timeout: 5 });
            // WITH (FORCE) so a session a test forgot to close cannot wedge the
            // drop and leak a database into the next run.
            await maintenance.unsafe(
                `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`
            );
            await maintenance.end({ timeout: 5 });
        },
    };
}
