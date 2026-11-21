CREATE TABLE pdr_ai_v2_document_version_digests (
 id bigserial PRIMARY KEY,
 company_id bigint NOT NULL REFERENCES pdr_ai_v2_company(id) ON DELETE CASCADE,
 document_id bigint NOT NULL REFERENCES pdr_ai_v2_document(id) ON DELETE CASCADE,
 version_id bigint NOT NULL REFERENCES pdr_ai_v2_document_versions(id) ON DELETE CASCADE,
 content_hash varchar(64) NOT NULL,
 format_version varchar(32) NOT NULL,
 headline text NOT NULL,
 items jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX document_version_digests_key ON pdr_ai_v2_document_version_digests(version_id,content_hash,format_version);
