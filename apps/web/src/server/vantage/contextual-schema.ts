/** Local milestone schema: applied only by the separately guarded owned-DB harness. */
export const CONTEXTUAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_contextual_inventory (
 company_id bigint NOT NULL, document_id bigint NOT NULL, required boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), PRIMARY KEY(company_id,document_id));
ALTER TABLE pdr_ai_v2_vantage_contextual_inventory ADD COLUMN IF NOT EXISTS logical_key text;
ALTER TABLE pdr_ai_v2_vantage_contextual_inventory ADD COLUMN IF NOT EXISTS native_evidence_id text;
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_contextual_architecture_review (
 company_id bigint PRIMARY KEY, revision integer NOT NULL CHECK(revision>0),
 projection_fingerprint text NOT NULL, review_state text NOT NULL CHECK(review_state IN ('reviewed','unknowns-marked')),
 reviewer_user_id bigint NOT NULL, reviewed_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_contextual_reports (
 id uuid PRIMARY KEY, company_id bigint NOT NULL, owner_user_id bigint NOT NULL, week_start date NOT NULL,
 version integer NOT NULL CHECK(version>0), ciphertext text NOT NULL, key_version integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,owner_user_id,week_start),
 FOREIGN KEY(owner_user_id,company_id) REFERENCES pdr_ai_v2_user_company_memberships(user_id,company_id) ON DELETE CASCADE);
`;

/** Additive role-pair storage, applied only by the new owned M2 database harness. */
export const ROLE_CONTEXTUAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_role_contextual_runs (
 id uuid PRIMARY KEY, company_id bigint NOT NULL, owner_user_id bigint NOT NULL, week_start date NOT NULL,
 scenario_id text NOT NULL, context_key text NOT NULL, source_authority text NOT NULL,
 version integer NOT NULL CHECK(version>0), ciphertext text NOT NULL, key_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,owner_user_id,week_start,scenario_id,context_key),
 FOREIGN KEY(owner_user_id,company_id) REFERENCES pdr_ai_v2_user_company_memberships(user_id,company_id) ON DELETE CASCADE);
`;

/** M3 local accepted candidates and atomic active-report pointer; no production migration. */
export const GROUNDING_CONTEXTUAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_grounding_runs (
 id uuid PRIMARY KEY,company_id bigint NOT NULL,owner_user_id bigint NOT NULL,week_start date NOT NULL,
 version integer NOT NULL CHECK(version>0),ciphertext text NOT NULL,key_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_user_id,company_id) REFERENCES pdr_ai_v2_user_company_memberships(user_id,company_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_grounding_active (
 company_id bigint NOT NULL,owner_user_id bigint NOT NULL,week_start date NOT NULL,
 active_report_id uuid NOT NULL REFERENCES pdr_ai_v2_vantage_grounding_runs(id),
 pointer_version integer NOT NULL CHECK(pointer_version>0),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,owner_user_id,week_start),
 FOREIGN KEY(owner_user_id,company_id) REFERENCES pdr_ai_v2_user_company_memberships(user_id,company_id) ON DELETE CASCADE);
`;

/** Private append-only dispatch evidence; never an accepted report or active pointer. */
/** status records the pipeline gate only; admitted is not proof of DB report activation. */
export const GROUNDING_ATTEMPT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pdr_ai_v2_vantage_grounding_attempts(
 id uuid PRIMARY KEY,company_id bigint NOT NULL,owner_auth_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN('offline','live')),status text NOT NULL CHECK(status IN('admitted','withheld')),
 ciphertext text NOT NULL,key_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
`;
