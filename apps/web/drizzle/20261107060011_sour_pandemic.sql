-- launchstack:destructive-ok
-- Legacy presence rows contain no credentials and cannot be enrolled as devices.
CREATE TABLE "pdr_ai_v2_call_notes_capture_devices" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"name" varchar(128) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"app_version" varchar(32) NOT NULL,
	"os" varchar(32) NOT NULL,
	"arch" varchar(16) NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_call_notes_capture_pairing_codes" (
	"code_hash" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_device_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_local_capture_workers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "pdr_ai_v2_call_notes_local_capture_workers" CASCADE;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" ADD COLUMN "stop_reason" varchar(16);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" ADD COLUMN "target_device_id" varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_capture_devices" ADD CONSTRAINT "pdr_ai_v2_call_notes_capture_devices_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_capture_pairing_codes" ADD CONSTRAINT "pdr_ai_v2_call_notes_capture_pairing_codes_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_notes_capture_devices_token_hash_unique" ON "pdr_ai_v2_call_notes_capture_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "call_notes_capture_devices_company_user_last_seen_idx" ON "pdr_ai_v2_call_notes_capture_devices" USING btree ("company_id","user_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_call_notes_captures" ADD CONSTRAINT "pdr_ai_v2_call_notes_captures_target_device_id_pdr_ai_v2_call_notes_capture_devices_id_fk" FOREIGN KEY ("target_device_id") REFERENCES "public"."pdr_ai_v2_call_notes_capture_devices"("id") ON DELETE set null ON UPDATE no action;