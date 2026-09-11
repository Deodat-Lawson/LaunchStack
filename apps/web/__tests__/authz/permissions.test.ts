import {
    BUILTIN_ROLES,
    BUILTIN_ROLE_PERMISSIONS,
    OWNER_ONLY_PERMISSIONS,
    PERMISSIONS,
    PERMISSION_DESCRIPTIONS,
    builtinRolePermissions,
    grantLevelAtLeast,
    isSubset,
    normalizeRoleSlug,
    permissionsFromList,
    roleLabel,
    roleRank,
} from "~/lib/authz/permissions";

describe("permission catalogue", () => {
    it("describes every permission", () => {
        for (const p of PERMISSIONS) {
            expect(PERMISSION_DESCRIPTIONS[p]).toEqual(expect.any(String));
        }
    });

    it("gives every permission to at least one built-in role", () => {
        for (const p of PERMISSIONS) {
            const holders = BUILTIN_ROLES.filter(r => BUILTIN_ROLE_PERMISSIONS[r].has(p));
            expect(holders.length).toBeGreaterThan(0);
        }
    });

    it("nests owner ⊇ admin ⊇ member ⊇ viewer ⊇ guest", () => {
        const { owner, admin, member, viewer, guest } = BUILTIN_ROLE_PERMISSIONS;
        expect(isSubset(admin, owner)).toBe(true);
        expect(isSubset(member, admin)).toBe(true);
        expect(isSubset(viewer, member)).toBe(true);
        expect(isSubset(guest, viewer)).toBe(true);
        expect(owner.size).toBe(PERMISSIONS.length);
    });

    it("keeps owner-only permissions away from admin", () => {
        for (const p of OWNER_ONLY_PERMISSIONS) {
            expect(BUILTIN_ROLE_PERMISSIONS.admin.has(p)).toBe(false);
            expect(BUILTIN_ROLE_PERMISSIONS.owner.has(p)).toBe(true);
        }
    });

    it("lets members work on documents but not delete or administer", () => {
        const member = BUILTIN_ROLE_PERMISSIONS.member;
        expect(member.has("documents.read")).toBe(true);
        expect(member.has("documents.upload")).toBe(true);
        expect(member.has("documents.edit")).toBe(true);
        expect(member.has("documents.delete")).toBe(false);
        expect(member.has("folders.manage")).toBe(false);
        expect(member.has("members.invite")).toBe(false);
    });

    it("keeps viewers read-only and guests folder-bound", () => {
        expect(BUILTIN_ROLE_PERMISSIONS.viewer.has("documents.upload")).toBe(false);
        expect(BUILTIN_ROLE_PERMISSIONS.guest.has("members.view")).toBe(false);
        expect(BUILTIN_ROLE_PERMISSIONS.guest.has("documents.read")).toBe(true);
    });
});

describe("role slugs", () => {
    it("maps the legacy vocabulary onto built-ins", () => {
        expect(normalizeRoleSlug("editor")).toBe("member");
        expect(normalizeRoleSlug("employer")).toBe("admin");
        expect(normalizeRoleSlug("employee")).toBe("member");
        expect(normalizeRoleSlug(" Owner ")).toBe("owner");
        expect(normalizeRoleSlug("finance-lead")).toBe("finance-lead");
    });

    it("resolves built-in permissions through legacy aliases and null for custom slugs", () => {
        expect(builtinRolePermissions("editor")).toBe(BUILTIN_ROLE_PERMISSIONS.member);
        expect(builtinRolePermissions("finance-lead")).toBeNull();
    });

    it("drops unknown permission strings from a custom role", () => {
        const set = permissionsFromList(["documents.read", "nonsense", 42, "roles.manage"]);
        expect([...set].sort()).toEqual(["documents.read", "roles.manage"]);
    });

    it("orders built-ins conventionally and custom roles by size", () => {
        expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
        expect(roleRank("admin")).toBeGreaterThan(roleRank("member"));
        expect(roleRank("member")).toBeGreaterThan(roleRank("viewer"));
        expect(roleRank("viewer")).toBeGreaterThan(roleRank("guest"));
        expect(roleRank("big", new Set(["documents.read", "documents.upload"]))).toBeGreaterThan(
            roleRank("small", new Set(["documents.read"]))
        );
    });

    it("labels built-ins and falls back to the custom name", () => {
        expect(roleLabel("editor")).toBe("Member");
        expect(roleLabel("finance-lead", "Finance lead")).toBe("Finance lead");
        expect(roleLabel("finance-lead")).toBe("finance-lead");
    });

    it("ranks grant levels", () => {
        expect(grantLevelAtLeast("manage", "edit")).toBe(true);
        expect(grantLevelAtLeast("view", "edit")).toBe(false);
        expect(grantLevelAtLeast("edit", "edit")).toBe(true);
    });
});
