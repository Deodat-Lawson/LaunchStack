DROP INDEX "connector_connections_company_provider_owner_unique";--> statement-breakpoint
-- Notion connections become per-user: each belongs to the member who
-- connected it. Done after the old index is gone, which allowed one per-user
-- row per member per provider and so would refuse a member's second Notion
-- workspace.
UPDATE "pdr_ai_v2_connector_connections" SET "owner_user_id" = "granted_by_user_id" WHERE "provider" = 'notion' AND "owner_user_id" IS NULL AND "granted_by_user_id" IS NOT NULL;--> statement-breakpoint
-- A Notion row whose connecting member has gone has no one to own it: no
-- user row at all, or no active membership in that workspace any more (they
-- left before this release, which now deletes a leaver's connections). It
-- could not sync and nobody could see it to disconnect it. Its sync state
-- cascades; the documents it imported stay. Its token is not revoked at
-- Notion from here; the member can remove LaunchStack in Notion's settings.
DELETE FROM "pdr_ai_v2_connector_connections" AS c WHERE c."provider" = 'notion' AND (c."owner_user_id" IS NULL OR NOT EXISTS (SELECT 1 FROM "pdr_ai_v2_user_company_memberships" AS m WHERE m."user_id" = c."owner_user_id" AND m."company_id" = c."company_id" AND m."status" = 'active'));--> statement-breakpoint
CREATE UNIQUE INDEX "connector_connections_company_provider_owner_unique" ON "pdr_ai_v2_connector_connections" USING btree ("company_id","provider","owner_user_id") WHERE owner_user_id is not null and provider = 'gmail';
