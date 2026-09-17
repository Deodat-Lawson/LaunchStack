CREATE TABLE "pdr_ai_v2_settings_values" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"scope_type" varchar(16) NOT NULL,
	"scope_id" varchar(256) DEFAULT '' NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_agent_persona" ADD COLUMN "autonomy" varchar(16);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_settings_values" ADD CONSTRAINT "pdr_ai_v2_settings_values_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settings_values_scope_key_idx" ON "pdr_ai_v2_settings_values" USING btree ("company_id","scope_type","scope_id","key");--> statement-breakpoint
CREATE INDEX "settings_values_company_key_idx" ON "pdr_ai_v2_settings_values" USING btree ("company_id","key");