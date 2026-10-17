/**
 * Product schema: a workspace's own AI model endpoint.
 *
 * By default every workspace's chat runs on the deployment's endpoint
 * (CHAT_BASE_URL, see docs/chat-models.md). A workspace admin can instead
 * bring their own OpenAI-compatible endpoint — an API key from a provider, or
 * an OpenRouter account connected in one click — and then everything the
 * workspace runs (Ask, drafting, meetings, background jobs) goes there.
 *
 * One row per workspace. The key is AES-256-GCM ciphertext from the secret
 * box (`@launchstack/store/crypto`), with its last four characters kept for
 * the "ending ab12" label. The URL and model choices are not secret.
 *
 * `models` is null while the endpoint is connected but no model is chosen yet
 * (right after an OpenRouter connect). The workspace keeps the deployment's
 * models until it is set: saving a model is what switches it over.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { bigint, jsonb, smallint, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company } from "@launchstack/store/schema";

import { users } from "./identity";

/** How the credential arrived. */
export const WORKSPACE_MODEL_CONNECTIONS = ["key", "openrouter"] as const;
export type WorkspaceModelConnection = (typeof WORKSPACE_MODEL_CONNECTIONS)[number];

/** One model the workspace chose, with what the admin said it can do. */
export interface WorkspaceModelChoice {
    /** The id the endpoint serves, exactly as the provider spells it. */
    id: string;
    /** Takes image input. Ignored when the id matches a verified preset. */
    vision: boolean;
    /** Reasons on its own. Ignored when the id matches a verified preset. */
    reasoning: boolean;
}

/** Which model does which kind of work. Unset routes use `default`. */
export interface WorkspaceModelSelection {
    default: WorkspaceModelChoice;
    fast?: WorkspaceModelChoice;
    reasoning?: WorkspaceModelChoice;
    vision?: WorkspaceModelChoice;
}

export const workspaceModelEndpoints = pgTable("workspace_model_endpoints", {
    companyId: bigint("company_id", { mode: "number" })
        .primaryKey()
        .references(() => company.id, { onDelete: "cascade" }),
    /** Which provider the admin picked in Settings. Only labels the form. */
    provider: varchar("provider", { length: 32 }).notNull(),
    baseUrl: text("base_url").notNull(),
    /** Null for a keyless endpoint (a self-hosted server that takes none). */
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyLast4: varchar("api_key_last4", { length: 8 }),
    encryptionKeyVersion: smallint("encryption_key_version").notNull().default(1),
    models: jsonb("models").$type<WorkspaceModelSelection>(),
    connectedVia: varchar("connected_via", { length: 16 })
        .$type<WorkspaceModelConnection>()
        .notNull()
        .default("key"),
    updatedByUserId: bigint("updated_by_user_id", { mode: "number" }).references(() => users.id, {
        onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
});

export type WorkspaceModelEndpointRow = InferSelectModel<typeof workspaceModelEndpoints>;
