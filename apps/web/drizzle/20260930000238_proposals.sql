CREATE TABLE "pdr_ai_v2_proposal_applications" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"opportunity_id" varchar(64),
	"title" varchar(512) NOT NULL,
	"funder" varchar(256),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"deadline" date,
	"owner_user_id" varchar(256),
	"request_text" text,
	"request_url" text,
	"request_document_id" bigint,
	"extracted" jsonb,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review" jsonb,
	"readiness" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"exported_document_id" bigint,
	"submitted_at" timestamp with time zone,
	"created_by_user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_proposal_library_items" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_application_id" varchar(64),
	"source_section_key" varchar(64),
	"uses" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_proposal_opportunities" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"source" varchar(16) NOT NULL,
	"external_id" varchar(1024) NOT NULL,
	"title" varchar(512) NOT NULL,
	"funder" varchar(256) NOT NULL,
	"url" text,
	"summary" text,
	"opens_on" date,
	"closes_on" date,
	"status" varchar(16) DEFAULT 'candidate' NOT NULL,
	"amount_min" bigint,
	"amount_max" bigint,
	"eligibility" text,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fit" jsonb,
	"run_id" varchar(64),
	"created_by_user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_proposal_profiles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'empty' NOT NULL,
	"profile" jsonb,
	"error" text,
	"built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_proposal_runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"application_id" varchar(64),
	"user_id" varchar(256) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"error" text,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_proposal_sections" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"application_id" varchar(64) NOT NULL,
	"position" integer NOT NULL,
	"key" varchar(64) NOT NULL,
	"question" text NOT NULL,
	"guidance" text,
	"word_limit" integer,
	"required" boolean DEFAULT true NOT NULL,
	"status" varchar(16) DEFAULT 'empty' NOT NULL,
	"draft" text,
	"draft_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD CONSTRAINT "pdr_ai_v2_proposal_applications_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_applications" ADD CONSTRAINT "pdr_ai_v2_proposal_applications_opportunity_id_pdr_ai_v2_proposal_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."pdr_ai_v2_proposal_opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_library_items" ADD CONSTRAINT "pdr_ai_v2_proposal_library_items_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_library_items" ADD CONSTRAINT "pdr_ai_v2_proposal_library_items_source_application_id_pdr_ai_v2_proposal_applications_id_fk" FOREIGN KEY ("source_application_id") REFERENCES "public"."pdr_ai_v2_proposal_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_opportunities" ADD CONSTRAINT "pdr_ai_v2_proposal_opportunities_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_profiles" ADD CONSTRAINT "pdr_ai_v2_proposal_profiles_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_runs" ADD CONSTRAINT "pdr_ai_v2_proposal_runs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_runs" ADD CONSTRAINT "pdr_ai_v2_proposal_runs_application_id_pdr_ai_v2_proposal_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."pdr_ai_v2_proposal_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_sections" ADD CONSTRAINT "pdr_ai_v2_proposal_sections_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_proposal_sections" ADD CONSTRAINT "pdr_ai_v2_proposal_sections_application_id_pdr_ai_v2_proposal_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."pdr_ai_v2_proposal_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_applications_company_status_idx" ON "pdr_ai_v2_proposal_applications" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "proposal_applications_company_deadline_idx" ON "pdr_ai_v2_proposal_applications" USING btree ("company_id","deadline");--> statement-breakpoint
CREATE INDEX "proposal_library_items_company_idx" ON "pdr_ai_v2_proposal_library_items" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_opportunities_company_source_external_unique" ON "pdr_ai_v2_proposal_opportunities" USING btree ("company_id","source","external_id");--> statement-breakpoint
CREATE INDEX "proposal_opportunities_company_status_idx" ON "pdr_ai_v2_proposal_opportunities" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "proposal_opportunities_company_closes_idx" ON "pdr_ai_v2_proposal_opportunities" USING btree ("company_id","closes_on");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_profiles_company_unique" ON "pdr_ai_v2_proposal_profiles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "proposal_runs_company_created_idx" ON "pdr_ai_v2_proposal_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "proposal_runs_company_status_idx" ON "pdr_ai_v2_proposal_runs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "proposal_runs_application_idx" ON "pdr_ai_v2_proposal_runs" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "proposal_sections_application_position_idx" ON "pdr_ai_v2_proposal_sections" USING btree ("application_id","position");--> statement-breakpoint
CREATE INDEX "proposal_sections_company_idx" ON "pdr_ai_v2_proposal_sections" USING btree ("company_id");