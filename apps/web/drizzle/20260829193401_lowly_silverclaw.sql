CREATE TABLE "pdr_ai_v2_auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_ai_v2_auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_account" ADD CONSTRAINT "pdr_ai_v2_auth_account_user_id_pdr_ai_v2_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_auth_session" ADD CONSTRAINT "pdr_ai_v2_auth_session_user_id_pdr_ai_v2_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."pdr_ai_v2_auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "pdr_ai_v2_auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_account_issuer_account_idx" ON "pdr_ai_v2_auth_account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_unique" ON "pdr_ai_v2_auth_session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "pdr_ai_v2_auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_user_email_unique" ON "pdr_ai_v2_auth_user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "pdr_ai_v2_auth_verification" USING btree ("identifier");