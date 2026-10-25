/**
 * The one line under an access dialog that says who will see the thing.
 * Pure so the wording is pinned by a test; the words are
 * `team.access` (pass its translator).
 */

import type { useTranslations } from "next-intl";

import type { GrantLevel, PrincipalType } from "~/lib/authz/permissions";

export type AccessTranslator = ReturnType<typeof useTranslations<"team.access">>;

export interface AudienceGrant {
    principalType: PrincipalType;
    principalId: string;
    principalName?: string;
    level: GrantLevel;
}

/** "2 people, 1 group, and the Admin role" — the shape of an edited grant list. */
export function describeGrants(t: AccessTranslator, grants: readonly AudienceGrant[]): string {
    const people = grants.filter(g => g.principalType === "user").length;
    const groups = grants.filter(g => g.principalType === "group").length;
    const roles = grants.filter(g => g.principalType === "role");
    const parts: string[] = [];
    if (people > 0) parts.push(t("counts.people", { count: people }));
    if (groups > 0) parts.push(t("counts.groups", { count: groups }));
    if (roles.length === 1) {
        const name = roles[0]?.principalName;
        parts.push(name ? t("audience.namedRole", { name }) : t("counts.roles", { count: 1 }));
    } else if (roles.length > 1) {
        parts.push(t("counts.roles", { count: roles.length }));
    }
    if (parts.length === 0) return t("audience.noOne");
    if (parts.length === 1) return parts[0]!;
    if (parts.length === 2) return t("list.pair", { first: parts[0]!, last: parts[1]! });
    return t("list.series", {
        rest: parts.slice(0, -1).join(t("list.separator")),
        last: parts[parts.length - 1]!,
    });
}

export interface AudienceSummaryInput {
    kind: "folder" | "document";
    /** True when the thing is limited to the grant list. */
    restricted: boolean;
    grants: readonly AudienceGrant[];
    /** People who can see it under the *saved* state, per the server. */
    audienceCount: number | null;
    /** Whether the grants on screen differ from what is saved. */
    dirty: boolean;
}

/**
 * "Visible to everyone in the workspace" / "Visible to 4 people" / while
 * editing, "Will be visible to 2 people and 1 group — save to apply".
 */
export function audienceSummary(t: AccessTranslator, input: AudienceSummaryInput): string {
    if (!input.restricted) {
        if (input.audienceCount !== null && !input.dirty) {
            return t("audience.everyoneCounted", { count: input.audienceCount });
        }
        return t("audience.everyone");
    }
    if (input.dirty || input.audienceCount === null) {
        return t("audience.pending", { who: describeGrants(t, input.grants) });
    }
    if (input.audienceCount === 0) return t("audience.adminsOnly");
    return t("audience.counted", { count: input.audienceCount });
}
