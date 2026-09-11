import {
    assignablePermissions,
    canActOnMember,
    canAssignRole,
    canGrantPermissions,
    wouldRemoveLastOwner,
    type Actor,
} from "~/lib/authz/escalation";
import { BUILTIN_ROLE_PERMISSIONS, type Permission } from "~/lib/authz/permissions";

const actor = (role: keyof typeof BUILTIN_ROLE_PERMISSIONS, userPk = BigInt(1)): Actor => ({
    userPk,
    role,
    permissions: BUILTIN_ROLE_PERMISSIONS[role],
});

const target = (slug: keyof typeof BUILTIN_ROLE_PERMISSIONS) => ({
    slug,
    permissions: BUILTIN_ROLE_PERMISSIONS[slug],
});

describe("canAssignRole", () => {
    it("lets an owner assign anything", () => {
        expect(canAssignRole(actor("owner"), target("owner"))).toBe(true);
        expect(canAssignRole(actor("owner"), target("admin"))).toBe(true);
        expect(canAssignRole(actor("owner"), target("guest"))).toBe(true);
    });

    it("lets an admin make other admins, but never an owner", () => {
        expect(canAssignRole(actor("admin"), target("owner"))).toBe(false);
        expect(canAssignRole(actor("admin"), target("admin"))).toBe(true);
        expect(canAssignRole(actor("admin"), target("member"))).toBe(true);
    });

    it("stops members and viewers assigning anything above themselves", () => {
        expect(canAssignRole(actor("member"), target("admin"))).toBe(false);
        expect(canAssignRole(actor("member"), target("member"))).toBe(true);
        expect(canAssignRole(actor("viewer"), target("member"))).toBe(false);
    });

    it("limits custom roles to the actor's own permissions", () => {
        const custom = {
            slug: "finance-lead",
            permissions: new Set<Permission>(["documents.read", "documents.delete"]),
        };
        expect(canAssignRole(actor("admin"), custom)).toBe(true);
        expect(canAssignRole(actor("member"), custom)).toBe(false);
    });

    it("treats the legacy editor slug as member", () => {
        expect(canAssignRole(actor("admin"), { slug: "editor", permissions: new Set() })).toBe(
            true
        );
    });
});

describe("canActOnMember", () => {
    it("never lets anyone act on themselves", () => {
        expect(canActOnMember(actor("owner", BigInt(9)), "member", BigInt(9))).toBe(false);
    });

    it("reserves owners for owners and lets admins act on other admins", () => {
        expect(canActOnMember(actor("admin"), "owner", BigInt(2))).toBe(false);
        expect(canActOnMember(actor("admin"), "admin", BigInt(2))).toBe(true);
        expect(canActOnMember(actor("owner"), "admin", BigInt(2))).toBe(true);
        expect(canActOnMember(actor("admin"), "member", BigInt(2))).toBe(true);
        expect(canActOnMember(actor("member"), "member", BigInt(2))).toBe(true);
    });
});

describe("wouldRemoveLastOwner", () => {
    it("refuses when the target is the only active owner", () => {
        expect(wouldRemoveLastOwner({ targetIsOwner: true, activeOwnerCount: 1 })).toBe(true);
        expect(wouldRemoveLastOwner({ targetIsOwner: true, activeOwnerCount: 2 })).toBe(false);
        expect(wouldRemoveLastOwner({ targetIsOwner: false, activeOwnerCount: 1 })).toBe(false);
        expect(
            wouldRemoveLastOwner({
                targetIsOwner: true,
                activeOwnerCount: 1,
                targetStaysOwner: true,
            })
        ).toBe(false);
    });
});

describe("custom role permissions", () => {
    it("never offers owner-only permissions, even to an owner", () => {
        const set = assignablePermissions(actor("owner"));
        expect(set.has("billing.manage")).toBe(false);
        expect(set.has("workspace.transfer")).toBe(false);
        expect(set.has("roles.manage")).toBe(true);
    });

    it("refuses permissions the actor does not hold", () => {
        expect(canGrantPermissions(actor("member"), new Set(["documents.delete"]))).toBe(false);
        expect(canGrantPermissions(actor("admin"), new Set(["documents.delete"]))).toBe(true);
        expect(canGrantPermissions(actor("owner"), new Set(["billing.manage"]))).toBe(false);
    });
});
