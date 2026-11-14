CREATE TABLE "pdr_ai_v2_scenario_actor_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"slot_id" varchar(16) NOT NULL,
	"context" jsonb NOT NULL,
	"context_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_call_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"call_id" integer NOT NULL,
	"attempt" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"provider_request_id" varchar(128),
	"model" varchar(128),
	"raw_text" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"unit_key" varchar(64) NOT NULL,
	"logical_key" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"purpose" varchar(24) NOT NULL,
	"actor_id" varchar(32),
	"round" integer,
	"accepted_attempt_id" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_checkpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"round" integer NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"engine_version" varchar(64) NOT NULL,
	"turns" jsonb NOT NULL,
	"interventions" jsonb NOT NULL,
	"skipped" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_credit_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"unit_key" varchar(64) NOT NULL,
	"settlement_key" varchar(160) NOT NULL,
	"reserved" integer NOT NULL,
	"settled" integer,
	"status" varchar(16) DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_dispatches" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_graph_builds" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"build_key" varchar(64) NOT NULL,
	"group_id" varchar(128) NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"ontology_hash" varchar(64) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"state" varchar(16) NOT NULL,
	"owner_run_id" integer,
	"owner_epoch" integer DEFAULT 1 NOT NULL,
	"snapshot_id" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"frozen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_graph_ingestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"build_id" integer NOT NULL,
	"unit_key" varchar(64) NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"episode_uuids" jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_graph_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"build_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"graph_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_ontology_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"request_spec_id" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"source_manifest_hash" varchar(64) NOT NULL,
	"planner_prompt_version" varchar(64) NOT NULL,
	"planner_model" varchar(128) NOT NULL,
	"validation" jsonb NOT NULL,
	"ontology_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_request_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"idempotency_key" varchar(200),
	"payload_hash" varchar(64) NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_source_manifests" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"document_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"unit_key" varchar(64) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"seq" integer NOT NULL,
	"depends_on" jsonb NOT NULL,
	"input" jsonb NOT NULL,
	"input_hash" varchar(64),
	"max_credits" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"usage" jsonb,
	"credits" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_scenario_world_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"run_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"initial_world" jsonb NOT NULL,
	"spec_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "contract_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "request_spec_id" integer;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "world_spec_id" integer;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "lease_owner" varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "lease_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "context_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_runs" ADD COLUMN "flags" jsonb;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_actor_contexts" ADD CONSTRAINT "pdr_ai_v2_scenario_actor_contexts_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_actor_contexts" ADD CONSTRAINT "pdr_ai_v2_scenario_actor_contexts_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_call_attempts" ADD CONSTRAINT "pdr_ai_v2_scenario_call_attempts_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_call_attempts" ADD CONSTRAINT "pdr_ai_v2_scenario_call_attempts_call_id_pdr_ai_v2_scenario_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."pdr_ai_v2_scenario_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_calls" ADD CONSTRAINT "pdr_ai_v2_scenario_calls_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_calls" ADD CONSTRAINT "pdr_ai_v2_scenario_calls_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_checkpoints" ADD CONSTRAINT "pdr_ai_v2_scenario_checkpoints_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_checkpoints" ADD CONSTRAINT "pdr_ai_v2_scenario_checkpoints_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_credit_reservations" ADD CONSTRAINT "pdr_ai_v2_scenario_credit_reservations_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_credit_reservations" ADD CONSTRAINT "pdr_ai_v2_scenario_credit_reservations_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_dispatches" ADD CONSTRAINT "pdr_ai_v2_scenario_dispatches_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_dispatches" ADD CONSTRAINT "pdr_ai_v2_scenario_dispatches_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_graph_builds" ADD CONSTRAINT "pdr_ai_v2_scenario_graph_builds_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_graph_ingestions" ADD CONSTRAINT "pdr_ai_v2_scenario_graph_ingestions_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_graph_ingestions" ADD CONSTRAINT "pdr_ai_v2_scenario_graph_ingestions_build_id_pdr_ai_v2_scenario_graph_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."pdr_ai_v2_scenario_graph_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_graph_snapshots" ADD CONSTRAINT "pdr_ai_v2_scenario_graph_snapshots_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_graph_snapshots" ADD CONSTRAINT "pdr_ai_v2_scenario_graph_snapshots_build_id_pdr_ai_v2_scenario_graph_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."pdr_ai_v2_scenario_graph_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_ontology_specs" ADD CONSTRAINT "pdr_ai_v2_scenario_ontology_specs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_ontology_specs" ADD CONSTRAINT "pdr_ai_v2_scenario_ontology_specs_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_ontology_specs" ADD CONSTRAINT "pdr_ai_v2_scenario_ontology_specs_request_spec_id_pdr_ai_v2_scenario_request_specs_id_fk" FOREIGN KEY ("request_spec_id") REFERENCES "public"."pdr_ai_v2_scenario_request_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_request_specs" ADD CONSTRAINT "pdr_ai_v2_scenario_request_specs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_source_manifests" ADD CONSTRAINT "pdr_ai_v2_scenario_source_manifests_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_source_manifests" ADD CONSTRAINT "pdr_ai_v2_scenario_source_manifests_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_units" ADD CONSTRAINT "pdr_ai_v2_scenario_units_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_units" ADD CONSTRAINT "pdr_ai_v2_scenario_units_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_world_specs" ADD CONSTRAINT "pdr_ai_v2_scenario_world_specs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_scenario_world_specs" ADD CONSTRAINT "pdr_ai_v2_scenario_world_specs_run_id_pdr_ai_v2_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pdr_ai_v2_scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_actor_contexts_run_slot_unique" ON "pdr_ai_v2_scenario_actor_contexts" USING btree ("run_id","generation","slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_call_attempts_call_attempt_unique" ON "pdr_ai_v2_scenario_call_attempts" USING btree ("call_id","attempt");--> statement-breakpoint
CREATE INDEX "scenario_call_attempts_started_idx" ON "pdr_ai_v2_scenario_call_attempts" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_calls_logical_unique" ON "pdr_ai_v2_scenario_calls" USING btree ("logical_key");--> statement-breakpoint
CREATE INDEX "scenario_calls_run_unit_idx" ON "pdr_ai_v2_scenario_calls" USING btree ("run_id","generation","unit_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_checkpoints_run_round_unique" ON "pdr_ai_v2_scenario_checkpoints" USING btree ("run_id","generation","round");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_credit_reservations_key_unique" ON "pdr_ai_v2_scenario_credit_reservations" USING btree ("settlement_key");--> statement-breakpoint
CREATE INDEX "scenario_credit_reservations_run_idx" ON "pdr_ai_v2_scenario_credit_reservations" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_dispatches_event_unique" ON "pdr_ai_v2_scenario_dispatches" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "scenario_dispatches_due_idx" ON "pdr_ai_v2_scenario_dispatches" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "scenario_dispatches_run_idx" ON "pdr_ai_v2_scenario_dispatches" USING btree ("run_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_graph_builds_company_key_unique" ON "pdr_ai_v2_scenario_graph_builds" USING btree ("company_id","build_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_graph_builds_group_unique" ON "pdr_ai_v2_scenario_graph_builds" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_graph_ingestions_build_unit_unique" ON "pdr_ai_v2_scenario_graph_ingestions" USING btree ("build_id","unit_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_graph_snapshots_build_unique" ON "pdr_ai_v2_scenario_graph_snapshots" USING btree ("build_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_ontology_specs_run_unique" ON "pdr_ai_v2_scenario_ontology_specs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_request_specs_idempotency_unique" ON "pdr_ai_v2_scenario_request_specs" USING btree ("company_id","created_by_user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_source_manifests_run_unique" ON "pdr_ai_v2_scenario_source_manifests" USING btree ("run_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_units_run_unit_unique" ON "pdr_ai_v2_scenario_units" USING btree ("run_id","generation","unit_key");--> statement-breakpoint
CREATE INDEX "scenario_units_run_seq_idx" ON "pdr_ai_v2_scenario_units" USING btree ("run_id","generation","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_world_specs_run_unique" ON "pdr_ai_v2_scenario_world_specs" USING btree ("run_id","generation");