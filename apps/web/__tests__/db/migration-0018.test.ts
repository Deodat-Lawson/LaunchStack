import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FILE_REF_PATTERNS } from "~/server/backfills/file-uploads-company-id";

const ROOT = join(__dirname, "..", "..");
const SQL_PATH = join(ROOT, "src", "server", "backfills", "sql", "file-uploads-company-id.sql");
const REGISTRY_PATH = join(ROOT, "src", "server", "backfills", "index.ts");

const anchoredFileUrlPattern = /^(https?:\/\/[^/?#]+)?\/api\/files\/([0-9]+)\/?(\?.*)?$/;

function extractFileId(url: string): string | null {
    return anchoredFileUrlPattern.exec(url)?.[2] ?? null;
}

describe("backfill file-uploads-company-id", () => {
    const sql = readFileSync(SQL_PATH, "utf8");
    const registry = readFileSync(REGISTRY_PATH, "utf8");

    it("is registered and depends on the company_id DDL migration", () => {
        expect(registry).toMatch(/id:\s*"2026-08-file-uploads-company-id"/);
        expect(registry).toMatch(/requiresMigration:\s*"20260809142627_file_uploads_company_id"/);
        expect(registry).toMatch(/requiresEngine:\s*false/);
    });

    it.each([
        ["/api/files/123", "123"],
        ["/api/files/123/", "123"],
        ["/api/files/123?download=1", "123"],
        ["https://app.example/api/files/123", "123"],
        ["https://app.example/api/files/123/?download=1", "123"],
        ["https://evil.example/api/files/123", "123"],
    ])("extracts the canonical file id from %s", (url, expectedId) => {
        expect(extractFileId(url)).toBe(expectedId);
    });

    it.each([
        "/api/files/9123-suffix",
        "/api/files/123-suffix",
        "/api/files/123abc",
        "/api/files/123/extra",
        "https://host.example/x/api/files/123",
        "https://host.example/api/files/123/extra",
    ])("rejects non-canonical file paths: %s", url => {
        expect(extractFileId(url)).toBeNull();
    });

    it("does not confuse a longer id with a suffix match", () => {
        expect(extractFileId("/api/files/9123")).toBe("9123");
        expect(extractFileId("/api/files/9123")).not.toBe("123");
    });

    it("documents that foreign hosts do not provide tenant ownership", () => {
        expect(sql).toMatch(/host is intentionally unchecked/i);
        expect(sql).toMatch(/document\.company_id/i);
    });

    it("clears ambiguous weak matches only when the canonical matcher is silent", () => {
        expect(sql).toMatch(/company_count\s*>\s*1/);
        expect(sql).toMatch(/"company_id"\s+IS\s+NOT\s+NULL/);
        // A stamp the runtime wrote inline must survive an unrelated URL that
        // merely mentions the id, so the clearing branch also requires the
        // anchored matcher to have no opinion.
        expect(sql).toMatch(
            /ambiguous\.file_id\s+IS\s+NOT\s+NULL[\s\S]{0,200}a\.file_id\s+IS\s+NULL/
        );
        expect(sql).not.toMatch(
            /UPDATE\s+"pdr_ai_v2_file_uploads"\s+SET\s+"company_id"\s*=\s*NULL\s*;/i
        );
    });

    it("re-backfills only unique anchored owners into NULL rows", () => {
        expect(sql).toMatch(/company_count\s*=\s*1/);
        expect(sql).toMatch(/f\."company_id"\s+IS\s+NULL/);
    });

    it("reads file references from document versions as well as documents", () => {
        // A version uploaded before the column existed stores its file id only on
        // the version row; a document-only scan leaves it unstamped and the
        // hardened /api/files route then denies it forever.
        expect(sql).toMatch(/pdr_ai_v2_document_versions/);
        expect(sql).toMatch(/UNION ALL/);
    });
});

describe("backfill file-uploads-company-id — pattern parity", () => {
    const sql = readFileSync(SQL_PATH, "utf8");

    // The TS twin used to inline these in a `sql` tagged template, where `\?`
    // was cooked down to a bare `?` and Postgres rejected the whole pattern.
    // Asserting on the exported constants catches that class of bug.
    it("keeps the escaped `\\?` intact in the anchored patterns", () => {
        expect(FILE_REF_PATTERNS.ANCHORED_CAPTURE).toContain(String.raw`(\?.*)?`);
        expect(FILE_REF_PATTERNS.ANCHORED_MATCH).toContain(String.raw`(\?.*)?`);
        expect(FILE_REF_PATTERNS.ANCHORED_CAPTURE).not.toContain("(?.*)?");
    });

    it("ships the same patterns in both twins", () => {
        for (const pattern of Object.values(FILE_REF_PATTERNS)) {
            expect(sql).toContain(pattern);
        }
    });

    it("weak matching requires a delimiter after the id", () => {
        const weak = new RegExp(FILE_REF_PATTERNS.WEAK_CAPTURE);
        // A blob path that merely embeds the id is not a reference to file 5 —
        // treating it as one let a foreign URL clear a correct company stamp.
        expect(weak.exec("https://blob.example.com/api/files/5-report.pdf")).toBeNull();
        expect(weak.exec("/api/files/5")?.[1]).toBe("5");
        expect(weak.exec("/api/files/5/download")?.[1]).toBe("5");
        expect(weak.exec("/api/files/5?x=1")?.[1]).toBe("5");
    });
});
