import { isManagementRole, MANAGEMENT_ROLES } from "~/lib/membership-roles";

describe("membership-roles", () => {
    it("treats owner and admin as management roles", () => {
        expect(isManagementRole("owner")).toBe(true);
        expect(isManagementRole("admin")).toBe(true);
        expect([...MANAGEMENT_ROLES].sort()).toEqual(["admin", "owner"]);
    });

    it("rejects editors and legacy employer/employee labels", () => {
        expect(isManagementRole("editor")).toBe(false);
        expect(isManagementRole("employer")).toBe(false);
        expect(isManagementRole("employee")).toBe(false);
    });
});
