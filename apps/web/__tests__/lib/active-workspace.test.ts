import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

const mockSelect = jest.fn();
const mockCookieGet = jest.fn();
let queuedRows: unknown[][] = [];

jest.mock("next/headers", () => ({
    cookies: () => ({ get: (...args: unknown[]) => mockCookieGet(...args) }),
}));

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
    },
}));

jest.mock("~/server/db/schema", () => ({
    users: {
        id: "users.id",
        companyId: "users.companyId",
    },
    userCompanyMemberships: {
        userId: "membership.userId",
        companyId: "membership.companyId",
        status: "membership.status",
        lastOpenedAt: "membership.lastOpenedAt",
    },
}));

jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (...args: unknown[]) => ({ op: "eq", args }),
    desc: (value: unknown) => ({ op: "desc", value }),
}));

/**
 * The resolver reads every membership in one SELECT, most recently opened
 * first: `.select().from().where().orderBy()`.
 */
function setupRows(...rows: unknown[][]) {
    queuedRows = [...rows];
    mockSelect.mockImplementation(() => {
        const result = queuedRows.shift() ?? [];
        return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnValue({ orderBy: () => Promise.resolve(result) }),
        };
    });
}

const active = (id: number) => ({ companyId: BigInt(id), status: "active" });
const suspended = (id: number) => ({ companyId: BigInt(id), status: "suspended" });
const pending = (id: number) => ({ companyId: BigInt(id), status: "pending" });

describe("resolveActiveCompanyForUser", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        queuedRows = [];
        mockCookieGet.mockReturnValue(undefined);
    });

    it("returns null when the user holds no membership anywhere", async () => {
        setupRows([]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBeNull();
    });

    it("uses the cookie for a workspace the user is active in", async () => {
        mockCookieGet.mockReturnValue({ value: "20" });
        setupRows([active(30), active(20), active(10)]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(20));
    });

    it("without a cookie, opens the user's last-opened workspace, not the default", async () => {
        setupRows([active(30), active(10)]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(30));
    });

    it("ignores a cookie pointing at a workspace the user left", async () => {
        mockCookieGet.mockReturnValue({ value: "20" });
        setupRows([active(10)]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(10));
    });

    // The cookie is browser-wide: the previous account in this browser may
    // have left it on a workspace where this one is suspended or pending.
    it.each([
        ["suspended", suspended(62)],
        ["pending", pending(62)],
    ])("ignores a cookie for a workspace the user is %s in", async (_label, row) => {
        mockCookieGet.mockReturnValue({ value: "62" });
        setupRows([row, active(50)]);

        await expect(resolveActiveCompanyForUser(36, 50)).resolves.toBe(BigInt(50));
    });

    it("with nothing active, names the default membership for the pending page", async () => {
        setupRows([pending(30), pending(10)]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(10));
    });

    it("with nothing active and a stale default, names the latest membership", async () => {
        setupRows([suspended(30), pending(40)]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(30));
    });

    it("reads once, and never consults a global account status", async () => {
        setupRows([active(10)]);

        await resolveActiveCompanyForUser(7, 10);

        expect(mockSelect).toHaveBeenCalledTimes(1);
    });
});
