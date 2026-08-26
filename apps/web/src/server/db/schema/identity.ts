/**
 * Product schema: identity and workspace membership.
 *
 * Auth is the application's concern. @launchstack/core is keyed on `companyId`
 * and ships `company`; how a human authenticates and attaches to a workspace
 * lives here. May reference engine tables — never the reverse.
 */
import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    index,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { company } from "@launchstack/store/schema";

export const users = pgTable(
    "users",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        name: varchar("name", { length: 256 }).notNull(),
        email: varchar("email", { length: 256 }).notNull(),
        userId: varchar("userId", { length: 256 }).notNull().unique(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 256 }).notNull(),
        status: varchar("status", { length: 256 }).notNull(),
        lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companyIdIdx: index("users_company_id_idx").on(table.companyId),
        userIdIdx: index("users_user_id_idx").on(table.userId),
    })
);

// ============================================================================
// Company
// ============================================================================

export const inviteCodes = pgTable(
    "invite_codes",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        code: varchar("code", { length: 12 }).notNull().unique(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 256 }).notNull(), // "employer" or "employee"
        isActive: boolean("is_active").default(true).notNull(),
        createdBy: varchar("created_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        codeIdx: index("invite_codes_code_idx").on(table.code),
        companyIdIdx: index("invite_codes_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// User <-> Company Memberships
// ============================================================================
// Lets a user belong to multiple workspaces. `users.companyId` remains the
// user's *default* workspace; the active workspace per request is selected
// from this table via the active-workspace cookie.

export const userCompanyMemberships = pgTable(
    "user_company_memberships",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        userId: bigint("user_id", { mode: "bigint" })
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 16 }).notNull(), // 'owner' | 'admin' | 'editor'
        lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        uniqUserCompany: uniqueIndex("user_company_memberships_user_company_unique").on(
            table.userId,
            table.companyId
        ),
        userIdIdx: index("user_company_memberships_user_id_idx").on(table.userId),
        companyIdIdx: index("user_company_memberships_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// Document
// ============================================================================

export const userCompanyMembershipsRelations = relations(userCompanyMemberships, ({ one }) => ({
    user: one(users, {
        fields: [userCompanyMemberships.userId],
        references: [users.id],
    }),
    company: one(company, {
        fields: [userCompanyMemberships.companyId],
        references: [company.id],
    }),
}));

export const inviteCodesRelations = relations(inviteCodes, ({ one }) => ({
    company: one(company, {
        fields: [inviteCodes.companyId],
        references: [company.id],
    }),
}));

export const usersRelations = relations(users, ({ one }) => ({
    company: one(company, {
        fields: [users.companyId],
        references: [company.id],
    }),
}));

export type User = InferSelectModel<typeof users>;

export type InviteCode = InferSelectModel<typeof inviteCodes>;

export type UserCompanyMembership = InferSelectModel<typeof userCompanyMemberships>;
