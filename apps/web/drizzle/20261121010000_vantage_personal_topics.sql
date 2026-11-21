CREATE TABLE pdr_ai_v2_vantage_personal_topics (
 id uuid PRIMARY KEY, company_id bigint NOT NULL REFERENCES pdr_ai_v2_company(id) ON DELETE CASCADE,
 owner_id text NOT NULL, title text NOT NULL, guidance jsonb NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz
);
CREATE INDEX vantage_personal_topics_owner ON pdr_ai_v2_vantage_personal_topics(company_id,owner_id,status);
CREATE TABLE pdr_ai_v2_vantage_personal_topic_watches (
 topic_id uuid NOT NULL REFERENCES pdr_ai_v2_vantage_personal_topics(id) ON DELETE CASCADE,
 company_id bigint NOT NULL, owner_id text NOT NULL,
 document_id bigint NOT NULL REFERENCES pdr_ai_v2_document(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(topic_id,document_id)
);
