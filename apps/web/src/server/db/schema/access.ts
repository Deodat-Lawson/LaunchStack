/**
 * Product schema: workspace access — settings, custom roles, groups,
 * invitations, folder and document grants, and the audit log.
 *
 * Every table here is product-side and points at engine tables (`company`,
 * `category`, `document`); nothing points back. The permission vocabulary the
 * rows refer to lives in `~/lib/authz/permissions`.
 *
 * Folder access keys on the engine `category` row — the folder *is* the
 * category. A folder with no `folder_settings` row is visible to the whole
 * workspace, so a workspace that never restricts anything has no rows here.
 */
import { relations, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
    bigint,
    bigserial,
    boolean,
    index,
    integer,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";
import { category, company, document } from "@launchstack/store/schema";

import { users } from "./identity";

// ============================================================================
// Workspace settings
// ============================================================================

export const workspaceSettings = pgTable("workspace_settings", {
    companyId: bigint("company_id", { mode: "bigint" })
        .primaryKey()
        .references(() => company.id, { onDelete: "cascade" }),
    /** `approval` (join links land pending) | `open` (join links land active). */
    joinPolicy: varchar("join_policy", { length: 16 }).default("approval").notNull(),
    /** Null means keep audit events forever. */
    auditRetentionDays: integer("audit_retention_days"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
});

// ============================================================================
// Custom roles
// ============================================================================

export const workspaceRoles = pgTable(
    "workspace_roles",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Referenced by `user_company_memberships.role`. Never a built-in slug. */
        slug: varchar("slug", { length: 64 }).notNull(),
        name: varchar("name", { length: 120 }).notNull(),
        description: text("description"),
        /** Permission strings from the catalogue; unknown values are ignored at resolve time. */
        permissions: text("permissions")
            .array()
            .notNull()
            .default(sql`'{}'::text[]`),
        createdBy: varchar("created_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companySlugUnique: uniqueIndex("workspace_roles_company_slug_unique").on(
            table.companyId,
            table.slug
        ),
        companyIdIdx: index("workspace_roles_company_id_idx").on(table.companyId),
    })
);

// ============================================================================
// Groups
// ============================================================================

export const workspaceGroups = pgTable(
    "workspace_groups",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 120 }).notNull(),
        slug: varchar("slug", { length: 64 }).notNull(),
        description: text("description"),
        createdBy: varchar("created_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
    },
    table => ({
        companySlugUnique: uniqueIndex("workspace_groups_company_slug_unique").on(
            table.companyId,
            table.slug
        ),
        companyIdIdx: index("workspace_groups_company_id_idx").on(table.companyId),
    })
);

export const workspaceGroupMembers = pgTable(
    "workspace_group_members",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        groupId: bigint("group_id", { mode: "bigint" })
            .notNull()
            .references(() => workspaceGroups.id, { onDelete: "cascade" }),
        userId: bigint("user_id", { mode: "bigint" })
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        addedBy: varchar("added_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        groupUserUnique: uniqueIndex("workspace_group_members_group_user_unique").on(
            table.groupId,
            table.userId
        ),
        userIdIdx: index("workspace_group_members_user_id_idx").on(table.userId),
    })
);

// ============================================================================
// Email invitations
// ============================================================================
// The token itself is never stored — only its SHA-256. An invitation is
// pre-approval: accepting it creates an `active` membership.

export const workspaceInvitations = pgTable(
    "workspace_invitations",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        email: varchar("email", { length: 256 }).notNull(),
        role: varchar("role", { length: 64 }).notNull(),
        groupIds: bigint("group_ids", { mode: "bigint" })
            .array()
            .notNull()
            .default(sql`'{}'::bigint[]`),
        tokenHash: varchar("token_hash", { length: 64 }).notNull(),
        invitedBy: varchar("invited_by", { length: 256 }).notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        acceptedAt: timestamp("accepted_at", { withTimezone: true }),
        acceptedByUserId: bigint("accepted_by_user_id", { mode: "bigint" }),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        tokenHashUnique: uniqueIndex("workspace_invitations_token_hash_unique").on(table.tokenHash),
        companyIdIdx: index("workspace_invitations_company_id_idx").on(table.companyId),
        emailIdx: index("workspace_invitations_email_idx").on(table.email),
    })
);

// ============================================================================
// Folder access
// ============================================================================

export const folderSettings = pgTable(
    "folder_settings",
    {
        categoryId: bigint("category_id", { mode: "bigint" })
            .primaryKey()
            .references(() => category.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Only `restricted` rows exist; a missing row means workspace-visible. */
        visibility: varchar("visibility", { length: 16 }).default("restricted").notNull(),
        updatedBy: varchar("updated_by", { length: 256 }).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        companyIdIdx: index("folder_settings_company_id_idx").on(table.companyId),
    })
);

export const folderGrants = pgTable(
    "folder_grants",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        categoryId: bigint("category_id", { mode: "bigint" })
            .notNull()
            .references(() => category.id, { onDelete: "cascade" }),
        /** `user` (users.id) | `group` (workspace_groups.id) | `role` (role slug). */
        principalType: varchar("principal_type", { length: 16 }).notNull(),
        principalId: varchar("principal_id", { length: 64 }).notNull(),
        /** `view` | `edit` | `manage`. */
        level: varchar("level", { length: 16 }).notNull(),
        grantedBy: varchar("granted_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        principalUnique: uniqueIndex("folder_grants_category_principal_unique").on(
            table.categoryId,
            table.principalType,
            table.principalId
        ),
        companyIdIdx: index("folder_grants_company_id_idx").on(table.companyId),
        principalIdx: index("folder_grants_principal_idx").on(
            table.principalType,
            table.principalId
        ),
    })
);

// ============================================================================
// Document access (the exception mechanism)
// ============================================================================

export const documentSettings = pgTable(
    "document_settings",
    {
        documentId: bigint("document_id", { mode: "bigint" })
            .primaryKey()
            .references(() => document.id, { onDelete: "cascade" }),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        restricted: boolean("restricted").default(true).notNull(),
        updatedBy: varchar("updated_by", { length: 256 }).notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        companyIdIdx: index("document_settings_company_id_idx").on(table.companyId),
    })
);

export const documentGrants = pgTable(
    "document_grants",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        documentId: bigint("document_id", { mode: "bigint" })
            .notNull()
            .references(() => document.id, { onDelete: "cascade" }),
        principalType: varchar("principal_type", { length: 16 }).notNull(),
        principalId: varchar("principal_id", { length: 64 }).notNull(),
        level: varchar("level", { length: 16 }).notNull(),
        grantedBy: varchar("granted_by", { length: 256 }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        principalUnique: uniqueIndex("document_grants_document_principal_unique").on(
            table.documentId,
            table.principalType,
            table.principalId
        ),
        companyIdIdx: index("document_grants_company_id_idx").on(table.companyId),
        principalIdx: index("document_grants_principal_idx").on(
            table.principalType,
            table.principalId
        ),
    })
);

// ============================================================================
// Audit log (append-only)
// ============================================================================

export const workspaceAuditEvents = pgTable(
    "workspace_audit_events",
    {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        companyId: bigint("company_id", { mode: "bigint" })
            .notNull()
            .references(() => company.id, { onDelete: "cascade" }),
        /** Auth subject id of the person who made the change. */
        actorUserId: varchar("actor_user_id", { length: 256 }).notNull(),
        action: varchar("action", { length: 64 }).notNull(),
        targetType: varchar("target_type", { length: 32 }).notNull(),
        targetId: varchar("target_id", { length: 64 }),
        detail: jsonb("detail").$type<Record<string, unknown>>(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        companyCreatedIdx: index("workspace_audit_events_company_created_idx").on(
            table.companyId,
            table.createdAt
        ),
        companyActionIdx: index("workspace_audit_events_company_action_idx").on(
            table.companyId,
            table.action
        ),
    })
);

// ============================================================================
// Relations
// ============================================================================

export const workspaceGroupsRelations = relations(workspaceGroups, ({ one, many }) => ({
    company: one(company, {
        fields: [workspaceGroups.companyId],
        references: [company.id],
    }),
    members: many(workspaceGroupMembers),
}));

export const workspaceGroupMembersRelations = relations(workspaceGroupMembers, ({ one }) => ({
    group: one(workspaceGroups, {
        fields: [workspaceGroupMembers.groupId],
        references: [workspaceGroups.id],
    }),
    user: one(users, {
        fields: [workspaceGroupMembers.userId],
        references: [users.id],
    }),
}));

export const folderSettingsRelations = relations(folderSettings, ({ one }) => ({
    category: one(category, {
        fields: [folderSettings.categoryId],
        references: [category.id],
    }),
}));

export const folderGrantsRelations = relations(folderGrants, ({ one }) => ({
    category: one(category, {
        fields: [folderGrants.categoryId],
        references: [category.id],
    }),
}));

export const documentSettingsRelations = relations(documentSettings, ({ one }) => ({
    document: one(document, {
        fields: [documentSettings.documentId],
        references: [document.id],
    }),
}));

export const documentGrantsRelations = relations(documentGrants, ({ one }) => ({
    document: one(document, {
        fields: [documentGrants.documentId],
        references: [document.id],
    }),
}));

// ============================================================================
// Type exports
// ============================================================================

export type WorkspaceSettings = InferSelectModel<typeof workspaceSettings>;
export type WorkspaceRole = InferSelectModel<typeof workspaceRoles>;
export type WorkspaceGroup = InferSelectModel<typeof workspaceGroups>;
export type WorkspaceGroupMember = InferSelectModel<typeof workspaceGroupMembers>;
export type WorkspaceInvitation = InferSelectModel<typeof workspaceInvitations>;
export type FolderSettings = InferSelectModel<typeof folderSettings>;
export type FolderGrant = InferSelectModel<typeof folderGrants>;
export type DocumentSettings = InferSelectModel<typeof documentSettings>;
export type DocumentGrant = InferSelectModel<typeof documentGrants>;
export type WorkspaceAuditEvent = InferSelectModel<typeof workspaceAuditEvents>;
