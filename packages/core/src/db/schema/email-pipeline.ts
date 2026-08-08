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
import { pgTable } from "./helpers";

/**
 * Email outreach pipeline tables. A campaign holds the generated + reviewed
 * template; recipients and per-recipient sends hang off it; suppressions are
 * per-company so an unsubscribe/bounce is honored across all future campaigns.
 */

export const emailCampaigns = pgTable(
  "email_campaigns",
  {
    id: serial("id").primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull(),
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
    campaignId: integer("campaign_id").notNull(),
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
    campaignId: integer("campaign_id").notNull(),
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
    companyId: bigint("company_id", { mode: "bigint" }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    reason: varchar("reason", { length: 20 }).notNull().default("unsubscribe"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("email_suppressions_company_email_uq").on(t.companyId, t.email),
  ],
);
