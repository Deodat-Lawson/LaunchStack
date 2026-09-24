/**
 * Product schema: identity and workspace membership.
 *
 * Auth is the application's concern. @launchstack/core is keyed on `companyId`
 * and ships `company`; how a human authenticates and attaches to a workspace
 * lives here. May reference engine tables — never the reverse.
 *
 * Authorization vocabulary lives in `~/lib/authz/permissions`: a membership
 * carries a role slug (built-in or a `workspace_roles` row) and a status; the
 * permission set is derived from the slug at request time.
 */
import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    customType,
    index,
    integer,
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
        // Legacy global role/status. Nothing reads these any more — the
        // membership row is the only source of truth per workspace. Defaults
        // exist so no writer has to name them; both columns are dropped once
        // a release has shipped with zero reads.
        role: varchar("role", { length: 256 }).notNull().default("member"),
        status: varchar("status", { length: 256 }).notNull().default("active"),
        lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),

        // The person's profile — the same in every workspace unless a
        // membership overrides it (see `userCompanyMemberships`). Limits
        // mirror `~/lib/profile/fields`. Declared last: ADD COLUMN appends
        // physically (see the note on `invite_codes`).
        displayName: varchar("display_name", { length: 80 }),
        title: varchar("title", { length: 100 }),
        pronouns: varchar("pronouns", { length: 40 }),
        timeZone: varchar("time_zone", { length: 64 }),
        bio: varchar("bio", { length: 280 }),
    },
    table => ({
        companyIdIdx: index("users_company_id_idx").on(table.companyId),
        userIdIdx: index("users_user_id_idx").on(table.userId),
    })
);

// ============================================================================
// Join links
// ============================================================================
// A shareable code that mints a membership in the role it carries. Never an
// owner. Expiry and use limits are checked at accept time.

export const inviteCodes = pgTable(
    "invite_codes",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        code: varchar("code", { length: 12 }).notNull().unique(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Membership role slug the link grants (`admin` | `member` | `viewer` | `guest` | custom). */
        role: varchar("role", { length: 256 }).notNull(),
        isActive: boolean("is_active").default(true).notNull(),
        createdBy: varchar("created_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),

        // Added after the table shipped, so declared last: ALTER TABLE ADD
        // COLUMN appends physically, and the migrations-apply job compares a
        // migrated database against a freshly-pushed one column by column.
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        maxUses: integer("max_uses"),
        useCount: integer("use_count").default(0).notNull(),
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
//
// `status` is per workspace: `pending` (awaiting approval), `active`, or
// `suspended` (row and grants kept, every request refused).

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
        /** Built-in slug (`owner` | `admin` | `member` | `viewer` | `guest`) or a `workspace_roles.slug`. */
        role: varchar("role", { length: 64 }).notNull(),
        lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),

        // Added after the table shipped — see the note on `invite_codes`.
        status: varchar("status", { length: 16 }).default("active").notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),

        // How this person appears in this workspace only. Null means "use my
        // profile". The photo override is a `profile_images` row keyed by
        // (user, company). Removed with the membership.
        profileDisplayName: varchar("profile_display_name", { length: 80 }),
        profileTitle: varchar("profile_title", { length: 100 }),
    },
    table => ({
        uniqUserCompany: uniqueIndex("user_company_memberships_user_company_unique").on(
            table.userId,
            table.companyId
        ),
        userIdIdx: index("user_company_memberships_user_id_idx").on(table.userId),
        companyIdIdx: index("user_company_memberships_company_id_idx").on(table.companyId),
        companyStatusIdx: index("user_company_memberships_company_status_idx").on(
            table.companyId,
            table.status
        ),
    })
);

// ============================================================================
// Profile photos
// ============================================================================
// Re-encoded server-side (square WebP, metadata stripped) and small, so the
// bytes live in Postgres rather than the document storage backend: every
// deployment serves them the same way, and they never pass through the
// company-scoped `/api/files` route, which could not show one person's photo
// in two workspaces.
//
// One row per scope: `company_id` null is the person's own photo; a set
// `company_id` is their photo for that workspace only. Replacing a photo
// inserts a new row with a new id, so `/api/profile-images/<id>` is
// immutable and cacheable forever.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "bytea",
});

export const profileImages = pgTable(
    "profile_images",
    {
        /** Random, URL-safe; the image URL is `/api/profile-images/<id>`. */
        id: varchar("id", { length: 32 }).primaryKey(),
        userId: bigint("user_id", { mode: "bigint" })
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        /** Null: shown wherever this person has no override. Set: that workspace only. */
        companyId: bigint("company_id", { mode: "bigint" }).references(() => company.id, {
            onDelete: "cascade",
        }),
        mimeType: varchar("mime_type", { length: 32 }).notNull(),
        data: bytea("data").notNull(),
        byteSize: integer("byte_size").notNull(),
        width: integer("width").notNull(),
        height: integer("height").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        /** One photo per person … */
        userGlobalUnique: uniqueIndex("profile_images_user_global_unique")
            .on(table.userId)
            .where(sql`company_id is null`),
        /** … and at most one override per workspace. */
        userCompanyUnique: uniqueIndex("profile_images_user_company_unique")
            .on(table.userId, table.companyId)
            .where(sql`company_id is not null`),
        companyIdIdx: index("profile_images_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// Relations
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

export type ProfileImage = InferSelectModel<typeof profileImages>;
