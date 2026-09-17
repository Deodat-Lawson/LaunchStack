/**
 * Product schema: scoped settings values.
 *
 * One row per (scope, key). Scope is the ladder the resolver walks —
 * `workspace` (scope id empty), `folder` (scope id is the folder path) or
 * `member` (scope id is the auth user id). The value is JSON validated by the
 * setting's own schema in `~/lib/settings/registry` before it is written, so
 * a row never holds a shape the panel could not have produced.
 *
 * Secrets never live here: this table is read back to the browser verbatim.
 * Credentials keep their own encrypted columns with a redacted read path.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    index,
    jsonb,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company } from "@launchstack/store/schema";

export const settingsValues = pgTable(
    "settings_values",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** `workspace` | `folder` | `member`. */
        scopeType: varchar("scope_type", { length: 16 }).notNull(),
        /** Empty for workspace, folder path for folder, auth user id for member. */
        scopeId: varchar("scope_id", { length: 256 }).notNull().default(""),
        key: varchar("key", { length: 128 }).notNull(),
        value: jsonb("value").$type<unknown>().notNull(),
        /** Auth subject id of whoever last wrote the row. */
        updatedBy: varchar("updated_by", { length: 256 }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        scopeKeyUnique: uniqueIndex("settings_values_scope_key_idx").on(
            table.companyId,
            table.scopeType,
            table.scopeId,
            table.key
        ),
        companyKeyIdx: index("settings_values_company_key_idx").on(table.companyId, table.key),
    })
);

export type SettingsValueRow = InferSelectModel<typeof settingsValues>;
