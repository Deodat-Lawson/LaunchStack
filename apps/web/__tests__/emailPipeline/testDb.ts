import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as coreSchema from "@launchstack/core/db/schema";
import { configureDatabase, type DbClient } from "@launchstack/core/db";

const webDir = join(__dirname, "..", "..");

/**
 * Only this feature's migration. The rest of apps/web/drizzle is a chain of
 * incremental files that assume a base schema created by `drizzle-kit push`,
 * so replaying them from empty would fail — but the email tables are
 * self-contained (company_id is a plain bigint, no cross-feature FK), so the
 * suites can run the exact SQL a deploy applies for this feature.
 */
const MIGRATION_FILES = [join(webDir, "drizzle", "20260814050513_email_pipeline.sql")];

function withDatabase(connectionString: string, databaseName: string): string {
    const url = new URL(connectionString);
    url.pathname = `/${databaseName}`;
    return url.toString();
}

/**
 * Delivery mints signed unsubscribe links, which need a signing secret. These
 * suites supply their own so the run does not depend on the developer's
 * environment — and so CI, where nothing sets it, behaves the same as a laptop.
 */
process.env.EMAIL_UNSUBSCRIBE_SECRET ??= "email-pipeline-test-secret";

export interface EmailPipelineTestDatabase {
    databaseName: string;
    db: DbClient;
    /**
     * A distinct company id. These tables carry no FK to `company`, so a test
     * only needs an id nothing else is using.
     */
    createCompany(): Promise<number>;
    close(): Promise<void>;
}

/**
 * Spins up a throwaway database, migrates it with both sets, and installs it as
 * the process-wide DbClient so the feature layer's `getDb()` reaches it.
 *
 * A database rather than a `search_path` schema: generated migrations qualify
 * every foreign key as `"public"."…"`, so a per-schema sandbox would resolve
 * those references to the wrong (empty) schema.
 */
export async function createEmailPipelineTestDatabase(): Promise<EmailPipelineTestDatabase> {
    const connectionString = process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error(
            "LAUNCHSTACK_TEST_DATABASE_URL or DATABASE_URL is required for email pipeline integration tests."
        );
    }

    const databaseName = `email_${randomUUID().replace(/-/g, "")}`;
    const maintenance = postgres(connectionString, { max: 1 });

    try {
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
        for (const file of MIGRATION_FILES) {
            const body = await readFile(file, "utf8");
            await admin.begin(async tx => {
                await tx.unsafe(body);
            });
        }
    } catch (error) {
        await admin.end({ timeout: 5 });
        await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
        await maintenance.end({ timeout: 5 });
        throw error;
    }

    const client = postgres(testUrl, { max: 5 });
    const db = drizzle(client, { schema: coreSchema }) as unknown as DbClient;

    // The feature layer reaches the database through getDb(), so the throwaway
    // database has to be the registered one for the duration of the suite.
    configureDatabase(db);

    let companySeq = 1000;
    return {
        databaseName,
        db,
        createCompany() {
            companySeq += 1;
            return Promise.resolve(companySeq);
        },
        async close() {
            await client.end({ timeout: 5 });
            await admin.end({ timeout: 5 });
            await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
            await maintenance.end({ timeout: 5 });
        },
    };
}
