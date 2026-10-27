/**
 * Who may post through the deployment's own social accounts (the operator's
 * env keys): the workspace the operator names, else the only workspace on
 * the server, else nobody. The shared-server case is the one that used to
 * leak: every workspace was offered the same X / Reddit / LinkedIn account.
 */
const mockEnv: { server: Record<string, string | undefined> } = { server: {} };
jest.mock("~/env", () => ({
    get env() {
        return mockEnv;
    },
}));

const mockCompanyRows = jest.fn<Array<{ id: number }>, []>();
jest.mock("~/server/db", () => ({
    db: {
        select: () => ({
            from: () => ({ limit: (n: number) => Promise.resolve(mockCompanyRows().slice(0, n)) }),
        }),
    },
}));
jest.mock("@launchstack/store/schema", () => ({ company: { id: "id" } }));

import {
    decideDeploymentAccountsOwner,
    deploymentAccountRefusal,
    deploymentAccountsOwner,
    mayUseDeploymentAccounts,
} from "~/server/brand/deployment-accounts";

const A = BigInt(1);
const B = BigInt(2);

describe("decideDeploymentAccountsOwner", () => {
    it("the only workspace on the server owns them (single-company installs keep working)", () => {
        expect(decideDeploymentAccountsOwner(undefined, [A])).toEqual({
            owner: A,
            reason: "only-workspace",
        });
    });

    it("on a shared server with nothing named, nobody owns them", () => {
        expect(decideDeploymentAccountsOwner(undefined, [A, B])).toEqual({
            owner: null,
            reason: "shared-server",
        });
        expect(decideDeploymentAccountsOwner("  ", [A, B]).owner).toBeNull();
    });

    it("the operator's named workspace owns them, however many there are", () => {
        expect(decideDeploymentAccountsOwner("2", [A, B])).toEqual({
            owner: B,
            reason: "configured",
        });
        expect(decideDeploymentAccountsOwner(" 2 ", [A])).toEqual({
            owner: B,
            reason: "configured",
        });
    });

    it("a malformed setting fails closed instead of falling back to the only workspace", () => {
        expect(decideDeploymentAccountsOwner("acme", [A])).toEqual({
            owner: null,
            reason: "configured-unknown",
        });
        expect(decideDeploymentAccountsOwner("-1", [A]).owner).toBeNull();
    });

    it("an empty server has no owner", () => {
        expect(decideDeploymentAccountsOwner(undefined, []).owner).toBeNull();
    });
});

describe("mayUseDeploymentAccounts", () => {
    beforeEach(() => {
        mockEnv.server = {};
    });

    it("lets the single workspace through and nobody else", async () => {
        mockCompanyRows.mockReturnValue([{ id: 1 }]);
        expect(await mayUseDeploymentAccounts(A)).toBe(true);
        expect(await mayUseDeploymentAccounts(B)).toBe(false);
    });

    it("refuses every workspace once a second one joins", async () => {
        mockCompanyRows.mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
        expect(await mayUseDeploymentAccounts(A)).toBe(false);
        expect(await mayUseDeploymentAccounts(B)).toBe(false);
        expect((await deploymentAccountsOwner()).reason).toBe("shared-server");
    });

    it("follows BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID on a shared server", async () => {
        mockCompanyRows.mockReturnValue([{ id: 1 }, { id: 2 }]);
        mockEnv.server = { BRAND_DEPLOYMENT_ACCOUNTS_COMPANY_ID: "2" };
        expect(await mayUseDeploymentAccounts(A)).toBe(false);
        expect(await mayUseDeploymentAccounts(B)).toBe(true);
    });
});

it("tells the member what to do instead", () => {
    const text = deploymentAccountRefusal("X");
    expect(text).toContain("shared X account");
    expect(text).toContain("Connect this workspace's own X account");
});
