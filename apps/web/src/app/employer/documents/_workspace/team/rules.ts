/**
 * The client's copy of who may start a group (ADR-014): the server's
 * `canCreateGroups` decides, this only hides a button that would 403.
 */

import { normalizeRoleSlug, type Permission } from "~/lib/authz/permissions";

export function mayCreateGroups(
    can: (permission: Permission | undefined) => boolean,
    role: string | null
): boolean {
    if (can("groups.manage")) return true;
    return can("members.view") && role !== null && normalizeRoleSlug(role) !== "guest";
}
