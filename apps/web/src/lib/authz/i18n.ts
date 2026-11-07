/**
 * Role names, role descriptions and permission descriptions in the reader's
 * language.
 *
 * `./permissions` keeps its English (`ROLE_LABELS`, `ROLE_DESCRIPTIONS`,
 * `PERMISSION_DESCRIPTIONS`) for the server, the API and the audit log; a
 * screen reads the same words from `team.roles.<role>` and
 * `team.permissions.<permission>` (the permission's dots are the nesting)
 * through these hooks. Client-safe: no database, no auth.
 */

import { useTranslations } from "next-intl";

import { isBuiltinRole, normalizeRoleSlug, type BuiltinRole, type Permission } from "./permissions";

export type TeamTranslator = ReturnType<typeof useTranslations<"team">>;

/** A built-in role's name; a custom role keeps its own name (or its slug). */
export function translateRoleLabel(
    t: TeamTranslator,
    slug: string,
    customName?: string | null
): string {
    const normalized = normalizeRoleSlug(slug);
    if (isBuiltinRole(normalized)) return t(`roles.${normalized}.label`);
    return customName ?? slug;
}

/** What a built-in role may do, in a sentence. */
export function translateRoleDescription(t: TeamTranslator, role: BuiltinRole): string {
    return t(`roles.${role}.description`);
}

/** What a permission lets a person do, in their words. */
export function translatePermission(t: TeamTranslator, permission: Permission): string {
    return t(`permissions.${permission}`);
}

/** `roleLabel` in the reader's language: `useRoleLabel()(slug, customName)`. */
export function useRoleLabel(): (slug: string, customName?: string | null) => string {
    const t = useTranslations("team");
    return (slug, customName) => translateRoleLabel(t, slug, customName);
}

/** `ROLE_DESCRIPTIONS[role]` in the reader's language; null for a custom slug. */
export function useRoleDescription(): (slug: string) => string | null {
    const t = useTranslations("team");
    return slug => {
        const normalized = normalizeRoleSlug(slug);
        return isBuiltinRole(normalized) ? translateRoleDescription(t, normalized) : null;
    };
}

/** `PERMISSION_DESCRIPTIONS[permission]` in the reader's language. */
export function usePermissionCopy(): (permission: Permission) => string {
    const t = useTranslations("team");
    return permission => translatePermission(t, permission);
}
