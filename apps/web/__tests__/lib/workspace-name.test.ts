import { suggestAvailableCompanyName } from "~/lib/workspace-slug";

const mockSelect = jest.fn();
let queuedRows: unknown[][] = [];

jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
    },
}));

jest.mock("@launchstack/store/schema", () => ({
    company: { id: "company.id", name: "company.name", slug: "company.slug" },
}));

jest.mock("drizzle-orm", () => ({
    eq: (...args: unknown[]) => ({ op: "eq", args }),
}));

const TAKEN = [{ id: 1 }];
const FREE: unknown[] = [];

beforeEach(() => {
    queuedRows = [];
    mockSelect.mockReset();
    mockSelect.mockImplementation(() => ({
        from: () => ({
            where: () => Promise.resolve(queuedRows.shift() ?? FREE),
        }),
    }));
});

describe("suggestAvailableCompanyName", () => {
    it("keeps the preferred name when nobody holds it", async () => {
        queuedRows = [FREE];
        await expect(suggestAvailableCompanyName("Timothy's workspace")).resolves.toBe(
            "Timothy's workspace"
        );
    });

    it("appends a random token when the preferred name is taken", async () => {
        queuedRows = [TAKEN, FREE];
        const result = await suggestAvailableCompanyName("Timothy's workspace");
        expect(result).toMatch(/^Timothy's workspace [a-hjkmnp-z2-9]{4}$/);
    });

    it("does not leak a count — two collisions do not produce a '2'", async () => {
        queuedRows = [TAKEN, FREE];
        const result = await suggestAvailableCompanyName("Acme");
        expect(result).not.toBe("Acme 2");
        expect(result.startsWith("Acme ")).toBe(true);
    });

    it("keeps drawing tokens while they collide", async () => {
        queuedRows = [TAKEN, TAKEN, TAKEN, FREE];
        const result = await suggestAvailableCompanyName("Busy");
        expect(result).toMatch(/^Busy [a-hjkmnp-z2-9]{4}$/);
    });

    it("trims the preferred name before checking", async () => {
        queuedRows = [FREE];
        await expect(suggestAvailableCompanyName("   Acme   ")).resolves.toBe("Acme");
    });

    it("falls back to a default when handed nothing usable", async () => {
        queuedRows = [FREE];
        await expect(suggestAvailableCompanyName("   ")).resolves.toBe("My workspace");
    });

    it("terminates rather than looping when every draw collides", async () => {
        queuedRows = Array.from({ length: 13 }, () => TAKEN);
        const result = await suggestAvailableCompanyName("Unlucky");
        expect(result.startsWith("Unlucky ")).toBe(true);
        expect(result.length).toBeGreaterThan("Unlucky ".length);
    });
});
