/**
 * `canEditFolder` is the write-side twin of the read scope: who may put a
 * document into a folder. The cheap answers come first (a manager, an open
 * folder), then the grant walk — user, role, then the caller's groups.
 */

import { canEditFolder, ensureCategoryRow } from "~/server/services/folder-access";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

/** FIFO of query results; every select chain resolves the next one. */
const mockResults: unknown[][] = [];
const mockInsertValues = jest.fn();

function mockChain(): Record<string, unknown> {
    const proxy: Record<string, unknown> = new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === "then") {
                    const rows = mockResults.shift() ?? [];
                    return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                        Promise.resolve(rows).then(resolve, reject);
                }
                return () => proxy;
            },
        }
    );
    return proxy;
}

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(() => mockChain()),
        insert: jest.fn(() => ({ values: (row: unknown) => mockInsertValues(row) })),
    },
}));

import { db } from "~/server/db";

const selectMock = db.select as jest.Mock;

function member(overrides: Parameters<typeof makeWorkspaceContext>[0] = {}) {
    return makeWorkspaceContext({
        role: "member",
        userPk: BigInt(7),
        companyId: BigInt(5),
        ...overrides,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockResults.length = 0;
});

describe("canEditFolder", () => {
    it("says yes to a folders.manage holder without reading anything", async () => {
        await expect(canEditFolder(makeWorkspaceContext({ role: "admin" }), "Board")).resolves.toBe(
            true
        );
        expect(selectMock).not.toHaveBeenCalled();
    });

    it("says yes to an open folder after one read", async () => {
        mockResults.push([]);

        await expect(canEditFolder(member(), "General")).resolves.toBe(true);
        expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it("says no to a restricted folder with no grants", async () => {
        mockResults.push([{ categoryId: BigInt(3) }], []);

        await expect(canEditFolder(member(), "Board")).resolves.toBe(false);
    });

    it("ignores view-level grants", async () => {
        mockResults.push(
            [{ categoryId: BigInt(3) }],
            [{ principalType: "user", principalId: "7", level: "view" }]
        );

        await expect(canEditFolder(member(), "Board")).resolves.toBe(false);
    });

    it("honours an edit grant to the user", async () => {
        mockResults.push(
            [{ categoryId: BigInt(3) }],
            [{ principalType: "user", principalId: "7", level: "edit" }]
        );

        await expect(canEditFolder(member(), "Board")).resolves.toBe(true);
        expect(selectMock).toHaveBeenCalledTimes(2);
    });

    it("honours a manage grant to the caller's role, legacy slug included", async () => {
        mockResults.push(
            [{ categoryId: BigInt(3) }],
            [{ principalType: "role", principalId: "editor", level: "manage" }]
        );

        await expect(canEditFolder(member(), "Board")).resolves.toBe(true);
    });

    it("walks the caller's groups only when a group grant exists", async () => {
        mockResults.push(
            [{ categoryId: BigInt(3) }],
            [{ principalType: "group", principalId: "11", level: "edit" }],
            [{ groupId: BigInt(11) }]
        );

        await expect(canEditFolder(member(), "Board")).resolves.toBe(true);
        expect(selectMock).toHaveBeenCalledTimes(3);
    });

    it("says no when the group grant is for a group the caller is not in", async () => {
        mockResults.push(
            [{ categoryId: BigInt(3) }],
            [{ principalType: "group", principalId: "11", level: "edit" }],
            [{ groupId: BigInt(12) }]
        );

        await expect(canEditFolder(member(), "Board")).resolves.toBe(false);
    });
});

describe("ensureCategoryRow", () => {
    it("inserts the folder when no row exists", async () => {
        mockResults.push([]);

        await ensureCategoryRow(BigInt(5), "Google Drive");

        expect(mockInsertValues).toHaveBeenCalledWith({
            name: "Google Drive",
            companyId: BigInt(5),
        });
    });

    it("leaves an existing folder alone", async () => {
        mockResults.push([{ id: 1 }]);

        await ensureCategoryRow(BigInt(5), "Google Drive");

        expect(mockInsertValues).not.toHaveBeenCalled();
    });
});
