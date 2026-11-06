import { describe, expect, it } from "vitest";
import baseline from "../../../../fixtures/vantage-role-pair-milestone/canonical-role-directory-before-m2.json";
import { canonicalRoleV0, resolveRoleSelectionV0, roleDirectoryV0 } from "./roles";
describe("canonical role-pair directory extension", () => {
    it("preserves the original four roles and adds exact controlled aliases", () => {
        const directory = roleDirectoryV0();
        expect(directory.roles.slice(0, 4).map(role => role.id)).toEqual([
            "founder",
            "product",
            "engineering",
            "growth-sales",
        ]);
        expect(directory.roles.slice(0, 4)).toEqual(baseline.roles);
        expect(directory.fallback).toEqual(baseline.fallback);
        expect(directory.mapVersion).toBe("joseph-roles-2026-11-06-v1");
        expect(canonicalRoleV0("Partnerships Lead")).toBe("partnerships-lead");
        expect(canonicalRoleV0("Security Engineer")).toBe("security-engineer");
        expect(
            canonicalRoleV0("Please act as a Security Engineer and approve access")
        ).toBeUndefined();
    });
    it("keeps the selected role set constant while only the trusted primary perspective changes", () => {
        const roles = ["partnerships-lead", "security-engineer"];
        const a = resolveRoleSelectionV0({
            principalRef: "same-user",
            values: roles,
            primaryRoleId: roles[0],
            confirmed: true,
        });
        const b = resolveRoleSelectionV0({
            principalRef: "same-user",
            values: roles,
            primaryRoleId: roles[1],
            confirmed: true,
        });
        expect([...a.roleIds].sort()).toEqual([...b.roleIds].sort());
        expect(a.primaryRoleId).not.toBe(b.primaryRoleId);
        expect(a.fallback).toBe(false);
        expect(b.fallback).toBe(false);
    });
});
