import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/store/schema";
import { pgTable } from "@launchstack/store/schema/helpers";

/**
 * Persisted Ask sessions — the chat thread survives a reload, a new tab, and a
 * different machine.
 *
 * Scoping is deliberately narrower than Sources: a session belongs to **one
 * person inside one workspace**, not to the workspace. A half-finished
 * question is a draft, and a colleague seeing your drafts in their sidebar is
 * a surprise nobody asked for. Pipeline runs, which are workspace work, stay
 * workspace-wide — the History feed merges both, and each side keeps its own
 * scope (`~/server/history`).
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
        /** Auth subject id of the owner — the only person who can read this session. */
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
    },
    table => ({
        sessionSeqUnique: uniqueIndex("workspace_session_messages_session_seq_uq").on(
            table.sessionId,
            table.seq
        ),
    })
);

export type WorkspaceSessionRow = InferSelectModel<typeof workspaceSessions>;
export type WorkspaceSessionMessageRow = InferSelectModel<typeof workspaceSessionMessages>;
