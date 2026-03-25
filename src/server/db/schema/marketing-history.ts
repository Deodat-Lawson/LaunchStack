import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    index,
    integer,
    jsonb,
    serial,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

import { company } from "./base";
import { pgTable } from "./helpers";

export const marketingContentHistory = pgTable(
    "marketing_content_history",
    {
        id: serial("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 256 }).notNull(),
        platform: varchar("platform", { length: 50 }).notNull(),
        content: text("content").notNull(),
        angle: text("angle"),
        contentType: varchar("content_type", { length: 50 }).default("post"),
        published: integer("published").default(0).notNull(),
        metrics: jsonb("metrics").$type<{
            impressions?: number;
            engagements?: number;
            clicks?: number;
        }>(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
            () => new Date(),
        ),
    },
    (table) => ({
        companyIdIdx: index("mch_company_id_idx").on(table.companyId),
        platformIdx: index("mch_platform_idx").on(table.platform),
        companyPlatformIdx: index("mch_company_platform_idx").on(
            table.companyId,
            table.platform,
        ),
    }),
);

export type MarketingContentHistoryRow = InferSelectModel<typeof marketingContentHistory>;
