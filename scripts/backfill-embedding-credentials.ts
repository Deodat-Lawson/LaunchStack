import "dotenv/config";

import { eq, isNotNull, or, sql } from "drizzle-orm";

import { db } from "../src/server/db";
import { company } from "../src/server/db/schema";
import { upsertCompanyCredentials } from "../src/lib/ai/company-credentials";

/**
 * Backfill plaintext embedding credentials from the legacy columns on
 * `pdr_ai_v2_company` into the encrypted `pdr_ai_v2_company_embedding_credentials`
 * table, then NULL out the legacy columns.
 *
 * Safe to re-run: `upsertCompanyCredentials` upserts, and the legacy NULL
 * step is idempotent. Requires `EMBEDDING_SECRETS_KEY` to be set.
 *
 * Run with:  pnpm tsx scripts/backfill-embedding-credentials.ts
 *
 * Flags:
 *   --dry-run   Log what would change without writing anything.
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.EMBEDDING_SECRETS_KEY) {
    console.error(
      "Refusing to run: EMBEDDING_SECRETS_KEY is not set. Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    process.exit(1);
  }

  const rows = await db
    .select({
      id: company.id,
      name: company.name,
      openAIApiKey: company.embeddingOpenAIApiKey,
      huggingFaceApiKey: company.embeddingHuggingFaceApiKey,
      ollamaBaseUrl: company.embeddingOllamaBaseUrl,
      ollamaModel: company.embeddingOllamaModel,
    })
    .from(company)
    .where(
      or(
        isNotNull(company.embeddingOpenAIApiKey),
        isNotNull(company.embeddingHuggingFaceApiKey),
        isNotNull(company.embeddingOllamaBaseUrl),
        isNotNull(company.embeddingOllamaModel),
      ),
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
    await db
      .update(company)
      .set({
        embeddingOpenAIApiKey: null,
        embeddingHuggingFaceApiKey: null,
        embeddingOllamaBaseUrl: null,
        embeddingOllamaModel: null,
      })
      .where(eq(company.id, row.id));

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

  // Close the connection so the script exits cleanly.
  await db.execute(sql`SELECT 1`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
