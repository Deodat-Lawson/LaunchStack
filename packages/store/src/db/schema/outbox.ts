/**
 * Transactional event outbox for the ingestion pipeline (ADR-003).
 *
 * A state change and the event announcing it are written in ONE transaction;
 * `apps/worker` claims pending rows with `FOR UPDATE SKIP LOCKED` and
 * executes the handler. This generalizes the founder-weekly-review dispatch
 * outbox (the repo's proven pattern) to the whole ingestion pipeline.
 *
 * Payloads must validate against `@launchstack/protocol`'s pipelineEvent
 * schema — the adapter layer enforces this on both write and read, so a
 * malformed row is a bug surfaced at the boundary, not deep in a handler.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "./helpers";
import { company } from "./base";

/**
 * `pending`    — awaiting a worker claim (respecting availableAt backoff).
 * `processing` — claimed by a worker; reclaimed if the claim goes stale.
 * `processed`  — handler completed; kept for audit/replay.
 * `dead`       — attempts exhausted; visible for operator replay
 *                (docs/runbooks/outbox.md).
 */
export const eventOutboxStatusEnum = ["pending", "processing", "processed", "dead"] as const;
export type EventOutboxStatus = (typeof eventOutboxStatusEnum)[number];

export const eventOutbox = pgTable(
    "event_outbox",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        /**
         * Deterministic idempotency key (see protocol `eventIds`). A retried
         * producer transaction conflicts here and converges instead of
         * double-enqueueing.
         */
        eventId: varchar("event_id", { length: 160 }).notNull(),
        eventType: varchar("event_type", { length: 64 }).notNull(),
        schemaVersion: integer("schema_version").notNull(),
        companyId: bigint("company_id", { mode: "number" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Full event envelope JSON, validated against the protocol schema. */
        payload: jsonb("payload").notNull(),
        traceId: varchar("trace_id", { length: 128 }).notNull(),
        status: varchar("status", { length: 16, enum: eventOutboxStatusEnum })
            .notNull()
            .default("pending"),
        attemptCount: integer("attempt_count").notNull().default(0),
        /** Not-before time — exponential backoff writes the next retry here. */
        availableAt: timestamp("available_at", { withTimezone: true })
            .notNull()
            .default(sql`CURRENT_TIMESTAMP`),
        /** Set when a worker claims the row; stale claims get reclaimed. */
        claimedAt: timestamp("claimed_at", { withTimezone: true }),
        processedAt: timestamp("processed_at", { withTimezone: true }),
        lastError: text("last_error"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .default(sql`CURRENT_TIMESTAMP`),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        eventIdUnique: uniqueIndex("event_outbox_event_id_unique").on(table.eventId),
        /** Scan path for the worker's claim query. */
        pendingIdx: index("event_outbox_pending_idx").on(
            table.status,
            table.availableAt,
            table.createdAt
        ),
        /** Reclaim path for stale `processing` rows after a worker crash. */
        claimedIdx: index("event_outbox_claimed_idx").on(table.status, table.claimedAt),
        companyIdx: index("event_outbox_company_id_idx").on(table.companyId),
    })
);

export type EventOutboxRow = InferSelectModel<typeof eventOutbox>;
