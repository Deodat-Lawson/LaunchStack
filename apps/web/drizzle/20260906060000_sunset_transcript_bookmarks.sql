-- Retire transcript markers and their freeform guidance permanently.
DROP TABLE "pdr_ai_v2_call_notes_bookmarks";
--> statement-breakpoint
-- Keep saved note prose and all other proposal metadata unchanged.
UPDATE "pdr_ai_v2_call_notes_enrichment_runs"
SET "original_output" = "original_output" - 'bookmarkPassages',
    "editable_proposal" = "editable_proposal" - 'bookmarkPassages'
WHERE "original_output" ? 'bookmarkPassages'
   OR "editable_proposal" ? 'bookmarkPassages';
--> statement-breakpoint
-- Failed/pending command receipts can still contain marker IDs and comments.
DELETE FROM "pdr_ai_v2_call_notes_work_items"
WHERE "payload" -> 'command' ->> 'kind' IN (
    'add_bookmark', 'update_bookmark', 'remove_bookmark'
);
