ALTER TABLE "pdr_ai_v2_storage_deletion_items" DROP CONSTRAINT "storage_deletion_items_ref_check";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" DROP CONSTRAINT "storage_deletion_items_state_check";--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD COLUMN "resolved_by" varchar(256);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD COLUMN "requeued_by" varchar(256);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD COLUMN "requeue_note" text;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD COLUMN "requeued_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "storage_deletion_items_stored_object_idx" ON "pdr_ai_v2_storage_deletion_items" USING btree ("stored_object_id");--> statement-breakpoint
CREATE INDEX "storage_deletion_items_ref_idx" ON "pdr_ai_v2_storage_deletion_items" USING btree ("adapter","storage_location_id","object_key");--> statement-breakpoint
CREATE INDEX "storage_deletion_items_source_url_idx" ON "pdr_ai_v2_storage_deletion_items" USING hash ("source_url");--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD CONSTRAINT "storage_deletion_items_ref_check" CHECK (("pdr_ai_v2_storage_deletion_items"."adapter" IS NOT NULL AND "pdr_ai_v2_storage_deletion_items"."storage_location_id" IS NOT NULL AND "pdr_ai_v2_storage_deletion_items"."object_key" IS NOT NULL) OR ("pdr_ai_v2_storage_deletion_items"."state" IN ('quarantined', 'skipped', 'waived') AND "pdr_ai_v2_storage_deletion_items"."adapter" IS NULL AND "pdr_ai_v2_storage_deletion_items"."storage_location_id" IS NULL AND "pdr_ai_v2_storage_deletion_items"."object_key" IS NULL));--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_storage_deletion_items" ADD CONSTRAINT "storage_deletion_items_state_check" CHECK ("pdr_ai_v2_storage_deletion_items"."state" IN ('pending', 'deleted', 'not_found', 'retained', 'blocked', 'quarantined', 'skipped', 'waived'));