import { bigint, bigserial, index, integer, jsonb, text, timestamp, varchar, } from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";
export const marketingContentHistory = pgTable("marketing_content_history", {
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
}, table => [
    index("mch_company_id_idx").on(table.companyId),
    index("mch_platform_idx").on(table.platform),
]);
//# sourceMappingURL=schema.js.map