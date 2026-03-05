import "dotenv/config";
import { db } from "../src/server/db";
import { sql } from "drizzle-orm";

async function createTables() {
  try {
    console.log("Creating company_metadata table...");

    // Create company_metadata table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pdr_ai_v2_company_metadata (
        id SERIAL PRIMARY KEY,
        company_id BIGINT NOT NULL REFERENCES pdr_ai_v2_company(id) ON DELETE CASCADE,
        schema_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
        metadata JSONB NOT NULL,
        last_extraction_document_id BIGINT REFERENCES pdr_ai_v2_document(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ
      )
    `);

    // Create unique index on company_id
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS company_metadata_company_id_unique
      ON pdr_ai_v2_company_metadata(company_id)
    `);

    console.log("Creating company_metadata_history table...");

    // Create company_metadata_history table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pdr_ai_v2_company_metadata_history (
        id SERIAL PRIMARY KEY,
        company_id BIGINT NOT NULL REFERENCES pdr_ai_v2_company(id) ON DELETE CASCADE,
        document_id BIGINT REFERENCES pdr_ai_v2_document(id) ON DELETE SET NULL,
        change_type VARCHAR(32) NOT NULL,
        diff JSONB NOT NULL,
        changed_by VARCHAR(256) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for history table
    await db.execute(sql`CREATE INDEX IF NOT EXISTS company_metadata_history_company_id_idx ON pdr_ai_v2_company_metadata_history(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS company_metadata_history_document_id_idx ON pdr_ai_v2_company_metadata_history(document_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS company_metadata_history_created_at_idx ON pdr_ai_v2_company_metadata_history(created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS company_metadata_history_change_type_idx ON pdr_ai_v2_company_metadata_history(change_type)`);

    console.log("✅ Tables created successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error creating tables:", error);
    process.exit(1);
  }
}

createTables();
