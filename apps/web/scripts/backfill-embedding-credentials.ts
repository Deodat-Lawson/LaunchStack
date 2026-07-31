/**
 * Backfill plaintext embedding credentials from the legacy columns on
 * `pdr_ai_v2_company` into the encrypted `pdr_ai_v2_company_embedding_credentials`
 * table, then NULL out the legacy columns.
 *
 * Migration 0011 drops those legacy columns. This script is only useful for
 * databases that still have them (for example older `db:push`-shaped
 * environments that never ran the SQL migration path). It uses raw SQL so it
 * does not depend on the removed Drizzle schema fields.
 *
 * Safe to re-run: `upsertCompanyCredentials` upserts, and the legacy NULL
 * step is idempotent. Requires `EMBEDDING_SECRETS_KEY` to be set.
 *
 * Run with:
 *   pnpm --filter @launchstack/web exec tsx ./scripts/backfill-embedding-credentials.ts
 *
 * Flags:
 *   --dry-run   Log what would change without writing anything.
 */

import "dotenv/config";

import { sql } from "drizzle-orm";

import { toRows } from "@launchstack/core/db";
import { upsertCompanyCredentials } from "@launchstack/core/embeddings";
import { db } from "../src/server/db";

const DRY_RUN = process.argv.includes("--dry-run");

type LegacyRow = {
  id: number;
  name: string;
  openAIApiKey: string | null;
  huggingFaceApiKey: string | null;
  ollamaBaseUrl: string | null;
  ollamaModel: string | null;
};

async function legacyColumnsExist(): Promise<boolean> {
  const rows = toRows<{ exists: number }>(
    await db.execute(sql`
      SELECT 1 AS exists
      FROM information_schema.columns
      WHERE table_name = 'pdr_ai_v2_company'
        AND column_name = 'embedding_openai_api_key'
      LIMIT 1
    `),
  );
  return rows.length > 0;
}

async function main() {
  if (!process.env.EMBEDDING_SECRETS_KEY) {
    console.error(
      "Refusing to run: EMBEDDING_SECRETS_KEY is not set. Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    process.exit(1);
  }

  if (!(await legacyColumnsExist())) {
    console.log(
      "Legacy plaintext embedding columns are already gone " +
        "(migration 0011 applied). Nothing to backfill.",
    );
    return;
  }

  const rows = toRows<LegacyRow>(
    await db.execute(sql`
      SELECT
        id,
        name,
        embedding_openai_api_key AS "openAIApiKey",
        embedding_huggingface_api_key AS "huggingFaceApiKey",
        embedding_ollama_base_url AS "ollamaBaseUrl",
        embedding_ollama_model AS "ollamaModel"
      FROM pdr_ai_v2_company
      WHERE embedding_openai_api_key IS NOT NULL
         OR embedding_huggingface_api_key IS NOT NULL
         OR embedding_ollama_base_url IS NOT NULL
         OR embedding_ollama_model IS NOT NULL
    `),
  );

  console.log(
    `Found ${rows.length} company row(s) with legacy embedding credentials${DRY_RUN ? " (dry-run)" : ""}.`,
  );

  let migrated = 0;
  for (const row of rows) {
    const input: {
      openAIApiKey?: string | null;
      huggingFaceApiKey?: string | null;
      ollamaBaseUrl?: string | null;
      ollamaModel?: string | null;
    } = {};
    if (row.openAIApiKey) input.openAIApiKey = row.openAIApiKey;
    if (row.huggingFaceApiKey) input.huggingFaceApiKey = row.huggingFaceApiKey;
    if (row.ollamaBaseUrl) input.ollamaBaseUrl = row.ollamaBaseUrl;
    if (row.ollamaModel) input.ollamaModel = row.ollamaModel;

    if (Object.keys(input).length === 0) continue;

    console.log(
      `  company #${row.id} (${row.name}): fields = [${Object.keys(input).join(", ")}]`,
    );

    if (DRY_RUN) continue;

    await upsertCompanyCredentials(row.id, input);

    // Null out the legacy columns so this row won't be picked up on re-run.
    await db.execute(sql`
      UPDATE pdr_ai_v2_company
      SET
        embedding_openai_api_key = NULL,
        embedding_huggingface_api_key = NULL,
        embedding_ollama_base_url = NULL,
        embedding_ollama_model = NULL
      WHERE id = ${row.id}
    `);

    migrated += 1;
  }

  if (DRY_RUN) {
    console.log(
      `Dry run complete. ${rows.length} row(s) would be migrated. No changes written.`,
    );
  } else {
    console.log(
      `Migrated ${migrated} row(s). Once verified, apply drizzle/0011_drop_plaintext_embedding_credentials.sql to remove the legacy columns.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
