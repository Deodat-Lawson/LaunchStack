import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "@launchstack/store/schema/helpers";
import { userCompanyMemberships } from "./identity";

/** Vantage-only selections; a deleted document leaves a removable missing-source selection. */
export const vantageDocumentStars = pgTable(
    "vantage_document_stars",
    {
        companyId: bigint("company_id", { mode: "bigint" }).notNull(),
        userId: bigint("user_id", { mode: "bigint" }).notNull(),
        // Deliberately retain identifiers after document/version deletion. Never store content here.
        documentId: bigint("document_id", { mode: "bigint" }).notNull(),
        lastKnownVersionId: bigint("last_known_version_id", { mode: "bigint" }).notNull(),
        starredAt: timestamp("starred_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => ({
        pk: primaryKey({ columns: [table.companyId, table.userId, table.documentId] }),
        membership: foreignKey({
            name: "vantage_stars_membership_fk",
            columns: [table.userId, table.companyId],
            foreignColumns: [userCompanyMemberships.userId, userCompanyMemberships.companyId],
        }).onDelete("cascade"),
        positiveIds: check(
            "vantage_stars_positive_ids",
            sql`${table.documentId} > 0 AND ${table.lastKnownVersionId} > 0`
        ),
    })
);
