import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
    },
}));

import { NextResponse } from "next/server";
import { GET } from "~/app/api/documents/[id]/text/route";
import { db } from "~/server/db";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

type DocumentRow = {
    id: number;
    title: string;
    currentVersionId: bigint | null;
};

type ChunkRow = {
    versionId: bigint | null;
    content: string;
    pageNumber: number | null;
};

type SelectRow = DocumentRow | ChunkRow;

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

type DocumentTextPayload = {
    error?: string;
    html?: string;
    chunkCount?: number;
    documentId?: number;
};

const selectMock = jest.spyOn(db, "select") as unknown as SelectMock;

const CTX: WorkspaceContext = makeWorkspaceContext({
    authUserId: "user-1",
    userPk: 7n,
    companyId: 10n,
    role: "admin",
});

/** A Member who cannot see the "Board" folder. */
const SCOPED_CTX: WorkspaceContext = makeWorkspaceContext({
    authUserId: "user-2",
    userPk: 8n,
    companyId: 10n,
    role: "member",
    scope: {
        kind: "except",
        deniedCategories: ["Board"],
        deniedDocumentIds: [],
        allowedDocumentIds: [],
    },
});

function inspectPredicate(
    value: unknown,
    details: PredicateDetails = {
        columnNames: [],
        params: [],
    }
): PredicateDetails {
    if (!value || typeof value !== "object") return details;
    // Drizzle embeds `IN (...)` lists as a raw array of params inside the chunk list.
    if (Array.isArray(value)) {
        for (const item of value) inspectPredicate(item, details);
        return details;
    }

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
            // A `sql` template keeps interpolated primitives raw until the
            // query is built; they are parameters all the same.
            if (chunk !== null && typeof chunk !== "object") {
                details.params.push(chunk);
                continue;
            }
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

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
    return {
        id: 42,
        title: "Document",
        currentVersionId: 2n,
        ...overrides,
    };
}

describe("GET /api/documents/[id]/text", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRequireWorkspaceContext.mockResolvedValue({
            success: true,
            data: CTX,
        });
    });

    it("preserves the unauthorized response", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });

        const response = await requestFor();

        expect(response.status).toBe(401);
        await expect(responsePayload(response)).resolves.toEqual({ error: "Unauthorized" });
        expect(selectMock).not.toHaveBeenCalled();
    });

    it("returns only chunks for the document current version", async () => {
        queueSelectBatches(
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
        queueSelectBatches({
            rows: [
                documentRow({
                    currentVersionId: null,
                }),
            ],
        });

        const response = await requestFor();
        const payload = await responsePayload(response);

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            html: "<p>No extracted text available for this document. It may still be processing.</p>",
            chunkCount: 0,
            documentId: 42,
        });
        expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it("does not fall back when only historical or unversioned chunks exist", async () => {
        queueSelectBatches(
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
        // Route company-scopes in SQL; a missing row means wrong tenant / missing doc.
        queueSelectBatches({ rows: [] });

        const response = await requestFor();

        expect(response.status).toBe(404);
        await expect(responsePayload(response)).resolves.toEqual({
            error: "Document not found",
        });
        expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it("puts the caller's read scope into the document predicate", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: SCOPED_CTX });
        const predicates: unknown[] = [];
        selectMock.mockImplementation(() => {
            const where = jest.fn<Promise<readonly SelectRow[]> | OrderedQuery, [unknown]>(
                (condition: unknown) => {
                    predicates.push(condition);
                    // The scoped WHERE finds nothing — the document lives in
                    // "Board" — so the route must answer exactly like a miss.
                    return Promise.resolve([]);
                }
            );
            return { from: jest.fn<SelectWhereQuery, [table: unknown]>(() => ({ where })) };
        });

        const response = await requestFor();

        expect(response.status).toBe(404);
        await expect(responsePayload(response)).resolves.toEqual({
            error: "Document not found",
        });
        // The predicate carries the denied folder name as a bound parameter.
        const details = inspectPredicate(predicates[0]);
        expect(details.params).toContain("Board");
        expect(details.columnNames).toContain("category");
    });
});
