import { bigint, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const marketingContentHistory = pgTable(
    "marketing_content_history",
    {
        id: serial("id").primaryKey(),
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
    },
    (table) => [
        index("mch_company_id_idx").on(table.companyId),
        index("mch_platform_idx").on(table.platform),
    ],
);
