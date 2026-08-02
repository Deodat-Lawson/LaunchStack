import { integer, jsonb, serial, text, timestamp, varchar, varchar as _varchar } from "drizzle-orm/pg-core";
import { pgTable } from "./helpers";

export const ocrOutbox = pgTable("ocr_outbox", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 256 }).notNull(),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 32, enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  attemptCount: integer("attempt_count").default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
  eventIds: jsonb("event_ids"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
});

export type OcrOutboxRecord = typeof ocrOutbox.$inferSelect;
