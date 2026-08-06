/**
 * Live DB verification for #297 against a migration-shaped company table.
 *
 * Requires DATABASE_URL pointing at a database where migration 0011 has
 * already dropped the plaintext embedding columns. Skips otherwise so CI
 * without Postgres still passes the unit suite.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { company } from "@launchstack/core/db/schema";

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("company select after migration 0011 (#297 live)", () => {
  const client = postgres(databaseUrl!, { max: 1 });
  const db = drizzle(client);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("selects and inserts company rows without referencing dropped columns", async () => {
    const missing = await client`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'pdr_ai_v2_company'
        AND column_name = ANY(${[
          "embedding_openai_api_key",
          "embedding_huggingface_api_key",
          "embedding_ollama_base_url",
          "embedding_ollama_model",
        ]})
    `;
    expect(missing).toHaveLength(0);

    await expect(db.select().from(company).limit(1)).resolves.toBeDefined();

    const inserted = await db
      .insert(company)
      .values({
        name: `issue-297-live-${Date.now()}`,
        numberOfEmployees: "1",
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).not.toHaveProperty("embeddingOpenAIApiKey");
    expect(inserted[0]?.id).toEqual(expect.any(Number));
  });
});
