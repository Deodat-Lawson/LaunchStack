/**
 * Drizzle schema for the Email Outreach Pipeline.
 *
 * Product-side tables: they reference the engine `company` table, never the
 * reverse. They live here rather than in apps/web because a package cannot
 * import from an app, and the vertical that queries them owns them. Applied by
 * the product migration set (apps/web/drizzle).
 *
 * A campaign holds the generated + reviewed template; recipients and
 * per-recipient sends hang off it; suppressions are per-company so an
 * unsubscribe/bounce is honored across all future campaigns.
 */

import {
  bigint,
  index,
  integer,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { company } from "@launchstack/core/db/schema";
import { pgTable } from "@launchstack/core/db/schema/helpers";

export const emailCampaigns = pgTable(
  "email_campaigns",
  {
    id: serial("id").primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    subject: text("subject"),
    body: text("body"),
    model: varchar("model", { length: 64 }),
    promptVersion: varchar("prompt_version", { length: 32 }),
    templateVersion: varchar("template_version", { length: 32 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("email_campaigns_company_idx").on(t.companyId)],
);

export const emailRecipients = pgTable(
  "email_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 256 }),
    company: varchar("company", { length: 256 }),
    contextNotes: text("context_notes"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("email_recipients_campaign_idx").on(t.campaignId)],
);

export const emailSends = pgTable(
  "email_sends",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
    subject: text("subject"),
    status: varchar("status", { length: 20 }).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 256 }),
    error: text("error"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("email_sends_campaign_idx").on(t.campaignId)],
);

export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: serial("id").primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" })
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    reason: varchar("reason", { length: 20 }).notNull().default("unsubscribe"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("email_suppressions_company_email_uq").on(t.companyId, t.email),
  ],
);
