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
 * The real migration runner applies engine migrations before product
 * migrations because product tables reference engine tables.
 */
const MIGRATION_SETS = [join(repoRoot, "packages", "core", "drizzle"), join(webDir, "drizzle")];

interface JournalEntry {
    idx: number;
    tag: string;
}

async function listMigrationFiles(dir: string): Promise<string[]> {
    const journal = JSON.parse(await readFile(join(dir, "meta", "_journal.json"), "utf8")) as {
        entries?: JournalEntry[];
    };

    return [...(journal.entries ?? [])]
        .sort((a, b) => a.idx - b.idx)
        .map(entry => join(dir, `${entry.tag}.sql`));
}

function withDatabase(connectionString: string, databaseName: string): string {
    const url = new URL(connectionString);
    url.pathname = `/${databaseName}`;
    return url.toString();
}

export interface CallNotesTestSession {
    db: DbClient;
    close(): Promise<void>;
}

export interface CallNotesTestDatabase {
    databaseName: string;
    db: DbClient;
    createSession(): Promise<CallNotesTestSession>;
    close(): Promise<void>;
}

async function createSession(connectionString: string): Promise<CallNotesTestSession> {
    const client = postgres(connectionString, { max: 1 });
    return {
        db: drizzle(client, { schema: { ...coreSchema, ...featuresSchema } }),
        close: () => client.end({ timeout: 5 }),
    };
}

/**
 * Creates and migrates a database rather than relying on a search_path schema.
 * Generated foreign keys explicitly reference public tables, so a database
 * sandbox is the smallest faithful copy of deployment migration behavior.
 */
export async function createCallNotesTestDatabase(): Promise<CallNotesTestDatabase> {
    const connectionString = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error(
            "LAUNCHSTACK_TEST_DATABASE_URL or DATABASE_URL is required for Call Notes integration tests."
        );
    }

    const databaseName = `lau_call_notes_${randomUUID().replace(/-/g, "")}`;
    const maintenance = postgres(connectionString, { max: 1 });

    try {
        await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
    } catch (error) {
        await maintenance.end({ timeout: 5 });
        throw new Error(
            `could not create the throwaway test database "${databaseName}": ` +
                `${(error as Error).message}\n` +
                "These suites need a role with CREATEDB on the server behind " +
                "LAUNCHSTACK_TEST_DATABASE_URL / DATABASE_URL."
        );
    }

    const testUrl = withDatabase(connectionString, databaseName);
    const admin = postgres(testUrl, { max: 1 });

    try {
        for (const dir of MIGRATION_SETS) {
            for (const file of await listMigrationFiles(dir)) {
                const body = await readFile(file, "utf8");
                await admin.begin(async tx => {
                    await tx.unsafe(body);
                });
            }
        }
    } catch (error) {
        try {
            await admin.end({ timeout: 5 });
        } finally {
            try {
                await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
            } finally {
                await maintenance.end({ timeout: 5 });
            }
        }
        throw error;
    }

    let primary: CallNotesTestSession;
    try {
        primary = await createSession(testUrl);
    } catch (error) {
        await admin.end({ timeout: 5 }).catch(() => undefined);
        await maintenance
            .unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
            .catch(() => undefined);
        await maintenance.end({ timeout: 5 }).catch(() => undefined);
        throw error;
    }

    return {
        databaseName,
        db: primary.db,
        createSession: () => createSession(testUrl),
        async close() {
            try {
                await primary.close();
            } finally {
                try {
                    await admin.end({ timeout: 5 });
                } finally {
                    try {
                        await maintenance.unsafe(
                            `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`
                        );
                    } finally {
                        await maintenance.end({ timeout: 5 });
                    }
                }
            }
        },
    };
}
