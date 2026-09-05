CREATE TABLE "pdr_ai_v2_repo_context_bundles" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(256) NOT NULL,
	"sha" varchar(64) NOT NULL,
	"bundle" jsonb NOT NULL,
	"compute_ms" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_repo_explainer_jobs" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"workspace_id" varchar(256) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"diagram_type" varchar(32) NOT NULL,
	"instructions" text,
	"sha" varchar(64),
	"claim_id" varchar(256),
	"result" jsonb,
	"error_message" text,
	"published_document_id" bigint,
	"stale_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_repo_sync_requests" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"reason" varchar(32) NOT NULL,
	"claim_id" varchar(256),
	"error_message" text,
	"requested_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_repo_workspaces" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"created_by_user_id" varchar(256) NOT NULL,
	"provider" varchar(32) DEFAULT 'github' NOT NULL,
	"owner" varchar(256) NOT NULL,
	"repo" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"head_sha" varchar(64),
	"mirror_path" text,
	"disk_bytes" bigint,
	"last_synced_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_repo_context_bundles" ADD CONSTRAINT "pdr_ai_v2_repo_context_bundles_workspace_id_pdr_ai_v2_repo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."pdr_ai_v2_repo_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_repo_explainer_jobs" ADD CONSTRAINT "pdr_ai_v2_repo_explainer_jobs_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_repo_explainer_jobs" ADD CONSTRAINT "pdr_ai_v2_repo_explainer_jobs_workspace_id_pdr_ai_v2_repo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."pdr_ai_v2_repo_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_repo_sync_requests" ADD CONSTRAINT "pdr_ai_v2_repo_sync_requests_workspace_id_pdr_ai_v2_repo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."pdr_ai_v2_repo_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_repo_workspaces" ADD CONSTRAINT "pdr_ai_v2_repo_workspaces_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_context_bundles_workspace_sha_unique" ON "pdr_ai_v2_repo_context_bundles" USING btree ("workspace_id","sha");--> statement-breakpoint
CREATE INDEX "repo_context_bundles_workspace_idx" ON "pdr_ai_v2_repo_context_bundles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "repo_explainer_jobs_company_idx" ON "pdr_ai_v2_repo_explainer_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "repo_explainer_jobs_workspace_idx" ON "pdr_ai_v2_repo_explainer_jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "repo_explainer_jobs_status_idx" ON "pdr_ai_v2_repo_explainer_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_sync_requests_pending_unique" ON "pdr_ai_v2_repo_sync_requests" USING btree ("workspace_id") WHERE "pdr_ai_v2_repo_sync_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "repo_sync_requests_workspace_idx" ON "pdr_ai_v2_repo_sync_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "repo_sync_requests_status_idx" ON "pdr_ai_v2_repo_sync_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_workspaces_company_repo_unique" ON "pdr_ai_v2_repo_workspaces" USING btree ("company_id","provider","owner","repo");--> statement-breakpoint
CREATE INDEX "repo_workspaces_company_id_idx" ON "pdr_ai_v2_repo_workspaces" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "repo_workspaces_status_idx" ON "pdr_ai_v2_repo_workspaces" USING btree ("status");