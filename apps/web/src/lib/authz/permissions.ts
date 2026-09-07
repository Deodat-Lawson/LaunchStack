/**
 * The permission catalogue and the built-in roles.
 *
 * Permissions are the atoms; a role is a named set of them. The built-in
 * roles are code, not rows, so a new workspace needs no seeding and "Admin"
 * means the same thing in every tenant. Custom roles are `workspace_roles`
 * rows whose `permissions` column holds strings from this catalogue.
 *
 * Dependency-free on purpose: client components and API routes share this
 * one vocabulary without pulling in auth or database modules.
 */

export const PERMISSIONS = [
    "documents.read",
    "documents.upload",
    "documents.edit",
    "documents.delete",
    "folders.manage",
    "members.view",
    "members.invite",
    "members.manage",
    "groups.manage",
    "roles.manage",
    "settings.manage",
    "connectors.manage",
    "analytics.view",
    "audit.view",
    "campaigns.send",
    "billing.manage",
    "workspace.transfer",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** What each permission lets a person do, in their words. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
    "documents.read": "Open, search, ask about, and download documents in folders they can see",
    "documents.upload": "Add documents and new versions into folders they can edit",
    "documents.edit": "Rename, move, edit, and revert documents in folders they can edit",
    "documents.delete": "Delete documents and versions",
    "folders.manage": "Create, rename, and delete folders; change who can see any folder",
    "members.view": "See who is in the workspace",
    "members.invite": "Send invitations and create join links",
    "members.manage": "Approve, change roles, suspend, and remove members",
    "groups.manage": "Create groups and change their membership",
    "roles.manage": "Create and edit custom roles",
    "settings.manage": "Workspace settings, processing, company profile, agents and nodes",
    "connectors.manage": "Connect and disconnect Google Drive, Slack, GitHub, and agent connectors",
    "analytics.view": "The statistics dashboard and per-document stats",
    "audit.view": "Read the audit log",
    "campaigns.send": "Approve and send email campaigns",
    "billing.manage": "Credits, plan, and keys that cost money",
    "workspace.transfer": "Transfer ownership or delete the workspace",
};

/** Never assignable to a custom role, and never held by anyone but an Owner. */
export const OWNER_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
    "billing.manage",
    "workspace.transfer",
]);

// ---------------------------------------------------------------------------
// Built-in roles
// ---------------------------------------------------------------------------

export const BUILTIN_ROLES = ["owner", "admin", "member", "viewer", "guest"] as const;
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

export const ROLE_LABELS: Record<BuiltinRole, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
    viewer: "Viewer",
    guest: "Guest",
};

export const ROLE_DESCRIPTIONS: Record<BuiltinRole, string> = {
    owner: "Everything, including billing and ownership.",
    admin: "Runs the workspace: people, folders, settings, connectors.",
    member: "Works on documents: upload, edit, search, ask.",
    viewer: "Reads and searches, never changes.",
    guest: "Sees only the folders they have been added to.",
};

const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(PERMISSIONS);
const ADMIN_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(
    PERMISSIONS.filter(p => !OWNER_ONLY_PERMISSIONS.has(p))
);
const MEMBER_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
    "documents.read",
    "documents.upload",
    "documents.edit",
    "members.view",
]);
const VIEWER_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
    "documents.read",
    "members.view",
]);
const GUEST_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(["documents.read"]);

export const BUILTIN_ROLE_PERMISSIONS: Record<BuiltinRole, ReadonlySet<Permission>> = {
    owner: ALL_PERMISSIONS,
    admin: ADMIN_PERMISSIONS,
    member: MEMBER_PERMISSIONS,
    viewer: VIEWER_PERMISSIONS,
    guest: GUEST_PERMISSIONS,
};

/**
 * Slugs the database may still carry from before the catalogue existed.
 * `editor` was the pre-catalogue name for Member; the two others are the
 * retired global `users.role` vocabulary, mapped the way the old invite
 * paths mapped them (minus the owner-minting bug).
 */
export const LEGACY_ROLE_ALIASES: Readonly<Record<string, BuiltinRole>> = {
    editor: "member",
    employer: "admin",
    employee: "member",
};

/** Maps a legacy slug to its built-in equivalent; returns anything else unchanged. */
export function normalizeRoleSlug(slug: string): string {
    const trimmed = slug.trim().toLowerCase();
    return LEGACY_ROLE_ALIASES[trimmed] ?? trimmed;
}

export function isBuiltinRole(slug: string): slug is BuiltinRole {
    return (BUILTIN_ROLES as readonly string[]).includes(slug);
}

/** The permission set of a built-in role (legacy aliases included), or null for a custom slug. */
export function builtinRolePermissions(slug: string): ReadonlySet<Permission> | null {
    const normalized = normalizeRoleSlug(slug);
    return isBuiltinRole(normalized) ? BUILTIN_ROLE_PERMISSIONS[normalized] : null;
}

export function isPermission(value: unknown): value is Permission {
    return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Keeps only catalogue permissions; a custom role that names something we no longer know loses it. */
export function permissionsFromList(list: readonly unknown[]): Set<Permission> {
    const out = new Set<Permission>();
    for (const value of list) if (isPermission(value)) out.add(value);
    return out;
}

export function isSubset(subset: ReadonlySet<Permission>, of: ReadonlySet<Permission>): boolean {
    for (const p of subset) if (!of.has(p)) return false;
    return true;
}

/**
 * Display order. Custom roles sort by how much they may do; built-ins by
 * their conventional order regardless of size.
 */
export function roleRank(slug: string, permissions?: ReadonlySet<Permission>): number {
    const normalized = normalizeRoleSlug(slug);
    switch (normalized) {
        case "owner":
            return 1000;
        case "admin":
            return 900;
        case "member":
            return 500;
        case "viewer":
            return 300;
        case "guest":
            return 100;
        default:
            return permissions ? 500 + permissions.size : 400;
    }
}

export function roleLabel(slug: string, customName?: string | null): string {
    const normalized = normalizeRoleSlug(slug);
    if (isBuiltinRole(normalized)) return ROLE_LABELS[normalized];
    return customName ?? slug;
}

// ---------------------------------------------------------------------------
// Membership, grants, principals, workspace policy
// ---------------------------------------------------------------------------

export const MEMBERSHIP_STATUSES = ["pending", "active", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function isMembershipStatus(value: unknown): value is MembershipStatus {
    return typeof value === "string" && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

export const GRANT_LEVELS = ["view", "edit", "manage"] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];

export function isGrantLevel(value: unknown): value is GrantLevel {
    return typeof value === "string" && (GRANT_LEVELS as readonly string[]).includes(value);
}

export function grantLevelRank(level: GrantLevel): number {
    return level === "manage" ? 3 : level === "edit" ? 2 : 1;
}

export function grantLevelAtLeast(level: GrantLevel, required: GrantLevel): boolean {
    return grantLevelRank(level) >= grantLevelRank(required);
}

export const PRINCIPAL_TYPES = ["user", "group", "role"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export function isPrincipalType(value: unknown): value is PrincipalType {
    return typeof value === "string" && (PRINCIPAL_TYPES as readonly string[]).includes(value);
}

export const JOIN_POLICIES = ["approval", "open"] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export function isJoinPolicy(value: unknown): value is JoinPolicy {
    return typeof value === "string" && (JOIN_POLICIES as readonly string[]).includes(value);
}

export const FOLDER_VISIBILITIES = ["workspace", "restricted"] as const;
export type FolderVisibility = (typeof FOLDER_VISIBILITIES)[number];

/** Roles a join link or an invitation may hand out. Never an owner. */
export const INVITABLE_BUILTIN_ROLES: readonly BuiltinRole[] = [
    "admin",
    "member",
    "viewer",
    "guest",
];
