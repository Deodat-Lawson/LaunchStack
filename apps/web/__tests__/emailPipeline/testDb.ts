import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as coreSchema from "@launchstack/core/db/schema";
import * as featuresSchema from "@launchstack/features/schema";
import { company } from "@launchstack/core/db/schema";
import { configureDatabase, type DbClient } from "@launchstack/core/db";

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

async function listMigrationFiles(dir: string): Promise<string[]> {
  const journal = JSON.parse(
    await readFile(join(dir, "meta", "_journal.json"), "utf8"),
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

export interface EmailPipelineTestDatabase {
  databaseName: string;
  db: DbClient;
  /** Insert a company row and return its id — every campaign needs one. */
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
  const connectionString =
    process.env.LAUNCHSTACK_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "LAUNCHSTACK_TEST_DATABASE_URL or DATABASE_URL is required for email pipeline integration tests.",
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
        `LAUNCHSTACK_TEST_DATABASE_URL / DATABASE_URL.`,
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

  const client = postgres(testUrl, { max: 5 });
  const db = drizzle(client, {
    schema: { ...coreSchema, ...featuresSchema },
  }) as unknown as DbClient;

  // The feature layer reaches the database through getDb(), so the throwaway
  // database has to be the registered one for the duration of the suite.
  configureDatabase(db);

  let companySeq = 0;
  return {
    databaseName,
    db,
    async createCompany() {
      companySeq += 1;
      const [row] = await db
        .insert(company)
        .values({
          name: `Test Co ${companySeq}`,
          numberOfEmployees: "1-10",
        })
        .returning({ id: company.id });
      if (!row) throw new Error("failed to seed company");
      return Number(row.id);
    },
    async close() {
      await client.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
      await maintenance.unsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await maintenance.end({ timeout: 5 });
    },
  };
}
