import { sql, type InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";

export const marketingContentHistory = pgTable(
    "marketing_content_history",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        platform: varchar("platform", { length: 20 }).notNull(),
        message: text("message").notNull(),
        angle: varchar("angle", { length: 500 }),
        contentType: varchar("content_type", { length: 50 }).default("post"),
        metadata: jsonb("metadata"),
        impressions: integer("impressions"),
        engagements: integer("engagements"),
        clicks: integer("clicks"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        // Publish write-back (unification PR-6): the platform-native post id
        // and URL recorded when a row's content is actually published — the
        // key a future engagement read-back loop needs. NULL until published.
        //
        // Declared LAST to match the physical column order: the migration
        // (20260822235519) ADDs these to an existing table, so the database
        // appends them — and the migrations-vs-TypeScript parity gate diffs
        // pg_dump output, where order is part of the contract.
        postId: varchar("post_id", { length: 200 }),
        postUrl: varchar("post_url", { length: 500 }),
        publishedAt: timestamp("published_at"),
    },
    table => [
        index("mch_company_id_idx").on(table.companyId),
        index("mch_platform_idx").on(table.platform),
    ]
);

// ─── Brand posts ─────────────────────────────────────────────────────────────

/**
 * A post's life: composed as a draft or straight to scheduled; the scheduler
 * claims it (publishing) with one conditional update so two schedulers never
 * post twice; then published or failed. Cancelled keeps the row for the
 * calendar's record.
 */
export const BRAND_POST_STATUSES = [
    "draft",
    "scheduled",
    "publishing",
    "published",
    "failed",
    "cancelled",
] as const;
export type BrandPostStatus = (typeof BRAND_POST_STATUSES)[number];

/** Where a post came from, for the calendar and the generator's memory. */
export interface BrandPostSource {
    kind: "compose" | "campaign";
    /** The marketing_content_history row a campaign post was drafted from. */
    historyId?: number;
}

/**
 * One row per network per composed message: a message sent to three networks
 * is three rows that succeed, fail and appear on the calendar independently.
 */
export const brandPosts = pgTable(
    "brand_posts",
    {
        id: varchar("id", { length: 64 }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
        platform: varchar("platform", { length: 20 }).notNull(),
        body: text("body").notNull(),
        /** Reddit self-post title; other networks ignore it. */
        title: varchar("title", { length: 300 }),
        status: varchar("status", { length: 20, enum: BRAND_POST_STATUSES })
            .notNull()
            .default("draft"),
        scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
        publishedAt: timestamp("published_at", { withTimezone: true }),
        postId: varchar("post_id", { length: 200 }),
        postUrl: varchar("post_url", { length: 500 }),
        /** The last failure, kept so the calendar can say why. */
        error: text("error"),
        source: jsonb("source").$type<BrandPostSource>(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => [
        index("brand_posts_company_status_idx").on(table.companyId, table.status),
        index("brand_posts_company_scheduled_idx").on(table.companyId, table.scheduledAt),
        index("brand_posts_due_idx").on(table.status, table.scheduledAt),
    ]
);
export type BrandPostRow = InferSelectModel<typeof brandPosts>;

