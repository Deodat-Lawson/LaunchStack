CREATE TABLE "pdr_ai_v2_distribution_agreements" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"relationship_id" varchar(256) NOT NULL,
	"territory" jsonb,
	"exclusivity" varchar(16) DEFAULT 'none' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_id" bigint,
	"renewal_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_distribution_programs" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"name" varchar(256) NOT NULL,
	"offering" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hs_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_territories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"partner_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" text,
	"known_partner_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_distribution_runs" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"program_id" varchar(256) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"options" jsonb NOT NULL,
	"plan" jsonb,
	"summary" jsonb,
	"candidate_org_ids" jsonb,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_market_edges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"from_org_id" varchar(256) NOT NULL,
	"to_org_id" varchar(256),
	"to_brand" varchar(256),
	"kind" varchar(32) NOT NULL,
	"evidence_id" bigint,
	"run_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_partner_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"org_id" varchar(256) NOT NULL,
	"run_id" varchar(256),
	"kind" varchar(32) NOT NULL,
	"claim" text NOT NULL,
	"source_url" text NOT NULL,
	"quote" text,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"provenance" jsonb
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_partner_orgs" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"resolve_key" varchar(512) NOT NULL,
	"name" varchar(512) NOT NULL,
	"domain" varchar(256),
	"country" varchar(2),
	"region" varchar(128),
	"city" varchar(128),
	"lat" double precision,
	"lng" double precision,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"size_band" varchar(32),
	"description" text,
	"kg_entity_id" bigint,
	"first_seen_run_id" varchar(256),
	"last_enriched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_partner_relationships" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"program_id" varchar(256) NOT NULL,
	"org_id" varchar(256) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"territory" jsonb,
	"stage" varchar(32) DEFAULT 'candidate' NOT NULL,
	"fit_score" integer,
	"fit_rationale" text,
	"fit_breakdown" jsonb,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"screening" jsonb,
	"dossier" jsonb,
	"owner_user_id" varchar(256),
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"dossier_document_id" bigint,
	"source" varchar(16) DEFAULT 'discovery' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_relationship_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"relationship_id" varchar(256) NOT NULL,
	"type" varchar(32) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" varchar(256),
	"ref" varchar(256),
	"occurred_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_agreements" ADD CONSTRAINT "pdr_ai_v2_distribution_agreements_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_agreements" ADD CONSTRAINT "pdr_ai_v2_distribution_agreements_relationship_id_pdr_ai_v2_partner_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."pdr_ai_v2_partner_relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_programs" ADD CONSTRAINT "pdr_ai_v2_distribution_programs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_runs" ADD CONSTRAINT "pdr_ai_v2_distribution_runs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_distribution_runs" ADD CONSTRAINT "pdr_ai_v2_distribution_runs_program_id_pdr_ai_v2_distribution_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_distribution_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_market_edges" ADD CONSTRAINT "pdr_ai_v2_market_edges_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_market_edges" ADD CONSTRAINT "pdr_ai_v2_market_edges_from_org_id_pdr_ai_v2_partner_orgs_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."pdr_ai_v2_partner_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_market_edges" ADD CONSTRAINT "pdr_ai_v2_market_edges_to_org_id_pdr_ai_v2_partner_orgs_id_fk" FOREIGN KEY ("to_org_id") REFERENCES "public"."pdr_ai_v2_partner_orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_market_edges" ADD CONSTRAINT "pdr_ai_v2_market_edges_evidence_id_pdr_ai_v2_partner_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."pdr_ai_v2_partner_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_evidence" ADD CONSTRAINT "pdr_ai_v2_partner_evidence_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_evidence" ADD CONSTRAINT "pdr_ai_v2_partner_evidence_org_id_pdr_ai_v2_partner_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."pdr_ai_v2_partner_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_evidence" ADD CONSTRAINT "pdr_ai_v2_partner_evidence_run_id_pdr_ai_v2_distribution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_distribution_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_orgs" ADD CONSTRAINT "pdr_ai_v2_partner_orgs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_relationships" ADD CONSTRAINT "pdr_ai_v2_partner_relationships_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_relationships" ADD CONSTRAINT "pdr_ai_v2_partner_relationships_program_id_pdr_ai_v2_distribution_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdr_ai_v2_distribution_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_relationships" ADD CONSTRAINT "pdr_ai_v2_partner_relationships_org_id_pdr_ai_v2_partner_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."pdr_ai_v2_partner_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_relationship_events" ADD CONSTRAINT "pdr_ai_v2_relationship_events_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_relationship_events" ADD CONSTRAINT "pdr_ai_v2_relationship_events_relationship_id_pdr_ai_v2_partner_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."pdr_ai_v2_partner_relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "distribution_agreements_relationship_idx" ON "pdr_ai_v2_distribution_agreements" USING btree ("relationship_id");--> statement-breakpoint
CREATE INDEX "distribution_agreements_company_idx" ON "pdr_ai_v2_distribution_agreements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "distribution_programs_company_idx" ON "pdr_ai_v2_distribution_programs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "distribution_runs_company_idx" ON "pdr_ai_v2_distribution_runs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "distribution_runs_program_idx" ON "pdr_ai_v2_distribution_runs" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "distribution_runs_company_status_idx" ON "pdr_ai_v2_distribution_runs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "market_edges_company_idx" ON "pdr_ai_v2_market_edges" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "market_edges_from_idx" ON "pdr_ai_v2_market_edges" USING btree ("from_org_id");--> statement-breakpoint
CREATE INDEX "market_edges_brand_idx" ON "pdr_ai_v2_market_edges" USING btree ("company_id","to_brand");--> statement-breakpoint
CREATE INDEX "partner_evidence_org_idx" ON "pdr_ai_v2_partner_evidence" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "partner_evidence_company_idx" ON "pdr_ai_v2_partner_evidence" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "partner_evidence_run_idx" ON "pdr_ai_v2_partner_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_orgs_company_resolve_key_unique" ON "pdr_ai_v2_partner_orgs" USING btree ("company_id","resolve_key");--> statement-breakpoint
CREATE INDEX "partner_orgs_company_idx" ON "pdr_ai_v2_partner_orgs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "partner_orgs_domain_idx" ON "pdr_ai_v2_partner_orgs" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_relationships_program_org_kind_unique" ON "pdr_ai_v2_partner_relationships" USING btree ("company_id","program_id","org_id","kind");--> statement-breakpoint
CREATE INDEX "partner_relationships_company_idx" ON "pdr_ai_v2_partner_relationships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "partner_relationships_program_idx" ON "pdr_ai_v2_partner_relationships" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "partner_relationships_stage_idx" ON "pdr_ai_v2_partner_relationships" USING btree ("company_id","stage");--> statement-breakpoint
CREATE INDEX "relationship_events_relationship_idx" ON "pdr_ai_v2_relationship_events" USING btree ("relationship_id");--> statement-breakpoint
CREATE INDEX "relationship_events_company_idx" ON "pdr_ai_v2_relationship_events" USING btree ("company_id");