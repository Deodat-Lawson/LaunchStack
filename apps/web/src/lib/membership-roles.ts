/**
 * Membership role vocabulary helpers.
 *
 * `user_company_memberships.role` is `owner` | `admin` | `editor`.
 * Do not compare against the legacy global `users.role` values
 * (`employer` / `employee`) — `requireWorkspaceContext` never returns those.
 *
 * Kept in a dependency-free module so client UI and API routes can share the
 * same gate without pulling in Clerk/DB.
 */

export const MANAGEMENT_ROLES = new Set(["owner", "admin"]);

/**
 * True when the membership role may manage workspace-wide configuration
 * (settings, invites, company-wide search, destructive document ops, etc.).
 * Editors work on documents; they do not pass this gate.
 */
export function isManagementRole(role: string): boolean {
  return MANAGEMENT_ROLES.has(role);
}
