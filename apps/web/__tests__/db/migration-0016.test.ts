/**
 * The schema gained `file_uploads.company_id` and the app both reads and
 * writes it, but the migration runner is forward-only: without a SQL file the
 * column never exists on a deployed database. This guards the file's presence
 * and the properties that make it safe to apply and re-apply.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "drizzle");
const FILENAME = "0016_file_uploads_company_id.sql";

describe("migration 0016", () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, FILENAME), "utf8");

  it("is applied after the memberships migration", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    expect(files).toContain(FILENAME);
    expect(files.indexOf(FILENAME)).toBeGreaterThan(
      files.indexOf("0015_user_company_memberships.sql"),
    );
    expect(files[files.length - 1]).toBe(FILENAME);
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
