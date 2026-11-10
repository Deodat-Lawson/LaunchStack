CREATE TABLE "pdr_ai_v2_accelerator_program_intelligence" (
	"program_id" varchar(64) PRIMARY KEY NOT NULL,
	"dossier" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_program_intelligence" ADD CONSTRAINT "pdr_ai_v2_accelerator_program_intelligence_program_id_pdr_ai_v2_accelerator_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_accelerator_programs"("id") ON DELETE cascade ON UPDATE no action;