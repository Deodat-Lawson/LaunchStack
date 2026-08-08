jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
    },
}));

jest.mock("~/lib/active-workspace", () => ({
    resolveActiveCompanyForUser: jest.fn(),
}));

import { GET } from "~/app/api/documents/[id]/text/route";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";

type UserRow = {
    id: number;
    userId: string;
    companyId: bigint;
    role: string;
};

type DocumentRow = {
    id: number;
    title: string;
    companyId: bigint;
    currentVersionId: bigint | null;
};

type ChunkRow = {
    versionId: bigint | null;
    content: string;
    pageNumber: number | null;
};

type SelectRow = UserRow | DocumentRow | ChunkRow;

type SelectBatch = {
    rows: readonly SelectRow[];
    ordered?: boolean;
};

type PredicateDetails = {
    columnNames: string[];
    params: unknown[];
};

type OrderedQuery = {
    orderBy: jest.MockedFunction<(...columns: unknown[]) => Promise<readonly SelectRow[]>>;
};

type SelectWhereQuery = {
    where: jest.MockedFunction<
        (condition: unknown) => Promise<readonly SelectRow[]> | OrderedQuery
    >;
};

type SelectQuery = {
    from: jest.MockedFunction<(table: unknown) => SelectWhereQuery>;
};

type SelectMock = jest.MockedFunction<() => SelectQuery>;
type AuthMockValue = {
    userId: string | null;
};
type AuthMock = jest.MockedFunction<() => Promise<AuthMockValue>>;

type DocumentTextPayload = {
    error?: string;
    html?: string;
    chunkCount?: number;
    documentId?: number;
};

const authMock = auth as unknown as AuthMock;
const selectMock = jest.spyOn(db, "select") as unknown as SelectMock;
const resolveActiveCompanyForUserMock = resolveActiveCompanyForUser as jest.MockedFunction<
    typeof resolveActiveCompanyForUser
>;

function mockAuthValue(userId: string | null): AuthMockValue {
    return { userId };
}

function inspectPredicate(
    value: unknown,
    details: PredicateDetails = {
        columnNames: [],
        params: [],
    }
): PredicateDetails {
    if (!value || typeof value !== "object") return details;

    const candidate = value as {
        config?: { name?: unknown };
        value?: unknown;
        queryChunks?: unknown[];
    };
    if (typeof candidate.config?.name === "string") {
        details.columnNames.push(candidate.config.name);
    }
    const prototype = Object.getPrototypeOf(value) as {
        constructor?: { name?: unknown };
    } | null;
    if (prototype?.constructor?.name === "Param" && "value" in candidate) {
        details.params.push(candidate.value);
    }
    if (Array.isArray(candidate.queryChunks)) {
        for (const chunk of candidate.queryChunks) {
            inspectPredicate(chunk, details);
        }
    }
    return details;
}

function queueSelectBatches(...batches: SelectBatch[]): void {
    let batchIndex = 0;
    selectMock.mockImplementation(() => {
        const batch = batches[batchIndex++] ?? { rows: [] };
        const where = jest.fn<Promise<readonly SelectRow[]> | OrderedQuery, [condition: unknown]>(
            (condition: unknown) => {
                if (!batch.ordered) return Promise.resolve(batch.rows);

                const details = inspectPredicate(condition);
                const versionIndex = details.columnNames.indexOf("version_id");
                const versionId =
                    versionIndex >= 0 ? details.params[details.params.length - 1] : undefined;
                const rows =
                    versionIndex >= 0
                        ? batch.rows.filter((row): row is ChunkRow => {
                              if (!("versionId" in row)) return false;
                              return row.versionId === versionId;
                          })
                        : batch.rows;

                return {
                    orderBy: jest.fn<Promise<readonly SelectRow[]>, unknown[]>(() =>
                        Promise.resolve(rows)
                    ),
                };
            }
        );
        return {
            from: jest.fn<SelectWhereQuery, [table: unknown]>(() => ({ where })),
        };
    });
}

function requestFor(documentId = "42") {
    return GET(new Request(`http://localhost/api/documents/${documentId}/text`), {
        params: Promise.resolve({ id: documentId }),
    });
}

async function responsePayload(response: Response): Promise<DocumentTextPayload> {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") {
        throw new Error("Expected a JSON object response");
    }
    return payload as DocumentTextPayload;
}

const user: UserRow = {
    id: 7,
    userId: "user-1",
    companyId: 10n,
    role: "employer",
};

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
    return {
        id: 42,
        title: "Document",
        companyId: 10n,
        currentVersionId: 2n,
        ...overrides,
    };
}

describe("GET /api/documents/[id]/text", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        authMock.mockResolvedValue(mockAuthValue(user.userId));
        resolveActiveCompanyForUserMock.mockResolvedValue(user.companyId);
    });

    it("preserves the unauthorized response", async () => {
        authMock.mockResolvedValue(mockAuthValue(null));

        const response = await requestFor();

        expect(response.status).toBe(401);
        await expect(responsePayload(response)).resolves.toEqual({ error: "Unauthorized" });
        expect(selectMock).not.toHaveBeenCalled();
    });

    it("returns only chunks for the document current version", async () => {
        queueSelectBatches(
            { rows: [user] },
            { rows: [documentRow()] },
            {
                ordered: true,
                rows: [
                    { versionId: 1n, content: "stale v1 text", pageNumber: 1 },
                    { versionId: null, content: "legacy unversioned text", pageNumber: 2 },
                    { versionId: 2n, content: "current v2 text", pageNumber: 1 },
                ],
            }
        );

        const response = await requestFor();
        const payload = await responsePayload(response);

        expect(response.status).toBe(200);
        expect(payload.chunkCount).toBe(1);
        expect(payload.html).toContain("current v2 text");
        expect(payload.html).not.toContain("stale v1 text");
        expect(payload.html).not.toContain("legacy unversioned text");
    });

    it("returns the empty response when the current pointer is null", async () => {
        queueSelectBatches(
            { rows: [user] },
            {
                rows: [
                    documentRow({
                        currentVersionId: null,
                    }),
                ],
            }
        );

        const response = await requestFor();
        const payload = await responsePayload(response);

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            html: "<p>No extracted text available for this document. It may still be processing.</p>",
            chunkCount: 0,
            documentId: 42,
        });
        expect(selectMock).toHaveBeenCalledTimes(2);
    });

    it("does not fall back when only historical or unversioned chunks exist", async () => {
        queueSelectBatches(
            { rows: [user] },
            { rows: [documentRow()] },
            {
                ordered: true,
                rows: [
                    { versionId: 1n, content: "stale v1 text", pageNumber: 1 },
                    { versionId: null, content: "legacy unversioned text", pageNumber: 2 },
                ],
            }
        );

        const response = await requestFor();
        const payload = await responsePayload(response);

        expect(response.status).toBe(200);
        expect(payload.chunkCount).toBe(0);
        expect(payload.html).toBe(
            "<p>No extracted text available for this document. It may still be processing.</p>"
        );
    });

    it("hides documents from another active company", async () => {
        queueSelectBatches({ rows: [user] }, { rows: [documentRow({ companyId: 99n })] });

        const response = await requestFor();

        expect(response.status).toBe(404);
        await expect(responsePayload(response)).resolves.toEqual({
            error: "Document not found",
        });
        expect(resolveActiveCompanyForUserMock).toHaveBeenCalledWith(user.id, user.companyId);
        expect(selectMock).toHaveBeenCalledTimes(2);
    });
});
