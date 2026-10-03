/**
 * The agent roster rule: which permission changes which part of an agent.
 *
 * The lists are the rule, so the test that matters most is that they cover
 * every field the API accepts, each exactly once. A new persona field must be
 * classified before it can be saved by anyone.
 */

import {
    AGENT_CONTENT_FIELDS,
    AGENT_POLICY_FIELDS,
    agentRosterAccess,
    contentFieldsOf,
    describePolicyFields,
    policyFieldsIn,
} from "~/lib/agents/roster-access";
import { BUILTIN_ROLE_PERMISSIONS, type Permission } from "~/lib/authz/permissions";
import { PersonaFieldsSchema } from "~/server/collab/agent-schemas";

describe("agent roster access", () => {
    it("classifies every persona field exactly once", () => {
        const accepted = Object.keys(PersonaFieldsSchema.shape).sort();
        const classified = [...AGENT_CONTENT_FIELDS, ...AGENT_POLICY_FIELDS].sort();
        expect(classified).toEqual(accepted);
        expect(new Set(classified).size).toBe(classified.length);
    });

    it.each([
        ["owner", { manageRoster: true, editContent: true }],
        ["admin", { manageRoster: true, editContent: true }],
        ["member", { manageRoster: false, editContent: true }],
        ["viewer", { manageRoster: false, editContent: false }],
        ["guest", { manageRoster: false, editContent: false }],
    ] as const)("gives a built-in %s %o", (role, expected) => {
        const held = BUILTIN_ROLE_PERMISSIONS[role];
        expect(agentRosterAccess(p => held.has(p))).toEqual(expected);
    });

    it("lets whoever manages the roster edit its content, whatever else they hold", () => {
        const held = new Set<Permission>(["settings.manage"]);
        expect(agentRosterAccess(p => held.has(p))).toEqual({
            manageRoster: true,
            editContent: true,
        });
    });

    it("counts a policy field set to null as a change and a missing one as none", () => {
        expect(policyFieldsIn({ systemPrompt: "x", autonomy: null, nodeId: undefined })).toEqual([
            "autonomy",
        ]);
        expect(policyFieldsIn({ displayName: "x", role: "y" })).toEqual([]);
    });

    it("keeps only the content fields of an edit", () => {
        expect(
            contentFieldsOf({
                key: "finance",
                displayName: "Dana",
                systemPrompt: "Guard the margin.",
                autonomy: "full",
                tools: null,
                route: "reasoning",
                nodeId: "gpu-box-1",
                temperature: null,
            })
        ).toEqual({ displayName: "Dana", systemPrompt: "Guard the margin.", temperature: null });
    });

    it("names the refused fields in words", () => {
        expect(describePolicyFields(["autonomy"])).toBe("autonomy");
        expect(describePolicyFields(["key", "nodeId"])).toBe("handle and node");
        expect(describePolicyFields(["key", "tools", "route"])).toBe(
            "handle, tools and model route"
        );
    });
});
