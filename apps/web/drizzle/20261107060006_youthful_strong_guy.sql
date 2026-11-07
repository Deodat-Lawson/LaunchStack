CREATE TABLE "pdr_ai_v2_call_notes_local_capture_workers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"worker_id" varchar(64) NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_local_capture_workers" ADD CONSTRAINT "pdr_ai_v2_call_notes_local_capture_workers_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_local_capture_workers_company_user_worker_unique" ON "pdr_ai_v2_call_notes_local_capture_workers" USING btree ("company_id","user_id","worker_id");--> statement-breakpoint
CREATE INDEX "call_notes_local_capture_workers_company_user_last_seen_idx" ON "pdr_ai_v2_call_notes_local_capture_workers" USING btree ("company_id","user_id","last_seen_at");