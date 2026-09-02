import { generateUniqueCompanyName } from "~/lib/workspace-slug";

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

beforeEach(() => {
    queuedRows = [];
    mockSelect.mockReset();
    // Each call resolves to the next queued result set.
    mockSelect.mockImplementation(() => ({
        from: () => ({
            where: () => Promise.resolve(queuedRows.shift() ?? []),
        }),
    }));
});

describe("generateUniqueCompanyName", () => {
    it("returns the name unchanged when nothing holds it", async () => {
        queuedRows = [[]];
        await expect(generateUniqueCompanyName("Timothy's workspace")).resolves.toBe(
            "Timothy's workspace"
        );
    });

    it("suffixes past a single collision", async () => {
        queuedRows = [[{ id: 1 }], []];
        await expect(generateUniqueCompanyName("Timothy's workspace")).resolves.toBe(
            "Timothy's workspace 2"
        );
    });

    it("keeps counting past consecutive collisions", async () => {
        queuedRows = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }], []];
        await expect(generateUniqueCompanyName("Timothy's workspace")).resolves.toBe(
            "Timothy's workspace 4"
        );
    });

    it("trims before comparing, so padding cannot smuggle a duplicate through", async () => {
        queuedRows = [[]];
        await expect(generateUniqueCompanyName("  Acme  ")).resolves.toBe("Acme");
    });

    it("gives up on a suffix rather than looping forever", async () => {
        // 50 attempts all taken.
        queuedRows = Array.from({ length: 50 }, () => [{ id: 1 }]);
        const result = await generateUniqueCompanyName("Busy");
        expect(result).toMatch(/^Busy \d{10,}$/);
    });
});
