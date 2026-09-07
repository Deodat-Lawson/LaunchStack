import { sql } from "drizzle-orm";
import { bigint, jsonb, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { pgTable } from "./helpers";

/**
 * Any JSON-serialisable resume point. Concrete backfills pick their own shape
 * — usually the last primary key handled.
 */
export type BackfillCursor =
    | string
    | number
    | boolean
    | null
    | { [key: string]: BackfillCursor }
    | BackfillCursor[];

/**
 * Ledger for data backfills.
 *
 * Backfills are deliberately NOT migrations. A migration is DDL: ordered,
 * immutable, replayed in full on every clean database, and cheap because the
 * tables it touches are empty. A backfill rewrites existing rows — it is
 * unbounded, restartable, and meaningless on a fresh database.
 *
 * Mixing them is what produced the old `0012`/`0014`/`0015` files (UPDATE and
 * a PL/pgSQL DO block inside schema migrations) and a container CMD that
 * re-scanned every document on every boot.
 *
 * `cursor` holds a keyset resume point so an interrupted run continues rather
 * than restarting, and a completed backfill is a no-op on re-run.
 */
export const dataBackfills = pgTable("data_backfills", {
    /** Stable identifier, e.g. "2026-08-note-embeddings". Never reused. */
    id: varchar("id", { length: 128 }).primaryKey(),
    /** pending | running | done | failed */
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    /** Opaque keyset resume point, written after each batch. */
    cursor: jsonb("cursor").$type<BackfillCursor>(),
    processed: bigint("processed", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
});
