/**
 * Product schema: LaunchStack's MCP server — how assistants (Claude, ChatGPT,
 * Gemini, and their CLIs) connect to a workspace, and what they leave behind.
 *
 * Two ways in, both bound to exactly one person in exactly one workspace:
 *
 * - OAuth. The tokens themselves live in better-auth's `auth_oauth_*` tables
 *   (auth.ts); their `reference_id` is the workspace. `mcp_oauth_workspace_choices`
 *   only carries the person's pick from the consent flow's workspace step to
 *   the moment better-auth asks which workspace the consent is for.
 * - Access keys. A secret the person creates in Settings and pastes into a
 *   script or a CLI. Only its SHA-256 is stored; the plaintext is shown once.
 *
 * `assistant_conversations` records each conversation an assistant saved: the
 * document it became, who saved it from which assistant, and the follow-up
 * note LaunchStack wrote about it.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    index,
    integer,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company, document } from "@launchstack/store/schema";

import { authSession } from "./auth";
import { users } from "./identity";

/** What a credential may do. Read = search/fetch/list; write = save conversations. */
export const MCP_SCOPES = ["launchstack:read", "launchstack:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const mcpAccessKeys = pgTable(
    "mcp_access_keys",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** The person the key acts as. Their permissions apply on every call. */
        userId: bigint("user_id", { mode: "bigint" })
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 80 }).notNull(),
        /** First characters of the secret, shown in Settings to tell keys apart. */
        displayPrefix: varchar("display_prefix", { length: 16 }).notNull(),
        /** Hex SHA-256 of the full secret. */
        secretHash: varchar("secret_hash", { length: 64 }).notNull(),
        scopes: text("scopes").array().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
    },
    table => ({
        secretHashUnique: uniqueIndex("mcp_access_keys_secret_hash_unique").on(table.secretHash),
        companyUserIdx: index("mcp_access_keys_company_user_idx").on(table.companyId, table.userId),
    })
);

export type McpAccessKey = InferSelectModel<typeof mcpAccessKeys>;

export const mcpOauthWorkspaceChoices = pgTable("mcp_oauth_workspace_choices", {
    /** One pending choice per browser session; a newer pick replaces it. */
    sessionId: text("session_id")
        .primaryKey()
        .references(() => authSession.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" })
        .notNull()
        .references(() => company.id, { onDelete: "cascade" }),
    chosenAt: timestamp("chosen_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
});

/** Which assistant family saved a conversation; drives the viewer's label. */
export const ASSISTANT_CLIENTS = ["claude", "chatgpt", "gemini", "other"] as const;
export type AssistantClient = (typeof ASSISTANT_CLIENTS)[number];

export const assistantConversations = pgTable(
    "assistant_conversations",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        savedByUserId: bigint("saved_by_user_id", { mode: "bigint" })
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        client: varchar("client", { length: 16 }).notNull(),
        /** The connection's own name, e.g. "Claude Code" or a key's name. */
        clientName: varchar("client_name", { length: 128 }),
        title: varchar("title", { length: 256 }).notNull(),
        /** Hash of the rendered transcript; an identical re-save is a no-op. */
        contentHash: varchar("content_hash", { length: 64 }).notNull(),
        messageCount: integer("message_count").notNull(),
        /** The note LaunchStack wrote about this conversation (document_notes.id). */
        followUpNoteId: bigint("follow_up_note_id", { mode: "number" }),
        /** 'pending' | 'done' | 'failed' | 'skipped' */
        followUpStatus: varchar("follow_up_status", { length: 16 }).notNull().default("pending"),
        followUpError: text("follow_up_error"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        documentUnique: uniqueIndex("assistant_conversations_document_unique").on(table.documentId),
        companySaverIdx: index("assistant_conversations_company_saver_idx").on(
            table.companyId,
            table.savedByUserId
        ),
    })
);

export type AssistantConversation = InferSelectModel<typeof assistantConversations>;
