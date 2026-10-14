/**
 * `canEditFolder` is the write-side twin of the read scope: who may put a
 * document into a folder. Its rules live in `~/server/workspace/item-access`
 * (tested there); here it only has to ask them.
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

const mockCanEditFolderPath = jest.fn();
jest.mock("~/server/workspace/item-access", () => ({
    canEditFolderPath: (...args: unknown[]) => mockCanEditFolderPath(...args),
}));

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
    it("asks the ADR-014 rules for edit level on the folder", async () => {
        const ctx = member();
        mockCanEditFolderPath.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        await expect(canEditFolder(ctx, "General")).resolves.toBe(true);
        await expect(canEditFolder(ctx, "Board")).resolves.toBe(false);
        expect(mockCanEditFolderPath).toHaveBeenNthCalledWith(1, ctx, "General");
        expect(mockCanEditFolderPath).toHaveBeenNthCalledWith(2, ctx, "Board");
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
