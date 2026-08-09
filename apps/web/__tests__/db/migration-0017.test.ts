/**
 * The schema gained `file_uploads.company_id` and the app both reads and
 * writes it, but the migration runner is forward-only: without a SQL file the
 * column never exists on a deployed database. This guards the file's presence
 * and the properties that make it safe to apply and re-apply.
 *
 * Engine table — lives in packages/core's timestamped journal set.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "core",
  "drizzle",
);
const TAG = "20260809140000_file_uploads_company_id";
const FILENAME = `${TAG}.sql`;
const LIFECYCLE = "20260808223719_document_creation_lifecycle.sql";

describe("migration file_uploads_company_id", () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, FILENAME), "utf8");

  it("is applied after the engine baseline / lifecycle migrations", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    expect(files).toContain(FILENAME);
    expect(files.indexOf(FILENAME)).toBeGreaterThan(files.indexOf(LIFECYCLE));
  });

  it("is listed in the engine journal after document_creation_lifecycle", () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };

    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain(TAG);
    expect(tags.indexOf(TAG)).toBeGreaterThan(
      tags.indexOf("20260808223719_document_creation_lifecycle"),
    );
  });

  it("adds a nullable company_id with an ON DELETE SET NULL foreign key", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS "company_id" bigint\s+REFERENCES "pdr_ai_v2_company"\("id"\) ON DELETE SET NULL/,
    );
    expect(sql).not.toMatch(/company_id" bigint NOT NULL/);
  });

  it("indexes the new column", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "file_uploads_company_id_idx"/,
    );
  });

  it("only backfills rows it can attribute to exactly one company", () => {
    expect(sql).toMatch(/company_count = 1/);
    expect(sql).toMatch(/f\."company_id" IS NULL/);
  });

  it("is safe to re-run", () => {
    const ddl = sql.match(/^\s*(ALTER TABLE|CREATE INDEX|CREATE TABLE)/gim) ?? [];
    expect(ddl.length).toBeGreaterThan(0);
    for (const statement of sql.split(";")) {
      if (/^\s*(ALTER TABLE|CREATE INDEX|CREATE TABLE)/im.test(statement)) {
        expect(statement).toMatch(/IF NOT EXISTS/i);
      }
    }
  });
});
