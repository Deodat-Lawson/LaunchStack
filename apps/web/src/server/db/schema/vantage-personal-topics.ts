import { sql } from "drizzle-orm";
import { company, document } from "@launchstack/store/schema/base";
import {
    bigint,
    check,
    integer,
    jsonb,
    text,
    timestamp,
    uuid,
    primaryKey,
    index,
} from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";
export const vantagePersonalTopics = pgTable(
    "vantage_personal_topics",
    {
        id: uuid("id").primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        ownerId: text("owner_id").notNull(),
        title: text("title").notNull(),
        guidance: jsonb("guidance").notNull(),
        status: text("status").notNull().default("active"),
        revision: integer("revision").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
        closedAt: timestamp("closed_at", { withTimezone: true }),
    },
    t => ({
        statusValid: check(
            "vantage_personal_topics_status_check",
            sql`${t.status} IN ('active','closed')`
        ),
        revisionValid: check("vantage_personal_topics_revision_check", sql`${t.revision}>0`),
        owner: index("vantage_personal_topics_owner").on(t.companyId, t.ownerId, t.status),
    })
);
export const vantagePersonalTopicWatches = pgTable(
    "vantage_personal_topic_watches",
    {
        topicId: uuid("topic_id")
            .notNull()
            .references(() => vantagePersonalTopics.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        ownerId: text("owner_id").notNull(),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    t => ({ pk: primaryKey({ columns: [t.topicId, t.documentId] }) })
);
