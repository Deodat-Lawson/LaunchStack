ALTER TABLE pdr_ai_v2_vantage_agenda_topics ADD COLUMN content_version integer NOT NULL DEFAULT 1 CHECK (content_version > 0);
CREATE TABLE pdr_ai_v2_vantage_decision_operations (
 id text PRIMARY KEY, company_id bigint NOT NULL, topic_id text NOT NULL, actor_id text NOT NULL,
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pdr_ai_v2_vantage_commitments ADD COLUMN content_version integer NOT NULL DEFAULT 1 CHECK (content_version > 0);
