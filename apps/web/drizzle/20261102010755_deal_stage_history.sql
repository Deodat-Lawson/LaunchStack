CREATE TABLE "pdr_ai_v2_deal_stage_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" bigint NOT NULL,
	"relationship_id" varchar(256) NOT NULL,
	"stage" varchar(32) NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"exited_at" timestamp with time zone,
	"actor_user_id" varchar(256)
);
--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_partner_relationships" ALTER COLUMN "stage" SET DEFAULT 'lead';--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_deal_stage_history" ADD CONSTRAINT "pdr_ai_v2_deal_stage_history_company_id_pdr_ai_v2_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."pdr_ai_v2_company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_deal_stage_history" ADD CONSTRAINT "pdr_ai_v2_deal_stage_history_relationship_id_pdr_ai_v2_partner_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."pdr_ai_v2_partner_relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_stage_history_relationship_idx" ON "pdr_ai_v2_deal_stage_history" USING btree ("relationship_id","entered_at");--> statement-breakpoint
CREATE INDEX "deal_stage_history_company_stage_idx" ON "pdr_ai_v2_deal_stage_history" USING btree ("company_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_stage_history_one_open_unique" ON "pdr_ai_v2_deal_stage_history" USING btree ("relationship_id") WHERE "pdr_ai_v2_deal_stage_history"."exited_at" is null;--> statement-breakpoint
-- launchstack:allow-dml — the deal stage vocabulary changes with this release:
-- the code now stores and reads the funnel's own words (lead, qualified,
-- contacted, meeting, proposal, negotiating, won, lost, nurture) instead of
-- translating the older partner words on every read. Stored values and code
-- must flip together; as a separate backfill, every deal would read as an
-- unknown stage between deploy and the backfill run. Bounded by the number of
-- deals, idempotent, and a no-op on a clean database. The mapping is the one
-- the Prospects screens already applied (LEGACY_STAGE_MAP in
-- pipelines/src/distribution/types.ts), so no deal changes what it shows.
UPDATE "pdr_ai_v2_partner_relationships"
SET "stage" = CASE "stage"
		WHEN 'candidate' THEN 'lead' WHEN 'researched' THEN 'lead'
		WHEN 'in_conversation' THEN 'meeting'
		WHEN 'contracted' THEN 'won' WHEN 'active' THEN 'won'
		WHEN 'declined' THEN 'lost' WHEN 'dormant' THEN 'nurture'
		ELSE "stage" END
WHERE "stage" IN ('candidate','researched','in_conversation','contracted','active','declined','dormant');
--> statement-breakpoint
-- Stage history in the same words (the events' from/to were the old ones).
UPDATE "pdr_ai_v2_relationship_events"
SET "payload" = "payload" || jsonb_build_object(
	'from', CASE "payload"->>'from'
		WHEN 'candidate' THEN 'lead' WHEN 'researched' THEN 'lead'
		WHEN 'in_conversation' THEN 'meeting'
		WHEN 'contracted' THEN 'won' WHEN 'active' THEN 'won'
		WHEN 'declined' THEN 'lost' WHEN 'dormant' THEN 'nurture'
		ELSE "payload"->>'from' END,
	'to', CASE "payload"->>'to'
		WHEN 'candidate' THEN 'lead' WHEN 'researched' THEN 'lead'
		WHEN 'in_conversation' THEN 'meeting'
		WHEN 'contracted' THEN 'won' WHEN 'active' THEN 'won'
		WHEN 'declined' THEN 'lost' WHEN 'dormant' THEN 'nurture'
		ELSE "payload"->>'to' END)
WHERE "type" = 'stage_changed'
	AND ("payload"->>'from' IN ('candidate','researched','in_conversation','contracted','active','declined','dormant') OR "payload"->>'to' IN ('candidate','researched','in_conversation','contracted','active','declined','dormant'));
--> statement-breakpoint
UPDATE "pdr_ai_v2_relationship_events"
SET "payload" = "payload" || jsonb_build_object('stage', CASE "payload"->>'stage'
		WHEN 'candidate' THEN 'lead' WHEN 'researched' THEN 'lead'
		WHEN 'in_conversation' THEN 'meeting'
		WHEN 'contracted' THEN 'won' WHEN 'active' THEN 'won'
		WHEN 'declined' THEN 'lost' WHEN 'dormant' THEN 'nurture'
		ELSE "payload"->>'stage' END)
WHERE "type" = 'imported' AND "payload"->>'stage' IN ('candidate','researched','in_conversation','contracted','active','declined','dormant');
--> statement-breakpoint
-- Seed one stint per stage each existing deal has been through: its first
-- stage from creation to its first real change, then one per change. The last
-- one stays open. Changes that the rewrite collapsed (candidate → researched,
-- both lead now) carry from = to and are skipped.
INSERT INTO "pdr_ai_v2_deal_stage_history"
	("company_id", "relationship_id", "stage", "entered_at", "exited_at", "actor_user_id")
WITH "changes" AS (
	SELECT e."company_id", e."relationship_id",
		e."payload"->>'from' AS "from_stage", e."payload"->>'to' AS "to_stage",
		e."occurred_at", e."actor_user_id",
		row_number() OVER w AS "n",
		lead(e."occurred_at") OVER w AS "next_at"
	FROM "pdr_ai_v2_relationship_events" e
	WHERE e."type" = 'stage_changed'
		AND e."payload"->>'to' IS NOT NULL
		AND e."payload"->>'from' IS DISTINCT FROM e."payload"->>'to'
	WINDOW w AS (PARTITION BY e."relationship_id" ORDER BY e."occurred_at", e."id")
)
SELECT r."company_id", r."id", coalesce(f."from_stage", r."stage"), r."created_at",
	f."occurred_at", NULL
FROM "pdr_ai_v2_partner_relationships" r
LEFT JOIN "changes" f ON f."relationship_id" = r."id" AND f."n" = 1
WHERE NOT EXISTS (
	SELECT 1 FROM "pdr_ai_v2_deal_stage_history" h WHERE h."relationship_id" = r."id")
UNION ALL
SELECT c."company_id", c."relationship_id", c."to_stage", c."occurred_at", c."next_at",
	c."actor_user_id"
FROM "changes" c
WHERE NOT EXISTS (
	SELECT 1 FROM "pdr_ai_v2_deal_stage_history" h WHERE h."relationship_id" = c."relationship_id");
