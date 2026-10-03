CREATE TABLE "pdr_ai_v2_vantage_agenda_topics" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"agenda_id" varchar(64) NOT NULL,
	"company_id" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" varchar(12) DEFAULT 'suggested' NOT NULL,
	"origin" varchar(12) NOT NULL,
	"title" varchar(300) NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why_it_matters" text DEFAULT '' NOT NULL,
	"decision_question" text DEFAULT '' NOT NULL,
	"proposed_next_step" text DEFAULT '' NOT NULL,
	"proposed_owner" varchar(200),
	"proposed_due" date,
	"help_requested" text,
	"unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text,
	"shared" boolean DEFAULT false NOT NULL,
	"decision" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_agendas" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"week_start" date NOT NULL,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"summary" text,
	"signals" jsonb,
	"model_metadata" jsonb,
	"generated_at" timestamp with time zone,
	"held_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_commitments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"agenda_id" varchar(64),
	"topic_id" varchar(64),
	"title" varchar(300) NOT NULL,
	"owner" varchar(200) NOT NULL,
	"due_on" date NOT NULL,
	"test" text,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"outcome" text,
	"shared" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_evidence" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"title" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"source" varchar(300),
	"source_url" varchar(1000),
	"observed_at" date NOT NULL,
	"visibility" varchar(10) DEFAULT 'private' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_metric_definitions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"definition" text NOT NULL,
	"unit" varchar(32) DEFAULT 'count' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_metric_observations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"metric_id" varchar(64) NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"value" double precision NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"source" varchar(300),
	"note" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_vantage_program_deadlines" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"title" varchar(300) NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_agenda_topics" ADD CONSTRAINT "pdr_ai_v2_vantage_agenda_topics_agenda_id_pdr_ai_v2_vantage_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."pdr_ai_v2_vantage_agendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_agenda_topics" ADD CONSTRAINT "pdr_ai_v2_vantage_agenda_topics_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_agendas" ADD CONSTRAINT "pdr_ai_v2_vantage_agendas_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_commitments" ADD CONSTRAINT "pdr_ai_v2_vantage_commitments_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_commitments" ADD CONSTRAINT "pdr_ai_v2_vantage_commitments_agenda_id_pdr_ai_v2_vantage_agendas_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."pdr_ai_v2_vantage_agendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_commitments" ADD CONSTRAINT "pdr_ai_v2_vantage_commitments_topic_id_pdr_ai_v2_vantage_agenda_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."pdr_ai_v2_vantage_agenda_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_evidence" ADD CONSTRAINT "pdr_ai_v2_vantage_evidence_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_metric_definitions" ADD CONSTRAINT "pdr_ai_v2_vantage_metric_definitions_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_metric_observations" ADD CONSTRAINT "pdr_ai_v2_vantage_metric_observations_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_metric_observations" ADD CONSTRAINT "pdr_ai_v2_vantage_metric_observations_metric_id_pdr_ai_v2_vantage_metric_definitions_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."pdr_ai_v2_vantage_metric_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_vantage_program_deadlines" ADD CONSTRAINT "pdr_ai_v2_vantage_program_deadlines_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vantage_agenda_topics_agenda_position_idx" ON "pdr_ai_v2_vantage_agenda_topics" USING btree ("agenda_id","position");--> statement-breakpoint
CREATE INDEX "vantage_agenda_topics_company_shared_idx" ON "pdr_ai_v2_vantage_agenda_topics" USING btree ("company_id","shared");--> statement-breakpoint
CREATE UNIQUE INDEX "vantage_agendas_company_week_unique" ON "pdr_ai_v2_vantage_agendas" USING btree ("company_id","week_start");--> statement-breakpoint
CREATE INDEX "vantage_agendas_company_created_idx" ON "pdr_ai_v2_vantage_agendas" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "vantage_commitments_company_status_due_idx" ON "pdr_ai_v2_vantage_commitments" USING btree ("company_id","status","due_on");--> statement-breakpoint
CREATE INDEX "vantage_commitments_agenda_idx" ON "pdr_ai_v2_vantage_commitments" USING btree ("agenda_id");--> statement-breakpoint
CREATE INDEX "vantage_evidence_company_observed_idx" ON "pdr_ai_v2_vantage_evidence" USING btree ("company_id","observed_at");--> statement-breakpoint
CREATE INDEX "vantage_evidence_company_kind_idx" ON "pdr_ai_v2_vantage_evidence" USING btree ("company_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "vantage_metric_definitions_company_key_unique" ON "pdr_ai_v2_vantage_metric_definitions" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "vantage_metric_observations_company_metric_period_idx" ON "pdr_ai_v2_vantage_metric_observations" USING btree ("company_id","metric_id","period_end");--> statement-breakpoint
CREATE INDEX "vantage_program_deadlines_company_due_idx" ON "pdr_ai_v2_vantage_program_deadlines" USING btree ("company_id","due_on");