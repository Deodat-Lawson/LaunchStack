ALTER TABLE "pdr_ai_v2_company"
ADD COLUMN IF NOT EXISTS "embedding_openai_api_key" text;

ALTER TABLE "pdr_ai_v2_company"
ADD COLUMN IF NOT EXISTS "embedding_huggingface_api_key" text;

ALTER TABLE "pdr_ai_v2_company"
ADD COLUMN IF NOT EXISTS "embedding_ollama_base_url" varchar(1024);

ALTER TABLE "pdr_ai_v2_company"
ADD COLUMN IF NOT EXISTS "embedding_ollama_model" varchar(256);
