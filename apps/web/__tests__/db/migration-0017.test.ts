/**
 * Engine DDL for `file_uploads.company_id`. Data rewrites live in the
 * `2026-08-file-uploads-company-id` backfill — migrations must stay DML-free.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "packages", "store", "drizzle");
const TAG = "20260809142627_file_uploads_company_id";
const FILENAME = `${TAG}.sql`;
const LIFECYCLE = "20260808223719_document_creation_lifecycle.sql";

describe("migration file_uploads_company_id", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, FILENAME), "utf8");

    it("is applied after the engine baseline / lifecycle migrations", () => {
        const files = readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith(".sql"))
            .sort();

        expect(files).toContain(FILENAME);
        expect(files.indexOf(FILENAME)).toBeGreaterThan(files.indexOf(LIFECYCLE));
    });

    it("is listed in the engine journal after document_creation_lifecycle", () => {
        const journal = JSON.parse(
            readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")
        ) as { entries: Array<{ idx: number; tag: string }> };

        const tags = journal.entries.map(e => e.tag);
        expect(tags).toContain(TAG);
        expect(tags.indexOf(TAG)).toBeGreaterThan(
            tags.indexOf("20260808223719_document_creation_lifecycle")
        );
        expect(tags[tags.length - 1]).toBe(TAG);
    });

    it("adds a nullable company_id with an ON DELETE SET NULL foreign key", () => {
        expect(sql).toMatch(/ADD COLUMN "company_id" bigint/);
        expect(sql).toMatch(
            /ADD CONSTRAINT "pdr_ai_v2_file_uploads_company_id_pdr_ai_v2_company_id_fk"[\s\S]*ON DELETE set null/i
        );
        expect(sql).not.toMatch(/company_id" bigint NOT NULL/);
    });

    it("indexes the new column", () => {
        expect(sql).toMatch(/CREATE INDEX "file_uploads_company_id_idx"/);
    });

    it("contains no DML", () => {
        expect(sql).not.toMatch(/^\s*(UPDATE|INSERT INTO|DELETE FROM|DO \$\$)/im);
    });
});
