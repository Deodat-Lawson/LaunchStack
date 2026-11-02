import map from "./role-map.json";
import type { BusinessRoleContextV0 } from "../proposals/context-v0";

// Return copies so a consumer cannot mutate the shared mapping for another actor.
export const roleDirectoryV0 = () => ({
    ...map,
    roles: map.roles.map(role => ({
        ...role,
        aliases: [...role.aliases],
        responsibilities: [...role.responsibilities],
        agendaPriorities: [...role.agendaPriorities],
    })),
    fallback: {
        ...map.fallback,
        responsibilities: [...map.fallback.responsibilities],
        agendaPriorities: [...map.fallback.agendaPriorities],
    },
});
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export function canonicalRoleV0(value: string): string | undefined {
    const normalized = normalize(value);
    return map.roles.find(role => role.id === normalized || role.aliases.includes(normalized))?.id;
}

/** Exact controlled aliases only; title text is never used as an instruction or an ACL. */
export function resolveRoleSelectionV0(input: {
    principalRef: string;
    values: readonly string[];
    primaryRoleId?: string;
    confirmed: boolean;
}): BusinessRoleContextV0 {
    const ids = new Set(input.values.map(canonicalRoleV0).filter((id): id is string => !!id));
    const primary = input.primaryRoleId ? canonicalRoleV0(input.primaryRoleId) : undefined;
    const ordered = map.roles.filter(role => ids.has(role.id));
    if (primary && ids.has(primary))
        ordered.sort((a, b) => Number(b.id === primary) - Number(a.id === primary));
    const fallback = ids.size === 0 || input.values.some(value => !canonicalRoleV0(value));
    return {
        contractVersion: "v0-proposed",
        authenticatedPrincipalRef: input.principalRef,
        roleIds: ordered.map(role => role.id),
        ...(primary && ids.has(primary) ? { primaryRoleId: primary } : {}),
        mappingVersion: map.mapVersion,
        roles: ordered.map(role => ({
            roleId: role.id,
            description: role.description,
            responsibilities: [...role.responsibilities],
            priorities: [...role.agendaPriorities],
        })),
        provenance: {
            kind: fallback ? "fallback" : input.confirmed ? "user-confirmed" : "directory",
            source: fallback
                ? "Unrecognized or empty business identity; review roles."
                : input.confirmed
                  ? "Personal workspace role selection"
                  : "Existing profile title (unconfirmed)",
        },
        userConfirmed: input.confirmed,
        fallback,
    };
}

/** Primary perspective first, then stable directory order; duplicate priorities occur once. */
export function mergedRolePrioritiesV0(context: BusinessRoleContextV0): string[] {
    return [
        ...new Set(
            context.roles
                .flatMap(role => role.priorities)
                .concat(context.fallback ? map.fallback.agendaPriorities : [])
        ),
    ];
}
