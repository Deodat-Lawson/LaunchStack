import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    doublePrecision,
    index,
    integer,
    jsonb,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";
import type { ChatQueueItem, ChatTurnMetadata } from "~/lib/chat-turns";

/**
 * Persisted Ask sessions — the chat thread survives a reload, a new tab, and a
 * different machine.
 *
 * Scoping is deliberately narrower than Sources: a session belongs to **one
 * person inside one workspace**, not to the workspace. A half-finished
 * question is a draft, and a colleague seeing your drafts in their sidebar is
 * a surprise nobody asked for. The owner may share one, read-only, with
 * people, groups, roles or the whole workspace (`workspace_session_grants`,
 * ADR-014); readers continue it as a fork of their own. Pipeline runs, which
 * are workspace work, stay workspace-wide — the History feed merges both, and
 * each side keeps its own scope (`~/server/history`).
 *
 * Sessions are the *transcript*, never the answer's evidence. Citations are
 * stored as the source ids and snippets the turn actually showed, so reopening
 * a session shows what was said at the time even if a source was since
 * renamed, refiled, or deleted — resolving them against today's library
 * happens in the UI, which already knows how to render a citation whose
 * document is gone.
 */
export const workspaceSessions = pgTable(
    "workspace_sessions",
    {
        /** Caller-supplied uuid; the client needs the id before the first insert lands. */
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Auth subject id of the owner — the only person who can write to this session. */
        userId: varchar("user_id", { length: 256 }).notNull(),

        /** Derived from the opening question, or renamed by hand. */
        title: varchar("title", { length: 300 }).notNull(),
        /**
         * Workspace source ids (`d12`, `m3`) pinned as context when the session
         * was last used, so reopening it restores the same retrieval scope.
         */
        contextSourceIds: jsonb("context_source_ids").$type<string[]>().notNull().default([]),
        /**
         * Set when this chat continues an imported agent transcript: the title
         * shown in the banner and the tail fed back as conversation history.
         * Null for an ordinary chat.
         */
        continuation: jsonb("continuation").$type<{ title: string; context: string } | null>(),

        /** Denormalised for the sidebar, which must not read the messages to draw a row. */
        messageCount: integer("message_count").notNull().default(0),
        /** Superseded by `workspace_session_user_state.pinned_at` (ADR-014); no longer read. */
        pinned: boolean("pinned").notNull().default(false),

        lastMessageAt: timestamp("last_message_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        /**
         * Handle of the agent this chat is held with, so reopening it restores
         * the same voice. Null = the workspace's default assistant. Appended
         * after the table shipped; declared last on purpose.
         */
        agentKey: varchar("agent_key", { length: 64 }),
        queuedMessages: jsonb("queued_messages").$type<ChatQueueItem[]>().notNull().default([]),
        queueRevision: integer("queue_revision").notNull().default(0),
        /** When the owner first shared it; null while it is private. */
        sharedAt: timestamp("shared_at", { withTimezone: true }),
        /** The chat this one was forked from ("Continue in a new chat"); a plain id, never a FK. */
        forkedFromSessionId: varchar("forked_from_session_id", { length: 64 }),
    },
    table => ({
        // The sidebar's one query: this person's sessions in this workspace,
        // newest activity first.
        ownerRecentIdx: index("workspace_sessions_owner_recent_idx").on(
            table.companyId,
            table.userId,
            table.lastMessageAt
        ),
        companyIdx: index("workspace_sessions_company_idx").on(table.companyId),
    })
);

/**
 * One stored turn. `seq` is assigned by the writer, not the clock: two turns
 * inserted in the same millisecond still have a defined order, and the unique
 * index makes a double-submitted append collide instead of duplicating.
 */
export const workspaceSessionMessages = pgTable(
    "workspace_session_messages",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        sessionId: varchar("session_id", { length: 64 })
            .notNull()
            .references(() => workspaceSessions.id, { onDelete: "cascade" }),
        seq: integer("seq").notNull(),
        role: varchar("role", { length: 16, enum: ["user", "assistant"] }).notNull(),
        text: text("text").notNull(),
        /** Source ids pinned on a user turn, or cited on an assistant turn. */
        refs: jsonb("refs").$type<string[]>(),
        /** `ThreadReference[]` as rendered — snippet, page, match text. */
        citations: jsonb("citations").$type<unknown[]>(),
        /** Per-turn files (`EphemeralAttachment[]`); never promoted to Sources. */
        attachments: jsonb("attachments").$type<unknown[]>(),
        model: varchar("model", { length: 120 }),
        /** Chunks the answer was built from — the same number the turn displayed. */
        tokens: integer("tokens"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        /** Which agent produced an assistant turn (or was addressed by a user turn). */
        agentKey: varchar("agent_key", { length: 64 }),
        metadata: jsonb("metadata").$type<ChatTurnMetadata>(),
    },
    table => ({
        sessionSeqUnique: uniqueIndex("workspace_session_messages_session_seq_uq").on(
            table.sessionId,
            table.seq
        ),
    })
);

/**
 * Who, besides the owner, may read a session. Mirrors `folder_grants`, plus a
 * `workspace` principal (`principal_id = '*'`) for "Everyone at <workspace>".
 * Level is `view` today; the column leaves room for a later `contribute`.
 */
export const workspaceSessionGrants = pgTable(
    "workspace_session_grants",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        sessionId: varchar("session_id", { length: 64 })
            .notNull()
            .references(() => workspaceSessions.id, { onDelete: "cascade" }),
        /** `user` (users.id) | `group` (workspace_groups.id) | `role` (slug) | `workspace` (`*`). */
        principalType: varchar("principal_type", { length: 16 }).notNull(),
        principalId: varchar("principal_id", { length: 64 }).notNull(),
        level: varchar("level", { length: 16 }).notNull().default("view"),
        grantedBy: varchar("granted_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        principalUnique: uniqueIndex("workspace_session_grants_session_principal_uq").on(
            table.sessionId,
            table.principalType,
            table.principalId
        ),
        // "Chats shared with me": every grant in the workspace naming one of my principals.
        companyPrincipalIdx: index("workspace_session_grants_company_principal_idx").on(
            table.companyId,
            table.principalType,
            table.principalId
        ),
    })
);

/**
 * One person's view of one chat — theirs or one shared with them: pinned and
 * in which order, archived, last opened. Keeping it per person means the
 * owner's pins never reorder a reader's sidebar.
 */
export const workspaceSessionUserState = pgTable(
    "workspace_session_user_state",
    {
        sessionId: varchar("session_id", { length: 64 })
            .notNull()
            .references(() => workspaceSessions.id, { onDelete: "cascade" }),
        /** Auth subject id. */
        userId: varchar("user_id", { length: 256 }).notNull(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        pinnedAt: timestamp("pinned_at", { withTimezone: true }),
        /** Manual order among pinned chats, ascending. Gaps are fine; reorders rewrite. */
        pinRank: doublePrecision("pin_rank"),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        pk: primaryKey({ columns: [table.sessionId, table.userId] }),
        companyUserIdx: index("workspace_session_user_state_company_user_idx").on(
            table.companyId,
            table.userId
        ),
    })
);

export type WorkspaceSessionRow = InferSelectModel<typeof workspaceSessions>;
export type WorkspaceSessionGrantRow = InferSelectModel<typeof workspaceSessionGrants>;
export type WorkspaceSessionUserStateRow = InferSelectModel<typeof workspaceSessionUserState>;
export type WorkspaceSessionMessageRow = InferSelectModel<typeof workspaceSessionMessages>;
