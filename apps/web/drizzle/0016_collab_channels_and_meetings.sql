-- Collaboration: channels, meetings, agent personas, and worker nodes.
--
-- A meeting is a conversation that runs *inside* a channel. The channel log is
-- the single source of truth for what was said — the meeting row only records
-- configuration and where the turn rotation got to. That is what lets a human
-- take over, a Slack mirror, and a remote agent node all read and write the
-- same conversation without a second copy to keep in sync.
--
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_collab_channel" (
    "id" varchar(64) PRIMARY KEY,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "slug" varchar(96) NOT NULL,
    "name" varchar(256) NOT NULL,
    "topic" text,
    "slack_channel_id" varchar(64),
    "archived" boolean NOT NULL DEFAULT false,
    "created_by_user_id" varchar(256),
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "collab_channel_company_slug_idx"
    ON "pdr_ai_v2_collab_channel" ("company_id", "slug");
CREATE INDEX IF NOT EXISTS "collab_channel_company_idx"
    ON "pdr_ai_v2_collab_channel" ("company_id");

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
-- `seq` is gap-free per channel. The unique index is not decoration: it is the
-- constraint that makes the "claim the next seq under a row lock" insert safe
-- against two concurrent turns.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_collab_message" (
    "id" varchar(64) PRIMARY KEY,
    "channel_id" varchar(64) NOT NULL
        REFERENCES "pdr_ai_v2_collab_channel"("id") ON DELETE CASCADE,
    "seq" integer NOT NULL,
    "author_kind" varchar(16) NOT NULL,
    "author_id" varchar(128) NOT NULL,
    "author_name" varchar(256) NOT NULL,
    "on_behalf_of_persona_id" varchar(128),
    "body" text NOT NULL,
    "kind" varchar(24) NOT NULL DEFAULT 'chat',
    "thread_id" varchar(64),
    "slack_ts" varchar(32),
    "meta" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "collab_message_channel_seq_idx"
    ON "pdr_ai_v2_collab_message" ("channel_id", "seq");
CREATE INDEX IF NOT EXISTS "collab_message_channel_created_idx"
    ON "pdr_ai_v2_collab_message" ("channel_id", "created_at");

-- ---------------------------------------------------------------------------
-- Agent personas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_collab_agent_persona" (
    "id" varchar(64) PRIMARY KEY,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "key" varchar(64) NOT NULL,
    "display_name" varchar(128) NOT NULL,
    "role" varchar(128) NOT NULL,
    "system_prompt" text NOT NULL,
    "node_id" varchar(128),
    "route" varchar(32),
    "temperature_x100" integer,
    "max_turn_chars" integer,
    "accent" varchar(32),
    "archived" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "collab_persona_company_key_idx"
    ON "pdr_ai_v2_collab_agent_persona" ("company_id", "key");

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------
-- `participants` is a frozen copy of the personas at start time. Editing a
-- persona afterwards must not rewrite history, and a finished meeting has to
-- replay exactly as it ran.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_collab_meeting" (
    "id" varchar(64) PRIMARY KEY,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "channel_id" varchar(64) NOT NULL
        REFERENCES "pdr_ai_v2_collab_channel"("id") ON DELETE CASCADE,
    "title" varchar(256) NOT NULL,
    "objective" text NOT NULL,
    "agenda" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "participants" jsonb NOT NULL,
    "turn_policy" varchar(24) NOT NULL DEFAULT 'round_robin',
    "moderator_persona_id" varchar(128),
    "max_turns" integer NOT NULL DEFAULT 12,
    "completion_marker" varchar(64),
    "context" jsonb,
    "status" varchar(24) NOT NULL DEFAULT 'scheduled',
    "turn_index" integer NOT NULL DEFAULT 0,
    "next_speaker_id" varchar(128),
    "controller" jsonb,
    "error" text,
    "slack_channel_id" varchar(64),
    "slack_mirror_enabled" boolean NOT NULL DEFAULT false,
    "slack_use_agent_identity" boolean NOT NULL DEFAULT false,
    "created_by_user_id" varchar(256),
    "started_at" timestamptz,
    "ended_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "collab_meeting_company_idx"
    ON "pdr_ai_v2_collab_meeting" ("company_id");
CREATE INDEX IF NOT EXISTS "collab_meeting_channel_idx"
    ON "pdr_ai_v2_collab_meeting" ("channel_id");

-- ---------------------------------------------------------------------------
-- Worker nodes
-- ---------------------------------------------------------------------------
-- One row per machine that has registered to serve agent turns. Kept so the
-- settings UI can show which nodes are connected and what they claim to run.

CREATE TABLE IF NOT EXISTS "pdr_ai_v2_collab_node" (
    "id" varchar(128) PRIMARY KEY,
    "company_id" bigint NOT NULL REFERENCES "pdr_ai_v2_company"("id") ON DELETE CASCADE,
    "label" varchar(256),
    "persona_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "last_seen_at" timestamptz,
    "last_remote_address" varchar(64),
    "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "collab_node_company_idx"
    ON "pdr_ai_v2_collab_node" ("company_id");
