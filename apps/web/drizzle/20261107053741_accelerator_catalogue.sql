CREATE TABLE "pdr_ai_v2_accelerator_programs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"program" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
