/** Fixed server-owned M2 condition. Nothing in this policy is populated from HTTP role/source fields. */
export const ROLE_CONTEXTUAL_POLICY = {
    id: "contextual-role-pair/v1",
    weekStart: "2026-10-26",
    modelId: "offline-role-milestone-replay",
    roleIds: ["partnerships-lead", "security-engineer"] as const,
    logicalKeys: ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10"] as const,
};
export type RoleLogicalKey = (typeof ROLE_CONTEXTUAL_POLICY.logicalKeys)[number];
