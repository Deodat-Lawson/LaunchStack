import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/core/db/schema";
import { pgTable } from "@launchstack/core/db/schema/helpers";

/**
 * Collaboration: Slack-shaped channels, the meetings that run inside them, the
 * agent personas that speak, and the worker nodes that serve their turns.
 *
 * The channel log is the single source of truth. A meeting is a row that
 * points at a channel and records where the turn rotation got to — it does not
 * own a second copy of the conversation.
 */

// ============================================================================
// Channels
// ============================================================================

export const collabChannel = pgTable(
    "collab_channel",
    {
        id: varchar("id", { length: 64 }).primaryKey().notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Slack-style handle, unique per company. */
        slug: varchar("slug", { length: 96 }).notNull(),
        name: varchar("name", { length: 256 }).notNull(),
        topic: text("topic"),
        /** Linked real Slack channel (`C…`), when mirroring is configured. */
        slackChannelId: varchar("slack_channel_id", { length: 64 }),
        archived: boolean("archived").notNull().default(false),
        createdByUserId: varchar("created_by_user_id", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    (table) => ({
        companySlugUnique: uniqueIndex("collab_channel_company_slug_idx").on(
            table.companyId,
            table.slug
        ),
        companyIdx: index("collab_channel_company_idx").on(table.companyId),
    })
);

// ============================================================================
// Messages
// ============================================================================

export const collabMessage = pgTable(
    "collab_message",
    {
        id: varchar("id", { length: 64 }).primaryKey().notNull(),
        channelId: varchar("channel_id", { length: 64 })
            .notNull()
            .references(() => collabChannel.id, { onDelete: "cascade" }),
        /**
         * Monotonic, gap-free position within the channel. Assigned under the
         * channel's row lock so two concurrent turns cannot claim the same seq.
         */
        seq: integer("seq").notNull(),
        authorKind: varchar("author_kind", { length: 16, enum: ["agent", "human"] }).notNull(),
        authorId: varchar("author_id", { length: 128 }).notNull(),
        authorName: varchar("author_name", { length: 256 }).notNull(),
        /** Set when a human is speaking through an agent's seat. */
        onBehalfOfPersonaId: varchar("on_behalf_of_persona_id", { length: 128 }),
        body: text("body").notNull(),
        kind: varchar("kind", {
            length: 24,
            enum: ["chat", "system", "decision", "action_item", "summary"],
        })
            .notNull()
            .default("chat"),
        threadId: varchar("thread_id", { length: 64 }),
        /** Slack `ts` — present on mirrored copies and on messages from Slack. */
        slackTs: varchar("slack_ts", { length: 32 }),
        meta: jsonb("meta"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        channelSeqUnique: uniqueIndex("collab_message_channel_seq_idx").on(
            table.channelId,
            table.seq
        ),
        channelCreatedIdx: index("collab_message_channel_created_idx").on(
            table.channelId,
            table.createdAt
        ),
    })
);

// ============================================================================
// Agent personas
// ============================================================================

export const collabAgentPersona = pgTable(
    "collab_agent_persona",
    {
        id: varchar("id", { length: 64 }).primaryKey().notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Handle used as `@key` in transcripts. Unique per company. */
        key: varchar("key", { length: 64 }).notNull(),
        displayName: varchar("display_name", { length: 128 }).notNull(),
        role: varchar("role", { length: 128 }).notNull(),
        systemPrompt: text("system_prompt").notNull(),
        /** Which worker node serves this persona; null means the app itself. */
        nodeId: varchar("node_id", { length: 128 }),
        route: varchar("route", { length: 32 }),
        temperature: integer("temperature_x100"),
        maxTurnChars: integer("max_turn_chars"),
        accent: varchar("accent", { length: 32 }),
        archived: boolean("archived").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    (table) => ({
        companyKeyUnique: uniqueIndex("collab_persona_company_key_idx").on(
            table.companyId,
            table.key
        ),
    })
);

// ============================================================================
// Meetings
// ============================================================================

export const collabMeeting = pgTable(
    "collab_meeting",
    {
        id: varchar("id", { length: 64 }).primaryKey().notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        channelId: varchar("channel_id", { length: 64 })
            .notNull()
            .references(() => collabChannel.id, { onDelete: "cascade" }),
        title: varchar("title", { length: 256 }).notNull(),
        objective: text("objective").notNull(),
        agenda: jsonb("agenda").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
        /** Frozen copy of the personas — a meeting must replay after edits. */
        participants: jsonb("participants").notNull(),
        turnPolicy: varchar("turn_policy", {
            length: 24,
            enum: ["round_robin", "moderated", "reactive"],
        })
            .notNull()
            .default("round_robin"),
        moderatorPersonaId: varchar("moderator_persona_id", { length: 128 }),
        maxTurns: integer("max_turns").notNull().default(12),
        completionMarker: varchar("completion_marker", { length: 64 }),
        /** Grounding passages pinned to the meeting (retrieved knowledge). */
        context: jsonb("context").$type<string[]>(),
        /**
         * When true, each turn additionally retrieves passages for the persona
         * about to speak. Off by default: retrieval costs a search per turn,
         * and a meeting with no documents attached has nothing to retrieve.
         */
        groundingEnabled: boolean("grounding_enabled").notNull().default(false),
        /**
         * Documents this meeting may read. Access is re-checked against the
         * creator on every retrieval — this list narrows the corpus, it does
         * not grant anything.
         */
        documentIds: jsonb("document_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
        status: varchar("status", {
            length: 24,
            enum: ["scheduled", "running", "paused", "human_control", "completed", "failed"],
        })
            .notNull()
            .default("scheduled"),
        turnIndex: integer("turn_index").notNull().default(0),
        nextSpeakerId: varchar("next_speaker_id", { length: 128 }),
        controller: jsonb("controller"),
        error: text("error"),
        slackChannelId: varchar("slack_channel_id", { length: 64 }),
        slackMirrorEnabled: boolean("slack_mirror_enabled").notNull().default(false),
        slackUseAgentIdentity: boolean("slack_use_agent_identity").notNull().default(false),
        createdByUserId: varchar("created_by_user_id", { length: 256 }),
        startedAt: timestamp("started_at", { withTimezone: true }),
        endedAt: timestamp("ended_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    (table) => ({
        companyIdx: index("collab_meeting_company_idx").on(table.companyId),
        channelIdx: index("collab_meeting_channel_idx").on(table.channelId),
    })
);

// ============================================================================
// Rooms
// ============================================================================

/**
 * A room is a question surface, not a conversation.
 *
 * Deliberately its own table rather than a flavour of `collab_meeting`. A
 * meeting row carries a turn policy, a turn cap, a completion marker, a status
 * machine, a turn cursor and a controller — every one of which is meaningless
 * for a fan-out. Reusing it would also make rooms load through
 * `getMeetingRuntime()` and surface in the meetings list as permanently
 * scheduled meetings.
 *
 * There is no round table: a round is derived from the channel log, where the
 * question carries its id and expected roster and each answer carries the round
 * id. Same rule the rest of this subsystem follows — the log is the truth.
 */
export const collabRoom = pgTable(
    "collab_room",
    {
        id: varchar("id", { length: 64 }).primaryKey().notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        channelId: varchar("channel_id", { length: 64 })
            .notNull()
            .references(() => collabChannel.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 256 }).notNull(),
        purpose: text("purpose"),
        /**
         * Frozen copy of the members, each with the documents it answers from.
         * Frozen for the same reason a meeting's participants are: editing a
         * persona must not rewrite what was said in a past round.
         */
        members: jsonb("members").notNull(),
        archived: boolean("archived").notNull().default(false),
        createdByUserId: varchar("created_by_user_id", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    (table) => ({
        companyIdx: index("collab_room_company_idx").on(table.companyId),
        channelIdx: index("collab_room_channel_idx").on(table.channelId),
    })
);

// ============================================================================
// Worker nodes
// ============================================================================

export const collabNode = pgTable(
    "collab_node",
    {
        id: varchar("id", { length: 128 }).primaryKey().notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        label: varchar("label", { length: 256 }),
        /** Personas the node advertised at registration. */
        personaIds: jsonb("persona_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
        lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
        /** Remote address the node last connected from — operator diagnostics. */
        lastRemoteAddress: varchar("last_remote_address", { length: 64 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    (table) => ({
        companyIdx: index("collab_node_company_idx").on(table.companyId),
    })
);

// ============================================================================
// Relations
// ============================================================================

export const collabChannelRelations = relations(collabChannel, ({ many, one }) => ({
    messages: many(collabMessage),
    meetings: many(collabMeeting),
    company: one(company, {
        fields: [collabChannel.companyId],
        references: [company.id],
    }),
}));

export const collabMessageRelations = relations(collabMessage, ({ one }) => ({
    channel: one(collabChannel, {
        fields: [collabMessage.channelId],
        references: [collabChannel.id],
    }),
}));

export const collabMeetingRelations = relations(collabMeeting, ({ one }) => ({
    channel: one(collabChannel, {
        fields: [collabMeeting.channelId],
        references: [collabChannel.id],
    }),
    company: one(company, {
        fields: [collabMeeting.companyId],
        references: [company.id],
    }),
}));

export const collabAgentPersonaRelations = relations(collabAgentPersona, ({ one }) => ({
    company: one(company, {
        fields: [collabAgentPersona.companyId],
        references: [company.id],
    }),
}));

export const collabRoomRelations = relations(collabRoom, ({ one }) => ({
    channel: one(collabChannel, {
        fields: [collabRoom.channelId],
        references: [collabChannel.id],
    }),
    company: one(company, {
        fields: [collabRoom.companyId],
        references: [company.id],
    }),
}));

export type CollabChannel = InferSelectModel<typeof collabChannel>;
export type CollabRoom = InferSelectModel<typeof collabRoom>;
export type CollabMessage = InferSelectModel<typeof collabMessage>;
export type CollabAgentPersona = InferSelectModel<typeof collabAgentPersona>;
export type CollabMeeting = InferSelectModel<typeof collabMeeting>;
export type CollabNode = InferSelectModel<typeof collabNode>;
