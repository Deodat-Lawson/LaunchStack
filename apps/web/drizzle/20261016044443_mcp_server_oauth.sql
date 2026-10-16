CREATE TABLE "pdr_ai_v2_auth_jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}',
	"user_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "auth_oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"revoked" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "auth_oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_assistant_conversations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"document_id" bigint NOT NULL,
	"saved_by_user_id" bigint NOT NULL,
	"client" varchar(16) NOT NULL,
	"client_name" varchar(128),
	"title" varchar(256) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"message_count" integer NOT NULL,
	"follow_up_note_id" bigint,
	"follow_up_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"follow_up_error" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_mcp_access_keys" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"name" varchar(80) NOT NULL,
	"display_prefix" varchar(16) NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_mcp_oauth_workspace_choices" (
	"session_id" text PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"chosen_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_account" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_access_token" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_access_token_client_id_pdr_ai_v2_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."pdr_ai_v2_auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_access_token" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_access_token_session_id_pdr_ai_v2_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pdr_ai_v2_auth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_access_token" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_access_token_user_id_pdr_ai_v2_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_access_token" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_access_token_refresh_id_pdr_ai_v2_auth_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."pdr_ai_v2_auth_oauth_refresh_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_client" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_client_user_id_pdr_ai_v2_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_client_resource" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_client_resource_client_id_pdr_ai_v2_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."pdr_ai_v2_auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_client_resource" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_client_resource_resource_id_pdr_ai_v2_auth_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."pdr_ai_v2_auth_oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_consent" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_consent_client_id_pdr_ai_v2_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."pdr_ai_v2_auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_consent" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_consent_user_id_pdr_ai_v2_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_refresh_token" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_refresh_token_client_id_pdr_ai_v2_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."pdr_ai_v2_auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_refresh_token" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_refresh_token_session_id_pdr_ai_v2_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pdr_ai_v2_auth_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_oauth_refresh_token" ADD CONSTRAINT "pdr_ai_v2_auth_oauth_refresh_token_user_id_pdr_ai_v2_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_assistant_conversations" ADD CONSTRAINT "pdr_ai_v2_assistant_conversations_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_assistant_conversations" ADD CONSTRAINT "pdr_ai_v2_assistant_conversations_document_id_pdr_ai_v2_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."pdr_ai_v2_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_assistant_conversations" ADD CONSTRAINT "pdr_ai_v2_assistant_conversations_saved_by_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("saved_by_user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mcp_access_keys" ADD CONSTRAINT "pdr_ai_v2_mcp_access_keys_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mcp_access_keys" ADD CONSTRAINT "pdr_ai_v2_mcp_access_keys_user_id_pdr_ai_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mcp_oauth_workspace_choices" ADD CONSTRAINT "pdr_ai_v2_mcp_oauth_workspace_choices_session_id_pdr_ai_v2_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pdr_ai_v2_auth_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_mcp_oauth_workspace_choices" ADD CONSTRAINT "pdr_ai_v2_mcp_oauth_workspace_choices_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_oauth_access_token_token_unique" ON "pdr_ai_v2_auth_oauth_access_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_client_id_idx" ON "pdr_ai_v2_auth_oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_session_id_idx" ON "pdr_ai_v2_auth_oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_user_id_idx" ON "pdr_ai_v2_auth_oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_authorization_code_id_idx" ON "pdr_ai_v2_auth_oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_refresh_id_idx" ON "pdr_ai_v2_auth_oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_user_id_idx" ON "pdr_ai_v2_auth_oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_oauth_client_resource_client_resource_unique" ON "pdr_ai_v2_auth_oauth_client_resource" USING btree ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_resource_client_id_idx" ON "pdr_ai_v2_auth_oauth_client_resource" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_resource_resource_id_idx" ON "pdr_ai_v2_auth_oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_consent_client_id_idx" ON "pdr_ai_v2_auth_oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_consent_user_id_idx" ON "pdr_ai_v2_auth_oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_oauth_refresh_token_token_unique" ON "pdr_ai_v2_auth_oauth_refresh_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_client_id_idx" ON "pdr_ai_v2_auth_oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_session_id_idx" ON "pdr_ai_v2_auth_oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_user_id_idx" ON "pdr_ai_v2_auth_oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_authorization_code_id_idx" ON "pdr_ai_v2_auth_oauth_refresh_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_document_unique" ON "pdr_ai_v2_assistant_conversations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "assistant_conversations_company_saver_idx" ON "pdr_ai_v2_assistant_conversations" USING btree ("company_id","saved_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_access_keys_secret_hash_unique" ON "pdr_ai_v2_mcp_access_keys" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "mcp_access_keys_company_user_idx" ON "pdr_ai_v2_mcp_access_keys" USING btree ("company_id","user_id");