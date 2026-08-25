-- Engine baseline: the 25 tables @launchstack/core owns and publishes.
--
-- Generated from packages/core/src/db/schema.ts. A consumer embedding the
-- engine applies this set alone and gets a working database; nothing here
-- references a product table.
--
-- CREATE EXTENSION is the one permitted hand-edit to a generated migration.
-- It is not in the drizzle snapshot, so no future `generate` removes it, and
-- IF NOT EXISTS short-circuits before the privilege check.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_category" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"company_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_company" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"slug" varchar(64),
	"description" text,
	"industry" varchar(256),
	"swatch" integer DEFAULT 1 NOT NULL,
	"embedding_index_key" varchar(128),
	"active_embedding_index_key" varchar(128),
	"pending_embedding_index_key" varchar(128),
	"reindex_status" varchar(16) DEFAULT 'STABLE' NOT NULL,
	"reindex_job_id" text,
	"reindex_started_at" timestamp with time zone,
	"reindex_completed_at" timestamp with time zone,
	"reindex_error" text,
	"employerPasskey" varchar(256) DEFAULT '' NOT NULL,
	"employeePasskey" varchar(256) DEFAULT '' NOT NULL,
	"numberOfEmployees" varchar(256) NOT NULL,
	"use_uploadthing" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"url" varchar(256) NOT NULL,
	"category" varchar(256) NOT NULL,
	"title" varchar(256) NOT NULL,
	"company_id" bigint NOT NULL,
	"ocr_enabled" boolean DEFAULT false,
	"ocr_processed" boolean DEFAULT false,
	"ocr_metadata" jsonb,
	"ocr_job_id" varchar(256),
	"ocr_provider" varchar(50),
	"ocr_confidence_score" integer,
	"ocr_cost_cents" integer,
	"mime_type" varchar(128),
	"source_archive_name" varchar(256),
	"file_type" varchar(128),
	"current_version_id" bigint,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"version_number" integer NOT NULL,
	"url" varchar(512) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"file_size" bigint,
	"uploaded_by" varchar(256),
	"changelog" text,
	"ocr_job_id" varchar(256),
	"ocr_provider" varchar(50),
	"ocr_processed" boolean DEFAULT false,
	"ocr_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_file_uploads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"filename" varchar(256) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"file_data" text,
	"file_size" integer NOT NULL,
	"storage_provider" varchar(64) DEFAULT 'database' NOT NULL,
	"storage_url" varchar(1024),
	"storage_pathname" varchar(1024),
	"blob_checksum" varchar(128),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_ocr_cost_tracking" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"provider" varchar(50) NOT NULL,
	"month" varchar(7) NOT NULL,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"total_pages" integer DEFAULT 0 NOT NULL,
	"total_cost_cents" integer DEFAULT 0 NOT NULL,
	"average_cost_per_page" integer DEFAULT 0 NOT NULL,
	"average_confidence_score" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_ocr_jobs" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"document_id" bigint,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"status" varchar(50) DEFAULT 'queued' NOT NULL,
	"document_url" varchar(1024) NOT NULL,
	"document_name" varchar(256) NOT NULL,
	"page_count" integer,
	"file_size_bytes" bigint,
	"complexity_score" integer,
	"document_type" varchar(50),
	"primary_provider" varchar(50),
	"actual_provider" varchar(50),
	"estimated_cost_cents" integer,
	"actual_cost_cents" integer,
	"confidence_score" integer,
	"quality_flags" jsonb,
	"requires_review" boolean DEFAULT false,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"processing_duration_ms" integer,
	"ocr_result" jsonb,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"webhook_url" varchar(1024),
	"webhook_status" varchar(20),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_ocr_processing_steps" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"job_id" varchar(256) NOT NULL,
	"step_number" integer NOT NULL,
	"step_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_pdf_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"page" integer NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_upload_batch_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"filename" varchar(512) NOT NULL,
	"relative_path" varchar(1024),
	"mime_type" varchar(128),
	"file_size_bytes" bigint,
	"storage_url" varchar(1024),
	"storage_type" varchar(32),
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"metadata" jsonb,
	"document_id" bigint,
	"job_id" varchar(256),
	"error_message" text,
	"uploaded_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_upload_batches" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'created' NOT NULL,
	"metadata" jsonb,
	"total_files" integer DEFAULT 0 NOT NULL,
	"uploaded_files" integer DEFAULT 0 NOT NULL,
	"processed_files" integer DEFAULT 0 NOT NULL,
	"failed_files" integer DEFAULT 0 NOT NULL,
	"committed_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_company_embedding_credentials" (
	"company_id" bigint PRIMARY KEY NOT NULL,
	"openai_api_key_ciphertext" text,
	"openai_api_key_last4" varchar(8),
	"huggingface_api_key_ciphertext" text,
	"huggingface_api_key_last4" varchar(8),
	"ollama_base_url" text,
	"ollama_model" varchar(256),
	"encryption_key_version" smallint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_context_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"version_id" bigint,
	"structure_id" bigint,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"content_hash" varchar(64),
	"semantic_type" varchar(50),
	"page_number" integer,
	"line_start" integer,
	"line_end" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_embeddings_1024" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"retrieval_chunk_id" bigint NOT NULL,
	"index_key" varchar(128) NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"version" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_embeddings_768" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"retrieval_chunk_id" bigint NOT NULL,
	"index_key" varchar(128) NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"version" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_metadata" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"version_id" bigint,
	"total_tokens" integer DEFAULT 0,
	"total_sections" integer DEFAULT 0,
	"total_tables" integer DEFAULT 0,
	"total_figures" integer DEFAULT 0,
	"total_pages" integer DEFAULT 0,
	"max_section_depth" integer DEFAULT 0,
	"topic_tags" jsonb,
	"summary" text,
	"outline" jsonb,
	"complexity_score" integer,
	"document_class" varchar(50),
	"entities" jsonb,
	"summary_embedding" vector(1536),
	"date_range_start" timestamp with time zone,
	"date_range_end" timestamp with time zone,
	"language" varchar(10) DEFAULT 'en',
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_previews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"version_id" bigint,
	"section_id" bigint,
	"structure_id" bigint,
	"preview_type" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_retrieval_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"context_chunk_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"version_id" bigint,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"embedding_short" vector(512),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_structure" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"version_id" bigint,
	"parent_id" bigint,
	"level" integer DEFAULT 0 NOT NULL,
	"ordering" integer DEFAULT 0 NOT NULL,
	"title" text,
	"content_type" varchar(50) DEFAULT 'section' NOT NULL,
	"path" varchar(256),
	"start_page" integer,
	"end_page" integer,
	"child_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_document_embeddings_exp" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"retrieval_chunk_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"version" text NOT NULL,
	"dimension" integer DEFAULT 1024 NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_workspace_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" varchar(256) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint,
	"section_id" bigint,
	"structure_id" bigint,
	"result_type" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"parent_result_id" bigint,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_kg_entities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(512) NOT NULL,
	"display_name" varchar(512) NOT NULL,
	"label" varchar(20) NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"mention_count" integer DEFAULT 1 NOT NULL,
	"company_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_kg_entity_mentions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" bigint NOT NULL,
	"section_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_kg_relationships" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_entity_id" bigint NOT NULL,
	"target_entity_id" bigint NOT NULL,
	"relationship_type" varchar(30) NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"evidence_count" integer DEFAULT 1 NOT NULL,
	"document_id" bigint,
	"company_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_data_backfills" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"cursor" jsonb,
	"processed" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_category" ADD CONSTRAINT "pdr_ai_v2_category_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document" ADD CONSTRAINT "pdr_ai_v2_document_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_versions" ADD CONSTRAINT "pdr_ai_v2_document_versions_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ocr_cost_tracking" ADD CONSTRAINT "pdr_ai_v2_ocr_cost_tracking_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ocr_jobs" ADD CONSTRAINT "pdr_ai_v2_ocr_jobs_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ocr_jobs" ADD CONSTRAINT "pdr_ai_v2_ocr_jobs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_ocr_processing_steps" ADD CONSTRAINT "pdr_ai_v2_ocr_processing_steps_job_id_pdr_ai_v2_ocr_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."pdr_ai_v2_ocr_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_pdf_chunks" ADD CONSTRAINT "pdr_ai_v2_pdf_chunks_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_upload_batch_files" ADD CONSTRAINT "pdr_ai_v2_upload_batch_files_batch_id_pdr_ai_v2_upload_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."pdr_ai_v2_upload_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_upload_batch_files" ADD CONSTRAINT "pdr_ai_v2_upload_batch_files_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_upload_batch_files" ADD CONSTRAINT "pdr_ai_v2_upload_batch_files_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_upload_batch_files" ADD CONSTRAINT "pdr_ai_v2_upload_batch_files_job_id_pdr_ai_v2_ocr_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."pdr_ai_v2_ocr_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_upload_batches" ADD CONSTRAINT "pdr_ai_v2_upload_batches_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_company_embedding_credentials" ADD CONSTRAINT "pdr_ai_v2_company_embedding_credentials_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_context_chunks" ADD CONSTRAINT "pdr_ai_v2_document_context_chunks_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_context_chunks" ADD CONSTRAINT "pdr_ai_v2_document_context_chunks_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_context_chunks" ADD CONSTRAINT "pdr_ai_v2_document_context_chunks_structure_id_pdr_ai_v2_document_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."pdr_ai_v2_document_structure"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_embeddings_1024" ADD CONSTRAINT "pdr_ai_v2_document_embeddings_1024_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_embeddings_1024" ADD CONSTRAINT "pdr_ai_v2_document_embeddings_1024_retrieval_chunk_id_pdr_ai_v2_document_retrieval_chunks_id_fk" FOREIGN KEY ("retrieval_chunk_id") REFERENCES "public"."pdr_ai_v2_document_retrieval_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_embeddings_768" ADD CONSTRAINT "pdr_ai_v2_document_embeddings_768_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_embeddings_768" ADD CONSTRAINT "pdr_ai_v2_document_embeddings_768_retrieval_chunk_id_pdr_ai_v2_document_retrieval_chunks_id_fk" FOREIGN KEY ("retrieval_chunk_id") REFERENCES "public"."pdr_ai_v2_document_retrieval_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_metadata" ADD CONSTRAINT "pdr_ai_v2_document_metadata_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_metadata" ADD CONSTRAINT "pdr_ai_v2_document_metadata_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_previews" ADD CONSTRAINT "pdr_ai_v2_document_previews_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_previews" ADD CONSTRAINT "pdr_ai_v2_document_previews_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_previews" ADD CONSTRAINT "pdr_ai_v2_document_previews_section_id_pdr_ai_v2_document_context_chunks_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."pdr_ai_v2_document_context_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_previews" ADD CONSTRAINT "pdr_ai_v2_document_previews_structure_id_pdr_ai_v2_document_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."pdr_ai_v2_document_structure"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_retrieval_chunks" ADD CONSTRAINT "pdr_ai_v2_document_retrieval_chunks_context_chunk_id_pdr_ai_v2_document_context_chunks_id_fk" FOREIGN KEY ("context_chunk_id") REFERENCES "public"."pdr_ai_v2_document_context_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_retrieval_chunks" ADD CONSTRAINT "pdr_ai_v2_document_retrieval_chunks_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_retrieval_chunks" ADD CONSTRAINT "pdr_ai_v2_document_retrieval_chunks_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_structure" ADD CONSTRAINT "pdr_ai_v2_document_structure_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_structure" ADD CONSTRAINT "pdr_ai_v2_document_structure_version_id_pdr_ai_v2_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pdr_ai_v2_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_embeddings_exp" ADD CONSTRAINT "pdr_ai_v2_document_embeddings_exp_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_document_embeddings_exp" ADD CONSTRAINT "pdr_ai_v2_document_embeddings_exp_retrieval_chunk_id_pdr_ai_v2_document_retrieval_chunks_id_fk" FOREIGN KEY ("retrieval_chunk_id") REFERENCES "public"."pdr_ai_v2_document_retrieval_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_results" ADD CONSTRAINT "pdr_ai_v2_workspace_results_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_results" ADD CONSTRAINT "pdr_ai_v2_workspace_results_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_results" ADD CONSTRAINT "pdr_ai_v2_workspace_results_section_id_pdr_ai_v2_document_context_chunks_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."pdr_ai_v2_document_context_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_results" ADD CONSTRAINT "pdr_ai_v2_workspace_results_structure_id_pdr_ai_v2_document_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."pdr_ai_v2_document_structure"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_kg_entity_mentions" ADD CONSTRAINT "pdr_ai_v2_kg_entity_mentions_entity_id_pdr_ai_v2_kg_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."pdr_ai_v2_kg_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_kg_entity_mentions" ADD CONSTRAINT "pdr_ai_v2_kg_entity_mentions_section_id_pdr_ai_v2_document_context_chunks_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."pdr_ai_v2_document_context_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_kg_entity_mentions" ADD CONSTRAINT "pdr_ai_v2_kg_entity_mentions_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_kg_relationships" ADD CONSTRAINT "pdr_ai_v2_kg_relationships_source_entity_id_pdr_ai_v2_kg_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."pdr_ai_v2_kg_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_kg_relationships" ADD CONSTRAINT "pdr_ai_v2_kg_relationships_target_entity_id_pdr_ai_v2_kg_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."pdr_ai_v2_kg_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_kg_relationships" ADD CONSTRAINT "pdr_ai_v2_kg_relationships_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_company_id_idx" ON "pdr_ai_v2_category" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "document_company_id_idx" ON "pdr_ai_v2_document" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "document_company_id_id_idx" ON "pdr_ai_v2_document" USING btree ("company_id","id");--> statement-breakpoint
CREATE INDEX "document_company_id_category_idx" ON "pdr_ai_v2_document" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX "document_current_version_id_idx" ON "pdr_ai_v2_document" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "doc_versions_document_id_idx" ON "pdr_ai_v2_document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_versions_document_version_unique" ON "pdr_ai_v2_document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "file_uploads_user_id_idx" ON "pdr_ai_v2_file_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ocr_cost_tracking_company_provider_month_idx" ON "pdr_ai_v2_ocr_cost_tracking" USING btree ("company_id","provider","month");--> statement-breakpoint
CREATE INDEX "ocr_jobs_company_id_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ocr_jobs_user_id_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ocr_jobs_status_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ocr_jobs_created_at_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ocr_jobs_company_status_idx" ON "pdr_ai_v2_ocr_jobs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "ocr_processing_steps_job_id_idx" ON "pdr_ai_v2_ocr_processing_steps" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ocr_processing_steps_job_id_step_idx" ON "pdr_ai_v2_ocr_processing_steps" USING btree ("job_id","step_number");--> statement-breakpoint
CREATE INDEX "pdf_chunks_document_id_idx" ON "pdr_ai_v2_pdf_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "pdf_chunks_document_id_page_idx" ON "pdr_ai_v2_pdf_chunks" USING btree ("document_id","page");--> statement-breakpoint
CREATE INDEX "pdf_chunks_document_id_page_chunk_idx" ON "pdr_ai_v2_pdf_chunks" USING btree ("document_id","page","chunk_index");--> statement-breakpoint
CREATE INDEX "upload_batch_files_batch_idx" ON "pdr_ai_v2_upload_batch_files" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "upload_batch_files_status_idx" ON "pdr_ai_v2_upload_batch_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "upload_batch_files_job_idx" ON "pdr_ai_v2_upload_batch_files" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "upload_batch_files_document_idx" ON "pdr_ai_v2_upload_batch_files" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "upload_batches_company_idx" ON "pdr_ai_v2_upload_batches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "upload_batches_creator_idx" ON "pdr_ai_v2_upload_batches" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "upload_batches_status_idx" ON "pdr_ai_v2_upload_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "doc_ctx_chunks_document_id_idx" ON "pdr_ai_v2_document_context_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_ctx_chunks_structure_id_idx" ON "pdr_ai_v2_document_context_chunks" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "doc_ctx_chunks_document_page_idx" ON "pdr_ai_v2_document_context_chunks" USING btree ("document_id","page_number");--> statement-breakpoint
CREATE INDEX "doc_ctx_chunks_content_hash_idx" ON "pdr_ai_v2_document_context_chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "doc_ctx_chunks_semantic_type_idx" ON "pdr_ai_v2_document_context_chunks" USING btree ("document_id","semantic_type");--> statement-breakpoint
CREATE INDEX "doc_ctx_chunks_version_id_idx" ON "pdr_ai_v2_document_context_chunks" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "document_embeddings_1024_doc_idx" ON "pdr_ai_v2_document_embeddings_1024" USING btree ("document_id","index_key");--> statement-breakpoint
CREATE INDEX "document_embeddings_1024_chunk_idx" ON "pdr_ai_v2_document_embeddings_1024" USING btree ("retrieval_chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_embeddings_1024_chunk_unique" ON "pdr_ai_v2_document_embeddings_1024" USING btree ("retrieval_chunk_id","index_key");--> statement-breakpoint
CREATE INDEX "document_embeddings_1024_embedding_hnsw_idx" ON "pdr_ai_v2_document_embeddings_1024" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "document_embeddings_768_doc_idx" ON "pdr_ai_v2_document_embeddings_768" USING btree ("document_id","index_key");--> statement-breakpoint
CREATE INDEX "document_embeddings_768_chunk_idx" ON "pdr_ai_v2_document_embeddings_768" USING btree ("retrieval_chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_embeddings_768_chunk_unique" ON "pdr_ai_v2_document_embeddings_768" USING btree ("retrieval_chunk_id","index_key");--> statement-breakpoint
CREATE INDEX "document_embeddings_768_embedding_hnsw_idx" ON "pdr_ai_v2_document_embeddings_768" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE UNIQUE INDEX "doc_metadata_document_version_unique" ON "pdr_ai_v2_document_metadata" USING btree ("document_id","version_id");--> statement-breakpoint
CREATE INDEX "doc_metadata_complexity_idx" ON "pdr_ai_v2_document_metadata" USING btree ("complexity_score");--> statement-breakpoint
CREATE INDEX "doc_metadata_class_idx" ON "pdr_ai_v2_document_metadata" USING btree ("document_class");--> statement-breakpoint
CREATE INDEX "doc_metadata_total_tokens_idx" ON "pdr_ai_v2_document_metadata" USING btree ("total_tokens");--> statement-breakpoint
CREATE INDEX "doc_metadata_version_id_idx" ON "pdr_ai_v2_document_metadata" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "doc_previews_document_id_idx" ON "pdr_ai_v2_document_previews" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_previews_section_id_idx" ON "pdr_ai_v2_document_previews" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "doc_previews_document_type_idx" ON "pdr_ai_v2_document_previews" USING btree ("document_id","preview_type");--> statement-breakpoint
CREATE INDEX "doc_previews_version_id_idx" ON "pdr_ai_v2_document_previews" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "doc_ret_chunks_context_chunk_id_idx" ON "pdr_ai_v2_document_retrieval_chunks" USING btree ("context_chunk_id");--> statement-breakpoint
CREATE INDEX "doc_ret_chunks_document_id_idx" ON "pdr_ai_v2_document_retrieval_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_ret_chunks_embedding_short_idx" ON "pdr_ai_v2_document_retrieval_chunks" USING hnsw ("embedding_short" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "doc_ret_chunks_version_id_idx" ON "pdr_ai_v2_document_retrieval_chunks" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "doc_structure_document_id_idx" ON "pdr_ai_v2_document_structure" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_structure_parent_id_idx" ON "pdr_ai_v2_document_structure" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "doc_structure_document_level_idx" ON "pdr_ai_v2_document_structure" USING btree ("document_id","level");--> statement-breakpoint
CREATE INDEX "doc_structure_document_path_idx" ON "pdr_ai_v2_document_structure" USING btree ("document_id","path");--> statement-breakpoint
CREATE INDEX "doc_structure_document_ordering_idx" ON "pdr_ai_v2_document_structure" USING btree ("document_id","parent_id","ordering");--> statement-breakpoint
CREATE INDEX "doc_structure_version_id_idx" ON "pdr_ai_v2_document_structure" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "document_embeddings_exp_doc_idx" ON "pdr_ai_v2_document_embeddings_exp" USING btree ("document_id","provider","model","version");--> statement-breakpoint
CREATE INDEX "document_embeddings_exp_chunk_idx" ON "pdr_ai_v2_document_embeddings_exp" USING btree ("retrieval_chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_embeddings_exp_chunk_unique" ON "pdr_ai_v2_document_embeddings_exp" USING btree ("retrieval_chunk_id","provider","model","version");--> statement-breakpoint
CREATE INDEX "workspace_session_id_idx" ON "pdr_ai_v2_workspace_results" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workspace_user_id_idx" ON "pdr_ai_v2_workspace_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_company_id_idx" ON "pdr_ai_v2_workspace_results" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "workspace_document_id_idx" ON "pdr_ai_v2_workspace_results" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "workspace_session_type_idx" ON "pdr_ai_v2_workspace_results" USING btree ("session_id","result_type");--> statement-breakpoint
CREATE INDEX "workspace_status_idx" ON "pdr_ai_v2_workspace_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workspace_expires_at_idx" ON "pdr_ai_v2_workspace_results" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workspace_parent_result_idx" ON "pdr_ai_v2_workspace_results" USING btree ("parent_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kg_entities_name_company_idx" ON "pdr_ai_v2_kg_entities" USING btree ("name","label","company_id");--> statement-breakpoint
CREATE INDEX "kg_entities_label_idx" ON "pdr_ai_v2_kg_entities" USING btree ("label");--> statement-breakpoint
CREATE INDEX "kg_entities_company_idx" ON "pdr_ai_v2_kg_entities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "kg_entities_name_idx" ON "pdr_ai_v2_kg_entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "kg_mentions_entity_idx" ON "pdr_ai_v2_kg_entity_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "kg_mentions_section_idx" ON "pdr_ai_v2_kg_entity_mentions" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "kg_mentions_document_idx" ON "pdr_ai_v2_kg_entity_mentions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kg_mentions_entity_section_unique" ON "pdr_ai_v2_kg_entity_mentions" USING btree ("entity_id","section_id");--> statement-breakpoint
CREATE INDEX "kg_rel_source_idx" ON "pdr_ai_v2_kg_relationships" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "kg_rel_target_idx" ON "pdr_ai_v2_kg_relationships" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "kg_rel_type_idx" ON "pdr_ai_v2_kg_relationships" USING btree ("relationship_type");--> statement-breakpoint
CREATE INDEX "kg_rel_company_idx" ON "pdr_ai_v2_kg_relationships" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kg_rel_source_target_type_unique" ON "pdr_ai_v2_kg_relationships" USING btree ("source_entity_id","target_entity_id","relationship_type");