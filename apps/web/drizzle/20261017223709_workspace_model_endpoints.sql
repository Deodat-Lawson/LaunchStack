CREATE TABLE "pdr_ai_v2_workspace_model_endpoints" (
	"company_id" bigint PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"base_url" text NOT NULL,
	"api_key_ciphertext" text,
	"api_key_last4" varchar(8),
	"encryption_key_version" smallint DEFAULT 1 NOT NULL,
	"models" jsonb,
	"connected_via" varchar(16) DEFAULT 'key' NOT NULL,
	"updated_by_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_model_endpoints" ADD CONSTRAINT "pdr_ai_v2_workspace_model_endpoints_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_workspace_model_endpoints" ADD CONSTRAINT "pdr_ai_v2_workspace_model_endpoints_updated_by_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE set null ON UPDATE no action;