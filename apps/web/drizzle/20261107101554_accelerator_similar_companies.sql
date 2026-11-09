CREATE TABLE "pdr_ai_v2_accelerator_application_responses" (
	"id" varchar(160) PRIMARY KEY NOT NULL,
	"program_id" varchar(64) NOT NULL,
	"company_id" varchar(160),
	"response" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"collected_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_accelerator_portfolio_companies" (
	"id" varchar(160) PRIMARY KEY NOT NULL,
	"program_id" varchar(64) NOT NULL,
	"company" jsonb NOT NULL,
	"batch_starts_on" date NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"embedding" vector(1536),
	"embedding_hash" varchar(64),
	"collected_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_application_responses" ADD CONSTRAINT "pdr_ai_v2_accelerator_application_responses_program_id_pdr_ai_v2_accelerator_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_accelerator_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_application_responses" ADD CONSTRAINT "pdr_ai_v2_accelerator_application_responses_company_id_pdr_ai_v2_accelerator_portfolio_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_accelerator_portfolio_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_portfolio_companies" ADD CONSTRAINT "pdr_ai_v2_accelerator_portfolio_companies_program_id_pdr_ai_v2_accelerator_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_accelerator_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accelerator_applications_company_idx" ON "pdr_ai_v2_accelerator_application_responses" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "accelerator_portfolio_program_idx" ON "pdr_ai_v2_accelerator_portfolio_companies" USING btree ("program_id","batch_starts_on");