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
const TAG = "20260809142658_reconcile_file_uploads_company_id";
const FILENAME = `${TAG}.sql`;
const FILE_UPLOADS_MIGRATION = "20260809142627_file_uploads_company_id.sql";

const anchoredFileUrlPattern =
  /^(https?:\/\/[^/?#]+)?\/api\/files\/([0-9]+)\/?(\?.*)?$/;

function extractFileId(url: string): string | null {
  return anchoredFileUrlPattern.exec(url)?.[2] ?? null;
}

describe("migration reconcile_file_uploads_company_id", () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, FILENAME), "utf8");

  it("runs after the file_uploads company_id migration in the engine set", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    expect(files.indexOf(FILE_UPLOADS_MIGRATION)).toBeGreaterThanOrEqual(0);
    expect(files.indexOf(FILENAME)).toBeGreaterThan(
      files.indexOf(FILE_UPLOADS_MIGRATION),
    );
    expect(files[files.length - 1]).toBe(FILENAME);
  });

  it("is listed in the engine journal after file_uploads_company_id", () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };

    const tags = journal.entries.map((e) => e.tag);
    expect(tags.indexOf(TAG)).toBeGreaterThan(
      tags.indexOf("20260809142627_file_uploads_company_id"),
    );
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
  ])("rejects non-canonical file paths: %s", (url) => {
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

  it("clears ambiguous weak matches conservatively without blanket nulling", () => {
    expect(sql).toMatch(/company_count\s*>\s*1/);
    expect(sql).toMatch(/"company_id"\s+IS\s+NOT\s+NULL/);
    expect(sql).toMatch(/intentionally conservative/i);
    expect(sql).not.toMatch(
      /UPDATE\s+"pdr_ai_v2_file_uploads"\s+SET\s+"company_id"\s*=\s*NULL\s*;/i,
    );
  });

  it("re-backfills only unique anchored owners into NULL rows", () => {
    expect(sql).toMatch(/company_count\s*=\s*1/);
    expect(sql).toMatch(/f\."company_id"\s+IS\s+NULL/);
  });
});
