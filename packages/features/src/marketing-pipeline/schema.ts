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
import { pgTable } from "@launchstack/core/db/schema/helpers";

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
        // Publish write-back (unification PR-6): the platform-native post id
        // and URL recorded when a row's content is actually published — the
        // key a future engagement read-back loop needs. NULL until published.
        postId: varchar("post_id", { length: 200 }),
        postUrl: varchar("post_url", { length: 500 }),
        publishedAt: timestamp("published_at"),
        impressions: integer("impressions"),
        engagements: integer("engagements"),
        clicks: integer("clicks"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    table => [
        index("mch_company_id_idx").on(table.companyId),
        index("mch_platform_idx").on(table.platform),
    ]
);
