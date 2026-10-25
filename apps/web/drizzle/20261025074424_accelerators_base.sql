CREATE TABLE "pdr_ai_v2_accelerator_company_matches" (
	"company_id" bigint NOT NULL,
	"program_id" varchar(64) NOT NULL,
	"assessment" jsonb NOT NULL,
	"profile_hash" text NOT NULL,
	"program_hash" varchar(64) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_accelerator_programs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"program" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD COLUMN "kind" varchar(16) DEFAULT 'grant' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD COLUMN "program_id" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD COLUMN "cycle_id" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD COLUMN "form_hash" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_sections" ADD COLUMN "form_field" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_sections" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_company_matches" ADD CONSTRAINT "pdr_ai_v2_accelerator_company_matches_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_accelerator_company_matches" ADD CONSTRAINT "pdr_ai_v2_accelerator_company_matches_program_id_pdr_ai_v2_accelerator_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_accelerator_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accelerator_matches_company_program_unique" ON "pdr_ai_v2_accelerator_company_matches" USING btree ("company_id","program_id");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD CONSTRAINT "pdr_ai_v2_proposal_applications_program_id_pdr_ai_v2_accelerator_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_accelerator_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_applications_accelerator_company_cycle_unique" ON "pdr_ai_v2_proposal_applications" USING btree ("company_id","program_id","cycle_id") WHERE "pdr_ai_v2_proposal_applications"."kind" = 'accelerator';--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD CONSTRAINT "proposal_applications_kind_check" CHECK ("pdr_ai_v2_proposal_applications"."kind" in ('grant', 'accelerator'));--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD CONSTRAINT "proposal_applications_program_check" CHECK ((
            ("pdr_ai_v2_proposal_applications"."kind" = 'grant' and "pdr_ai_v2_proposal_applications"."program_id" is null and "pdr_ai_v2_proposal_applications"."cycle_id" is null and "pdr_ai_v2_proposal_applications"."form_hash" is null)
            or ("pdr_ai_v2_proposal_applications"."kind" = 'accelerator' and "pdr_ai_v2_proposal_applications"."program_id" is not null and "pdr_ai_v2_proposal_applications"."cycle_id" is not null and "pdr_ai_v2_proposal_applications"."form_hash" is not null)
        ));--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_sections" ADD CONSTRAINT "proposal_sections_revision_check" CHECK ("pdr_ai_v2_proposal_sections"."revision" >= 0);