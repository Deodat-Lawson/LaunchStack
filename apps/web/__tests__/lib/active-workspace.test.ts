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
        lastOpenedAt: "membership.lastOpenedAt",
    },
}));

jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (...args: unknown[]) => ({ op: "eq", args }),
    desc: (value: unknown) => ({ op: "desc", value }),
}));

/**
 * Each queued row set answers one SELECT. The builder resolves when awaited
 * directly after `.where()` and also when the query goes on through
 * `.orderBy().limit()` (the most-recently-opened fallback).
 */
function setupRows(...rows: unknown[][]) {
    queuedRows = [...rows];
    mockSelect.mockImplementation(() => {
        const result = queuedRows.shift() ?? [];
        const terminal = {
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
                Promise.resolve(result).then(resolve, reject),
            orderBy: () => ({ limit: () => Promise.resolve(result) }),
        };
        return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnValue(terminal),
        };
    });
}

describe("resolveActiveCompanyForUser", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        queuedRows = [];
        mockCookieGet.mockReturnValue(undefined);
    });

    it("returns null when the user holds no membership anywhere", async () => {
        setupRows([], []);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBeNull();
    });

    it("accepts the default company when a membership for it exists", async () => {
        setupRows([{ companyId: BigInt(10) }]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(10));
    });

    it("uses a valid alternate workspace cookie", async () => {
        mockCookieGet.mockReturnValue({ value: "20" });
        setupRows([{ companyId: BigInt(20) }]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(20));
    });

    it("ignores a cookie pointing at a workspace the user left", async () => {
        mockCookieGet.mockReturnValue({ value: "20" });
        setupRows([], [{ companyId: BigInt(10) }]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(10));
    });

    it("falls back to the most recently opened membership when the default is stale", async () => {
        setupRows([], [{ companyId: BigInt(30) }]);

        await expect(resolveActiveCompanyForUser(7, 10)).resolves.toBe(BigInt(30));
    });

    it("never consults a global account status", async () => {
        setupRows([{ companyId: BigInt(10) }]);

        await resolveActiveCompanyForUser(7, 10);

        // One SELECT — the membership check — and nothing against `users`.
        expect(mockSelect).toHaveBeenCalledTimes(1);
    });
});
