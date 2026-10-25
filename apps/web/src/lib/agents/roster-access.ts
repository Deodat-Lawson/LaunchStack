/**
 * Who may change the agent roster, and which parts of an agent.
 *
 * Two kinds of change, two permissions:
 *
 * - **The roster and its policy** — `settings.manage`. Adding an agent
 *   (create, duplicate, import), retiring one, bringing one back, restoring a
 *   starter, and the fields that decide what an agent may do, where it runs,
 *   what it costs and how it is mentioned: handle, autonomy, tools, model
 *   route and node. Autonomy is the admin's dial on unattended turns and
 *   Slack; a Member who could raise it would be past the policy.
 * - **What an agent says** — `documents.edit`. The name, role, when-to-use
 *   line, standing instructions, answer style, mode, temperature, turn cap,
 *   picture and colour of an agent that already exists.
 *
 * Everyone in the workspace reads, tries and exports agents.
 *
 * Dependency-free: the API routes, the Agents app, the editor and Settings ›
 * Agents read the same lists, so a button is shown exactly when the route
 * behind it would accept the click.
 */

import type { Permission } from "~/lib/authz/permissions";

/** Adding, retiring, restoring, and every policy field. */
export const AGENT_ROSTER_PERMISSION: Permission = "settings.manage";
/** Changing what an existing agent says. */
export const AGENT_CONTENT_PERMISSION: Permission = "documents.edit";

/** Fields an editor may change on an existing agent. */
export const AGENT_CONTENT_FIELDS = [
    "displayName",
    "role",
    "description",
    "systemPrompt",
    "style",
    "mode",
    "temperature",
    "maxTurnChars",
    "accent",
    "avatarUrl",
] as const;
export type AgentContentField = (typeof AGENT_CONTENT_FIELDS)[number];

/** Fields only the roster's managers may change. */
export const AGENT_POLICY_FIELDS = ["key", "autonomy", "tools", "route", "nodeId"] as const;
export type AgentPolicyField = (typeof AGENT_POLICY_FIELDS)[number];

/** How the policy fields read in a sentence ("handle, autonomy, tools…"). */
export const AGENT_POLICY_FIELD_LABELS: Record<AgentPolicyField, string> = {
    key: "handle",
    autonomy: "autonomy",
    tools: "tools",
    route: "model route",
    nodeId: "node",
};

export interface AgentRosterAccess {
    /** Add, duplicate, import, retire, bring back, restore — and edit every field. */
    manageRoster: boolean;
    /** Edit the content fields of an existing agent. */
    editContent: boolean;
}

export function agentRosterAccess(can: (permission: Permission) => boolean): AgentRosterAccess {
    const manageRoster = can(AGENT_ROSTER_PERMISSION);
    return { manageRoster, editContent: manageRoster || can(AGENT_CONTENT_PERMISSION) };
}

/** The policy fields an edit sets. A field left out is untouched; `null` is a change. */
export function policyFieldsIn(patch: Readonly<Record<string, unknown>>): AgentPolicyField[] {
    return AGENT_POLICY_FIELDS.filter(field => patch[field] !== undefined);
}

/** Keeps only the content fields of an edit. */
export function contentFieldsOf<T extends Partial<Record<AgentContentField, unknown>>>(
    patch: T
): Pick<T, AgentContentField & keyof T> {
    const out: Partial<T> = {};
    for (const field of AGENT_CONTENT_FIELDS) {
        if (field in patch) (out as Record<string, unknown>)[field] = patch[field];
    }
    return out as Pick<T, AgentContentField & keyof T>;
}

/** "handle, autonomy and tools" — for the message that refuses them. */
export function describePolicyFields(fields: readonly AgentPolicyField[]): string {
    const labels = fields.map(field => AGENT_POLICY_FIELD_LABELS[field]);
    if (labels.length <= 1) return labels.join("");
    return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
