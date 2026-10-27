CREATE TABLE "pdr_ai_v2_feedback_attachments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" bigint NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_feedback_replies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" bigint NOT NULL,
	"author_user_id" varchar(256) NOT NULL,
	"from_team" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_feedback_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"severity" varchar(16),
	"status" varchar(16) DEFAULT 'new' NOT NULL,
	"reporter_user_id" varchar(256) NOT NULL,
	"company_id" bigint,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"status_changed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_feedback_votes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_feedback_attachments" ADD CONSTRAINT "pdr_ai_v2_feedback_attachments_report_id_pdr_ai_v2_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."pdr_ai_v2_feedback_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_feedback_replies" ADD CONSTRAINT "pdr_ai_v2_feedback_replies_report_id_pdr_ai_v2_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."pdr_ai_v2_feedback_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_feedback_reports" ADD CONSTRAINT "pdr_ai_v2_feedback_reports_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_feedback_votes" ADD CONSTRAINT "pdr_ai_v2_feedback_votes_report_id_pdr_ai_v2_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."pdr_ai_v2_feedback_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_attachments_report_idx" ON "pdr_ai_v2_feedback_attachments" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "feedback_replies_report_created_idx" ON "pdr_ai_v2_feedback_replies" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_kind_status_created_idx" ON "pdr_ai_v2_feedback_reports" USING btree ("kind","status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_reporter_idx" ON "pdr_ai_v2_feedback_reports" USING btree ("reporter_user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_activity_idx" ON "pdr_ai_v2_feedback_reports" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_company_idx" ON "pdr_ai_v2_feedback_reports" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_votes_report_user_unique" ON "pdr_ai_v2_feedback_votes" USING btree ("report_id","user_id");--> statement-breakpoint
CREATE INDEX "feedback_votes_user_idx" ON "pdr_ai_v2_feedback_votes" USING btree ("user_id");