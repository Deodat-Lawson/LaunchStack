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
    },
}));

jest.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

function setupRows(...rows: unknown[][]) {
    queuedRows = [...rows];
    mockSelect.mockImplementation(() => {
        const result = queuedRows.shift() ?? [];
        const builder = {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockResolvedValue(result),
        };
        return builder;
    });
}

describe("resolveActiveCompanyForUser", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        queuedRows = [];
        mockCookieGet.mockReturnValue(undefined);
    });

    it("does not trust a verified user's stale default without membership", async () => {
        setupRows([]);

        await expect(resolveActiveCompanyForUser(7, 10, "verified")).resolves.toBeNull();
    });

    it("accepts a verified user's default only when membership is current", async () => {
        setupRows([{ companyId: BigInt(10) }]);

        await expect(resolveActiveCompanyForUser(7, 10, "verified")).resolves.toBe(BigInt(10));
    });

    it("preserves the pending-account fallback without membership", async () => {
        setupRows([]);

        await expect(resolveActiveCompanyForUser(7, 10, "pending")).resolves.toBe(BigInt(10));
        expect(mockSelect).not.toHaveBeenCalled();
    });

    it("uses a valid alternate workspace cookie for verified users", async () => {
        mockCookieGet.mockReturnValue({ value: "20" });
        setupRows([{ companyId: BigInt(20) }]);

        await expect(resolveActiveCompanyForUser(7, 10, "verified")).resolves.toBe(BigInt(20));
    });
});
