/**
 * Regression for https://github.com/Deodat-Lawson/LaunchStack/issues/297
 *
 * Migration 0011 drops plaintext embedding credential columns from
 * `pdr_ai_v2_company`. The Drizzle company schema and credential read path
 * must stay aligned with that final shape — otherwise clean migration-replayed
 * databases fail on `select()` / `.returning()` of the company row.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableColumns } from "drizzle-orm";
import { company } from "@launchstack/core/db/schema";

const DROPPED_EMBEDDING_COLUMNS = [
  "embedding_openai_api_key",
  "embedding_huggingface_api_key",
  "embedding_ollama_base_url",
  "embedding_ollama_model",
] as const;

/** Jest runs with cwd = apps/web; fall back to climbing from this file. */
function resolveRepoRoot(): string {
  const fromCwd = join(process.cwd(), "../..");
  if (existsSync(join(fromCwd, "packages/core/package.json"))) {
    return fromCwd;
  }
  const fromFile = join(__dirname, "../../../../..");
  if (existsSync(join(fromFile, "packages/core/package.json"))) {
    return fromFile;
  }
  throw new Error(
    `Unable to resolve monorepo root from cwd=${process.cwd()} __dirname=${__dirname}`,
  );
}

const repoRoot = resolveRepoRoot();

describe("company embedding credential schema alignment (#297)", () => {
  it("does not declare columns dropped by migration 0011 on the company table", () => {
    const columns = getTableColumns(company);
    const sqlNames = Object.values(columns).map((column) => column.name);

    for (const dropped of DROPPED_EMBEDDING_COLUMNS) {
      expect(sqlNames).not.toContain(dropped);
    }

    expect(columns).not.toHaveProperty("embeddingOpenAIApiKey");
    expect(columns).not.toHaveProperty("embeddingHuggingFaceApiKey");
    expect(columns).not.toHaveProperty("embeddingOllamaBaseUrl");
    expect(columns).not.toHaveProperty("embeddingOllamaModel");
  });

  it("keeps migration 0011 as the drop of those plaintext columns", () => {
    const migrationPath = join(
      repoRoot,
      "apps/web/drizzle/0011_drop_plaintext_embedding_credentials.sql",
    );
    const body = readFileSync(migrationPath, "utf8");

    expect(body).toMatch(/ALTER TABLE\s+"pdr_ai_v2_company"/i);
    for (const dropped of DROPPED_EMBEDDING_COLUMNS) {
      expect(body).toContain(`DROP COLUMN IF EXISTS "${dropped}"`);
    }
  });

  it("reads credentials only from the encrypted credentials table", () => {
    const sourcePath = join(
      repoRoot,
      "packages/core/src/embeddings/company-credentials.ts",
    );
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("companyEmbeddingCredentials");
    expect(source).not.toMatch(/company\.embeddingOpenAIApiKey/);
    expect(source).not.toMatch(/company\.embeddingHuggingFaceApiKey/);
    expect(source).not.toMatch(/company\.embeddingOllamaBaseUrl/);
    expect(source).not.toMatch(/company\.embeddingOllamaModel/);
    expect(source).not.toMatch(/embedding_openai_api_key/);
    expect(source).not.toMatch(/embedding_huggingface_api_key/);
    expect(source).not.toMatch(/embedding_ollama_base_url/);
    expect(source).not.toMatch(/embedding_ollama_model/);
  });
});
