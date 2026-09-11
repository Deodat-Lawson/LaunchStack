/**
 * The closed audit action vocabulary. Dependency-free so the client can
 * render sentences and filters from the same list the server writes.
 */

export const AUDIT_ACTIONS = [
    "member.invited",
    "member.joined",
    "member.approved",
    "member.role_changed",
    "member.suspended",
    "member.reinstated",
    "member.removed",
    "member.left",
    "ownership.transferred",
    "invitation.resent",
    "invitation.revoked",
    "join_link.created",
    "join_link.revoked",
    "group.created",
    "group.updated",
    "group.deleted",
    "group.member_added",
    "group.member_removed",
    "role.created",
    "role.updated",
    "role.deleted",
    "folder.created",
    "folder.renamed",
    "folder.deleted",
    "folder.visibility_changed",
    "folder.grant_added",
    "folder.grant_changed",
    "folder.grant_removed",
    "document.restricted",
    "document.unrestricted",
    "document.grant_added",
    "document.grant_changed",
    "document.grant_removed",
    "document.deleted",
    "connector.connected",
    "connector.disconnected",
    "settings.changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: unknown): value is AuditAction {
    return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}
