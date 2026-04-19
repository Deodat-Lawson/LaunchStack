import { sql } from "drizzle-orm";
import {
  integer,
  smallint,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { company } from "./base";
import { pgTable } from "./helpers";

/**
 * Per-company embedding provider credentials, with API keys encrypted at
 * rest via AES-256-GCM (see `src/lib/crypto/secret-box.ts`).
 *
 * Mirrors Onyx's `CloudEmbeddingProvider` shape: non-secret config
 * (Ollama base URL / model) stays plaintext for operator convenience; the
 * two real secrets (OpenAI, Hugging Face) are stored as base64 ciphertext
 * plus a 4-char suffix for UI feedback (`…ab12`).
 *
 * Populated by `src/lib/ai/company-credentials.ts`. The legacy plaintext
 * `company.embedding*` columns remain until backfill runs, then get dropped
 * in a follow-up migration.
 */
export const companyEmbeddingCredentials = pgTable(
  "company_embedding_credentials",
  {
    companyId: integer("company_id")
      .primaryKey()
      .references(() => company.id, { onDelete: "cascade" }),
    openAIApiKeyCiphertext: text("openai_api_key_ciphertext"),
    openAIApiKeyLast4: varchar("openai_api_key_last4", { length: 8 }),
    huggingFaceApiKeyCiphertext: text("huggingface_api_key_ciphertext"),
    huggingFaceApiKeyLast4: varchar("huggingface_api_key_last4", { length: 8 }),
    ollamaBaseUrl: text("ollama_base_url"),
    ollamaModel: varchar("ollama_model", { length: 256 }),
    encryptionKeyVersion: smallint("encryption_key_version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
);
