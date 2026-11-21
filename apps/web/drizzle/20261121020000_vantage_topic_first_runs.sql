ALTER TABLE pdr_ai_v2_vantage_weekly_review_runs
    ADD COLUMN retrieval_mode text NOT NULL DEFAULT 'legacy' CHECK (retrieval_mode IN ('legacy','topic-first')),
    ADD COLUMN pinned_cutoff timestamptz,
    ADD COLUMN pinned_as_of timestamptz,
    ADD COLUMN authority_epoch text,
    ADD COLUMN exploration_dispatched boolean NOT NULL DEFAULT false,
    ADD COLUMN exploration_deadline_at timestamptz,
    ADD COLUMN snapshot_hash text,
    ADD COLUMN last_dispatch_at timestamptz;
--> statement-breakpoint
CREATE TABLE pdr_ai_v2_vantage_weekly_review_run_manifests (
    run_id uuid PRIMARY KEY REFERENCES pdr_ai_v2_vantage_weekly_review_runs(id) ON DELETE CASCADE,
    company_id bigint NOT NULL,
    owner_id text NOT NULL,
    manifest_hash text NOT NULL,
    manifest jsonb NOT NULL,
    trace jsonb,
    digest_ids jsonb,
    snapshot_commitment jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
