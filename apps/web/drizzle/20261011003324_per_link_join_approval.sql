ALTER TABLE "pdr_ai_v2_invite_codes" ALTER COLUMN "code" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "pdr_ai_v2_invite_codes" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every link that exists at this point has an 8-character code (32 bits),
-- few enough to guess, so it keeps needing approval — as it did by default.
-- The app never lets a short code admit people straight in; resetting one
-- issues a 128-bit code that can.
UPDATE "pdr_ai_v2_invite_codes" SET "requires_approval" = true;
