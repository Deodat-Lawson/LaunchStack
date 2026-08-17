CREATE TABLE "pdr_ai_v2_collab_room" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"channel_id" varchar(64) NOT NULL,
	"name" varchar(256) NOT NULL,
	"purpose" text,
	"members" jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" varchar(256),
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_room" ADD CONSTRAINT "pdr_ai_v2_collab_room_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_collab_room" ADD CONSTRAINT "pdr_ai_v2_collab_room_channel_id_pdr_ai_v2_collab_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."pdr_ai_v2_collab_channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collab_room_company_idx" ON "pdr_ai_v2_collab_room" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "collab_room_channel_idx" ON "pdr_ai_v2_collab_room" USING btree ("channel_id");