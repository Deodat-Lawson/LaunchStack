/**
 * The one line under an access dialog that says who will see the thing.
 * Pure so the wording is pinned by a test.
 */

import type { GrantLevel, PrincipalType } from "~/lib/authz/permissions";

export interface AudienceGrant {
    principalType: PrincipalType;
    principalId: string;
    principalName?: string;
    level: GrantLevel;
}

export const LEVEL_LABELS: Record<GrantLevel, string> = {
    view: "Can view",
    edit: "Can edit",
    manage: "Can manage",
};

function count(n: number, singular: string, plural = `${singular}s`): string {
    return `${n} ${n === 1 ? singular : plural}`;
}

/** "2 people, 1 group, and the Admin role" — the shape of an edited grant list. */
export function describeGrants(grants: readonly AudienceGrant[]): string {
    const people = grants.filter(g => g.principalType === "user").length;
    const groups = grants.filter(g => g.principalType === "group").length;
    const roles = grants.filter(g => g.principalType === "role");
    const parts: string[] = [];
    if (people > 0) parts.push(count(people, "person", "people"));
    if (groups > 0) parts.push(count(groups, "group"));
    if (roles.length === 1) {
        const name = roles[0]?.principalName;
        parts.push(name ? `the ${name} role` : "1 role");
    } else if (roles.length > 1) {
        parts.push(count(roles.length, "role"));
    }
    if (parts.length === 0) return "no one yet";
    if (parts.length === 1) return parts[0]!;
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
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
export function audienceSummary(input: AudienceSummaryInput): string {
    if (!input.restricted) {
        if (input.audienceCount !== null && !input.dirty) {
            return `Visible to everyone in the workspace (${count(input.audienceCount, "person", "people")})`;
        }
        return "Visible to everyone in the workspace";
    }
    if (input.dirty || input.audienceCount === null) {
        return `Will be visible to ${describeGrants(input.grants)}, plus workspace admins — save to apply`;
    }
    if (input.audienceCount === 0) {
        return "Visible only to workspace owners and admins";
    }
    return `Visible to ${count(input.audienceCount, "person", "people")}`;
}
