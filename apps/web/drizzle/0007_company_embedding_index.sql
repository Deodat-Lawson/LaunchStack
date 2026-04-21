ALTER TABLE "pdr_ai_v2_company"
ADD COLUMN IF NOT EXISTS "embedding_index_key" varchar(128);
