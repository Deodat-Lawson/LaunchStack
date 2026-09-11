CREATE TABLE "pdr_ai_v2_event_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"schema_version" integer NOT NULL,
	"company_id" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"claimed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_event_outbox" ADD CONSTRAINT "pdr_ai_v2_event_outbox_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_outbox_event_id_unique" ON "pdr_ai_v2_event_outbox" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_outbox_pending_idx" ON "pdr_ai_v2_event_outbox" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "event_outbox_claimed_idx" ON "pdr_ai_v2_event_outbox" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "event_outbox_company_id_idx" ON "pdr_ai_v2_event_outbox" USING btree ("company_id");