import { sql } from "drizzle-orm";
import { jsonb, timestamp, varchar } from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";

import type { CatalogueProgram } from "./types";

/** Installation-wide public catalogue; it must never contain company answers or credentials. */
export const acceleratorPrograms = pgTable("accelerator_programs", {
    id: varchar("id", { length: 64 }).primaryKey(),
    program: jsonb("program").$type<CatalogueProgram>().notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
});
