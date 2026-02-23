import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    index,
    jsonb,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

import type { SearchCategory, SearchResult } from "~/server/trend-search/types";
import { company } from "./base";
import { pgTable } from "./helpers";

export const trendSearchJobStatusEnum = [
    "queued",
    "planning",
    "searching",
    "synthesizing",
    "completed",
    "failed",
] as const;

export const trendSearchJobs = pgTable(
    "trend_search_jobs",
    {
        id: varchar("id", { length: 256 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),
        status: varchar("status", {
            length: 50,
            enum: trendSearchJobStatusEnum,
        })
            .notNull()
            .default("queued"),
        query: text("query").notNull(),
        companyContext: text("company_context").notNull(),
        categories: jsonb("categories").$type<SearchCategory[]>(),
        results: jsonb("results").$type<SearchResult[]>(),
        errorMessage: text("error_message"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date()
        ),
    },
    (table) => ({
        companyIdIdx: index("trend_search_jobs_company_id_idx").on(table.companyId),
        statusIdx: index("trend_search_jobs_status_idx").on(table.status),
        companyStatusIdx: index("trend_search_jobs_company_status_idx").on(
            table.companyId,
            table.status
        ),
    })
);

export type TrendSearchJob = InferSelectModel<typeof trendSearchJobs>;
