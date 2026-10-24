/**
 * Product schema: what a workspace's AI model calls used, by day.
 *
 * The token ledger (`credits.ts`) is the balance: what a workspace is charged,
 * in units each feature chose, written by the few features that debit. This
 * is the meter: every chat completion the app makes for a workspace, counted
 * from the provider's own usage report as it passes the shared transport
 * (`@launchstack/llm`, usage-meter.ts), whichever feature made it. The two
 * answer different questions and neither writes the other.
 *
 * One row per workspace, day (UTC), feature, route, model and owner; each
 * call adds to it. `model_id` is kept for operators and never shown on screen.
 * `cost_usd` sums only the calls whose model declared a price; `priced_calls`
 * says how many those were, so a partly priced row is not read as complete.
 * `owner` separates calls to the deployment's endpoint from calls to one the
 * workspace brought (and pays for itself). The row key leads with workspace
 * and day, so it also serves the usage page's window query.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    date,
    integer,
    numeric,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company } from "@launchstack/store/schema";

export const aiUsageDaily = pgTable(
    "ai_usage_daily",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        date: date("date").notNull(),
        feature: varchar("feature", { length: 50 }).notNull(),
        /** default | fast | reasoning | vision | auxiliary; empty when unknown. */
        route: varchar("route", { length: 20 }).default("").notNull(),
        /** Empty when the transport could not tell. */
        modelId: varchar("model_id", { length: 200 }).default("").notNull(),
        /** deployment | workspace */
        owner: varchar("owner", { length: 20 }).notNull(),
        calls: integer("calls").default(0).notNull(),
        inputTokens: bigint("input_tokens", { mode: "number" }).default(0).notNull(),
        outputTokens: bigint("output_tokens", { mode: "number" }).default(0).notNull(),
        reasoningTokens: bigint("reasoning_tokens", { mode: "number" }).default(0).notNull(),
        cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).default(0).notNull(),
        pricedCalls: integer("priced_calls").default(0).notNull(),
        costUsd: numeric("cost_usd", { precision: 20, scale: 10 }).default("0").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        rowKey: uniqueIndex("ai_usage_daily_row_key").on(
            table.companyId,
            table.date,
            table.feature,
            table.route,
            table.modelId,
            table.owner
        ),
    })
);

export type AiUsageDaily = InferSelectModel<typeof aiUsageDaily>;
