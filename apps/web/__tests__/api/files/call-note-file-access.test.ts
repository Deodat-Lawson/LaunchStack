import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as ScopeTypes from "~/lib/authz/scope-types";
import type * as CallNoteDocumentTypes from "~/lib/call-note-document";
import type * as StoreSchema from "@launchstack/store/schema";

import { GET } from "~/app/api/files/[id]/route";
import { DELETE as deleteDocument } from "~/app/api/deleteDocument/route";
import { DELETE as deleteBatch } from "~/app/api/documents/batchDelete/route";
import { signFileAccessToken } from "@launchstack/store/crypto";
import { env } from "~/env";
import type { DocumentScope } from "~/lib/authz/scope-types";
import { deleteFileByUrl } from "~/lib/storage";
import { deleteDocumentBlobs, deleteDocumentCore } from "~/server/services/document-delete";
import { recordAuditEvent } from "~/lib/authz/audit";
import { makeWorkspaceContext } from "../../helpers/workspace-context";

const SECRET = "call-note-file-access-secret";
const ENDPOINT = "http://s3.example.test/storage";
const BUCKET = "notes";
const mockRequireWorkspaceContext = jest.fn();
const mockBlobs = new Map<string, string>();
const mockStorageEvents: string[] = [];
const mockFailBlobKeys = new Set<string>();

jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/env", () => ({
    env: {
        server: {
            FILE_ACCESS_TOKEN_SECRET: "call-note-file-access-secret",
            NEXT_PUBLIC_S3_ENDPOINT: "http://s3.example.test/storage",
            S3_BUCKET_NAME: "notes",
        },
        client: {},
    },
}));

jest.mock("~/server/storage/vercel-blob", () => ({
    isPrivateBlobUrl: () => false,
}));

jest.mock("~/server/storage/s3-client", () => ({
    deleteObject: async (key: string) => {
        mockStorageEvents.push(`blob:${key}`);
        if (mockFailBlobKeys.has(key)) throw new Error("storage unavailable");
        mockBlobs.delete(key);
    },
}));

jest.mock("~/lib/authz/scope", () => ({
    scopeAllows:
        jest.requireActual<typeof ScopeTypes>("~/lib/authz/scope-types").scopeAllowsDocument,
    scopedDocumentWhere: (companyId: bigint) => ({
        op: "eq",
        left: jest.requireMock<typeof StoreSchema>("@launchstack/store/schema").document.companyId,
        right: companyId,
    }),
}));

jest.mock("~/lib/authz/audit", () => ({ recordAuditEvent: jest.fn() }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/lib/rate-limiter", () => ({ RateLimitPresets: { strict: {} } }));
jest.mock("@launchstack/pipelines/call-notes", () => ({ callNotesCalls: {} }));
jest.mock("~/lib/call-note-document", () => ({
    ...jest.requireActual<typeof CallNoteDocumentTypes>("~/lib/call-note-document"),
    callNoteDocumentReference: () => ({
        table: jest.requireMock<typeof StoreSchema>("@launchstack/store/schema").document,
        column: "indexedCallNote",
    }),
}));

// Keep the route and deletion service on the same isolated relational state.
// Predicates are evaluated, not queued: omitting a URL/version/tenant match
// changes the bytes the real route can serve after the real deletion runs.
jest.mock("drizzle-orm", () => ({
    eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
    like: (left: unknown, right: unknown) => ({ op: "like", left, right }),
    inArray: (left: unknown, right: unknown) => ({ op: "in", left, right }),
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    or: (...conditions: unknown[]) => ({ op: "or", conditions }),
}));

jest.mock("@launchstack/store/schema", () => {
    const schema: Record<string, unknown> = {};
    for (const name of [
        "document",
        "documentVersions",
        "fileUploads",
        "documentMetadata",
        "documentPreviews",
        "documentRetrievalChunks",
        "documentSections",
        "documentStructure",
        "kgEntityMentions",
        "workspaceResults",
        "ChatHistory",
        "documentReferenceResolution",
        "documentViews",
        "predictiveDocumentAnalysisResults",
    ]) {
        const table: Record<string, unknown> = { name };
        for (const column of [
            "id",
            "companyId",
            "url",
            "category",
            "title",
            "ocrMetadata",
            "documentId",
            "resolvedInDocumentId",
            "storageUrl",
        ]) {
            table[column] = { table, column };
        }
        schema[name] = table;
    }
    return schema;
});

jest.mock("~/server/db/schema", () => jest.requireMock("@launchstack/store/schema") as unknown);
jest.mock("~/server/db", () => ({
    db: {
        select: (...args: Parameters<typeof mockDatabase.select>) => mockDatabase.select(...args),
        transaction: <T>(callback: (tx: MockDatabase) => Promise<T>) =>
            mockDatabase.transaction(callback),
    },
}));

type Row = Record<string, unknown>;
type Table = { name: string };
type Column = { table: Table; column: string };
type Predicate = {
    op: "eq" | "like" | "in" | "and" | "or";
    left?: Column;
    right?: unknown;
    conditions?: Predicate[];
};
type State = Record<string, Row[]>;

interface MockQuery {
    from(table: Table): MockQuery;
    leftJoin(table: Table, on: Predicate): MockQuery;
    where(predicate: Predicate): MockQuery;
    limit(count: number): Promise<Row[]>;
    then(
        resolve: (value: Row[]) => unknown,
        reject?: (error: unknown) => unknown
    ): Promise<unknown>;
}

interface MockDatabase {
    select(projection?: Record<string, Column>): MockQuery;
    delete(table: Table): { where(predicate: Predicate): Promise<void> };
    transaction<T>(callback: (tx: MockDatabase) => Promise<T>): Promise<T>;
}

let mockState: State;
let mockDatabase: MockDatabase;

function matches(predicate: Predicate | undefined, rows: Record<string, Row | null>): boolean {
    if (!predicate) return true;
    if (predicate.op === "and") return predicate.conditions!.every(item => matches(item, rows));
    if (predicate.op === "or") return predicate.conditions!.some(item => matches(item, rows));
    const value = (part: unknown): unknown => {
        if (part && typeof part === "object" && "table" in part && "column" in part) {
            const column = part as Column;
            return rows[column.table.name]?.[column.column];
        }
        return part;
    };
    const left = value(predicate.left);
    const right = value(predicate.right);
    if (predicate.op === "in") return (right as unknown[]).includes(left);
    if (predicate.op === "like") {
        const pattern = (right as string)
            .split("%")
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*");
        return typeof left === "string" && new RegExp(`^${pattern}$`).test(left);
    }
    if (
        (typeof left === "number" || typeof left === "bigint") &&
        (typeof right === "number" || typeof right === "bigint")
    ) {
        return BigInt(left) === BigInt(right);
    }
    return left === right;
}

function createDatabase(state: State): MockDatabase {
    const database: MockDatabase = {
        select(projection?: Record<string, Column>) {
            let table: Table;
            let join: Table | undefined;
            let joinOn: Predicate | undefined;
            let predicate: Predicate | undefined;
            const rows = () => {
                const result: Row[] = [];
                for (const row of state[table.name] ?? []) {
                    const base = { [table.name]: row };
                    const joined = join
                        ? (state[join.name] ?? []).filter(other =>
                              matches(joinOn, { ...base, [join!.name]: other })
                          )
                        : [];
                    for (const other of joined.length > 0 ? joined : [null]) {
                        const context = { ...base, ...(join ? { [join.name]: other } : {}) };
                        if (!matches(predicate, context)) continue;
                        result.push(
                            projection
                                ? Object.fromEntries(
                                      Object.entries(projection).map(([name, column]) => [
                                          name,
                                          context[column.table.name]?.[column.column] ?? null,
                                      ])
                                  )
                                : row
                        );
                    }
                }
                return result;
            };
            const query: MockQuery = {
                from(value: Table) {
                    table = value;
                    return query;
                },
                leftJoin(value: Table, on: Predicate) {
                    join = value;
                    joinOn = on;
                    return query;
                },
                where(value: Predicate) {
                    predicate = value;
                    return query;
                },
                limit(count: number) {
                    return Promise.resolve(rows().slice(0, count));
                },
                then(resolve: (value: Row[]) => unknown, reject?: (error: unknown) => unknown) {
                    return Promise.resolve(rows()).then(resolve, reject);
                },
            };
            return query;
        },
        delete(table: Table) {
            return {
                async where(predicate: Predicate) {
                    const removed = (state[table.name] ?? []).filter(row =>
                        matches(predicate, { [table.name]: row })
                    );
                    state[table.name] = (state[table.name] ?? []).filter(
                        row => !removed.includes(row)
                    );
                    if (table.name === "document") {
                        state.documentVersions = state.documentVersions!.filter(
                            version =>
                                !removed.some(
                                    doc => BigInt(doc.id as number) === version.documentId
                                )
                        );
                    }
                },
            };
        },
        async transaction<T>(callback: (tx: MockDatabase) => Promise<T>): Promise<T> {
            const before = Object.fromEntries(
                Object.entries(state).map(([name, rows]) => [name, [...rows]])
            );
            try {
                const result = await callback(database);
                mockStorageEvents.push("commit");
                return result;
            } catch (error) {
                for (const name of Object.keys(state)) delete state[name];
                Object.assign(state, before);
                mockStorageEvents.push("rollback");
                throw error;
            }
        },
    };
    return database;
}

function addDocument(id: number, url: string, category = "Calls") {
    mockState.document!.push({ id, companyId: 5n, url, category, title: `Document ${id}` });
}

function addFile(id: number, storageProvider = "database", storageUrl: string | null = null) {
    mockState.fileUploads!.push({
        id,
        companyId: 5n,
        filename: `file-${id}.md`,
        mimeType: "text/markdown",
        storageProvider,
        storageUrl,
        storagePathname: storageUrl ? new URL(storageUrl).pathname.split(`/${BUCKET}/`)[1] : null,
        fileData:
            storageProvider === "database" ? Buffer.from(`file ${id}`).toString("base64") : null,
    });
}

function authenticate(scope: DocumentScope = { kind: "everything" }) {
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: makeWorkspaceContext({ role: "owner", scope }),
    });
}

function readFile(id: number, token?: string | null) {
    return GET(new Request(`http://app:3000/api/files/${id}${token ? `?t=${token}` : ""}`), {
        params: Promise.resolve({ id: String(id) }),
    });
}

async function deleteStoredDocument(id: number): Promise<void> {
    const blobs = await mockDatabase.transaction(tx =>
        deleteDocumentCore(tx as unknown as Parameters<typeof deleteDocumentCore>[0], id)
    );
    await deleteDocumentBlobs(blobs);
}

function deletionRequest(path: string, body: unknown): Request {
    return new Request(`http://app:3000${path}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

const DENIES_CALL_NOTE: DocumentScope = {
    kind: "except",
    deniedCategories: [],
    deniedDocumentIds: [9],
    allowedDocumentIds: [],
};

beforeEach(() => {
    jest.clearAllMocks();
    mockBlobs.clear();
    mockStorageEvents.length = 0;
    mockFailBlobKeys.clear();
    jest.mocked(recordAuditEvent).mockReset().mockResolvedValue(undefined);
    mockState = { document: [], documentVersions: [], fileUploads: [] };
    mockDatabase = createDatabase(mockState);
    env.server.NEXT_PUBLIC_S3_ENDPOINT = ENDPOINT;
    authenticate();
});

describe("Document deletion transaction boundaries", () => {
    it.each(["single", "batch"])(
        "removes %s-deleted uploads and storage blobs only after commit",
        async mode => {
            const documentIds = mode === "single" ? [9] : [9, 10];
            for (const [index, id] of documentIds.entries()) {
                const fileId = 123 + index;
                const key = `documents/file-${fileId}.md`;
                addFile(fileId, "s3", `${ENDPOINT}/${BUCKET}/${key}`);
                addDocument(id, `/api/files/${fileId}`, "General");
                mockBlobs.set(key, `file ${fileId}`);
            }

            const response =
                mode === "single"
                    ? await deleteDocument(deletionRequest("/api/deleteDocument", { docId: "9" }))
                    : await deleteBatch(
                          deletionRequest("/api/documents/batchDelete", {
                              docIds: documentIds,
                          })
                      );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual(expect.objectContaining({ success: true }));
            expect(mockStorageEvents).toEqual([
                "commit",
                ...documentIds.map((_, index) => `blob:documents/file-${123 + index}.md`),
            ]);
            for (const [index] of documentIds.entries()) {
                expect((await readFile(123 + index)).status).toBe(404);
                expect(mockBlobs.has(`documents/file-${123 + index}.md`)).toBe(false);
            }
            expect(mockState.document).toEqual([]);
        }
    );

    it("restores a failed deletion batch's rows without deleting any blobs", async () => {
        for (const [index, id] of [9, 10].entries()) {
            const fileId = 123 + index;
            const key = `documents/file-${fileId}.md`;
            addFile(fileId, "s3", `${ENDPOINT}/${BUCKET}/${key}`);
            addDocument(id, `/api/files/${fileId}`, "General");
            mockBlobs.set(key, `file ${fileId}`);
            mockState.documentVersions!.push({
                id: index + 1,
                documentId: BigInt(id),
                url: `/api/files/${fileId}`,
            });
        }
        jest.mocked(recordAuditEvent)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("second audit failed"));
        const log = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const response = await deleteBatch(
                deletionRequest("/api/documents/batchDelete", { docIds: [9, 10] })
            );

            expect(response.status).toBe(500);
            expect(mockStorageEvents).toEqual(["rollback"]);
            expect(mockState.document!.map(row => row.id)).toEqual([9, 10]);
            expect(mockState.documentVersions!.map(row => row.documentId)).toEqual([9n, 10n]);
            expect(mockState.fileUploads!.map(row => row.id)).toEqual([123, 124]);
            expect(mockBlobs.get("documents/file-123.md")).toBe("file 123");
            expect(mockBlobs.get("documents/file-124.md")).toBe("file 124");
        } finally {
            log.mockRestore();
        }
    });

    it("keeps a committed deletion successful and continues cleanup after a blob failure", async () => {
        for (const [index, id] of [9, 10].entries()) {
            const fileId = 123 + index;
            const key = `documents/file-${fileId}.md`;
            addFile(fileId, "s3", `${ENDPOINT}/${BUCKET}/${key}`);
            addDocument(id, `/api/files/${fileId}`, "General");
            mockBlobs.set(key, `file ${fileId}`);
        }
        mockFailBlobKeys.add("documents/file-123.md");
        const log = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const response = await deleteBatch(
                deletionRequest("/api/documents/batchDelete", { docIds: [9, 10] })
            );

            expect(response.status).toBe(200);
            expect(mockStorageEvents).toEqual([
                "commit",
                "blob:documents/file-123.md",
                "blob:documents/file-124.md",
            ]);
            expect((await readFile(123)).status).toBe(404);
            expect((await readFile(124)).status).toBe(404);
            expect(mockBlobs.get("documents/file-123.md")).toBe("file 123");
            expect(mockBlobs.has("documents/file-124.md")).toBe(false);
            expect(log).toHaveBeenCalledWith(
                "[document-delete] Failed to delete storage blob:",
                `${ENDPOINT}/${BUCKET}/documents/file-123.md`,
                expect.any(Error)
            );
        } finally {
            log.mockRestore();
        }
    });
});

describe("Call Note stored-file access", () => {
    it.each(["database", "s3", "seaweedfs"])(
        "revokes current and historical %s uploads when their document is deleted",
        async provider => {
            for (const id of [123, 124]) {
                const key = `documents/file-${id}.md`;
                addFile(
                    id,
                    provider,
                    provider === "database" ? null : `${ENDPOINT}/${BUCKET}/${key}`
                );
                mockBlobs.set(key, `file ${id}`);
            }
            addDocument(9, "/api/files/123");
            mockState.documentVersions!.push(
                { id: 1, documentId: 9n, url: "/api/files/123" },
                { id: 2, documentId: 9n, url: "http://app:3000/api/files/124" }
            );
            addFile(200);
            addDocument(10, "/api/files/200", "General");

            await deleteStoredDocument(9);

            expect((await readFile(123)).status).toBe(404);
            expect((await readFile(124)).status).toBe(404);
            const ordinary = await readFile(200);
            expect(ordinary.status).toBe(200);
            expect(await ordinary.text()).toBe("file 200");
            if (provider !== "database") {
                expect(mockBlobs.has("documents/file-123.md")).toBe(false);
                expect(mockBlobs.has("documents/file-124.md")).toBe(false);
            }
        }
    );

    it("deletes upload rows linked by external storage URL as well as their blobs", async () => {
        const url = `${ENDPOINT}/${BUCKET}/documents/call.md`;
        mockBlobs.set("documents/call.md", "call note");
        addFile(123, "s3", url);
        addDocument(9, url);

        await deleteStoredDocument(9);

        expect((await readFile(123)).status).toBe(404);
        expect(mockBlobs.has("documents/call.md")).toBe(false);
    });

    it("deletes native S3 current and historical blobs without upload rows", async () => {
        addDocument(9, `${ENDPOINT}/${BUCKET}/documents/current.md`);
        mockState.documentVersions!.push({
            id: 1,
            documentId: 9n,
            url: `${ENDPOINT}/${BUCKET}/documents/previous.md`,
        });
        mockBlobs.set("documents/current.md", "current call note");
        mockBlobs.set("documents/previous.md", "previous call note");

        await deleteStoredDocument(9);

        expect(mockBlobs.has("documents/current.md")).toBe(false);
        expect(mockBlobs.has("documents/previous.md")).toBe(false);
    });

    it.each([false, true])(
        "denies an ineligible Call Note's internally referenced bytes (historical=%s)",
        async historical => {
            authenticate(DENIES_CALL_NOTE);
            addFile(123);
            addDocument(9, historical ? "/api/files/456" : "/api/files/123");
            if (historical) {
                mockState.documentVersions!.push({ id: 1, documentId: 9n, url: "/api/files/123" });
            }

            expect((await readFile(123)).status).toBe(404);
        }
    );

    it.each([false, true])(
        "denies an ineligible Call Note's externally referenced bytes (historical=%s)",
        async historical => {
            authenticate(DENIES_CALL_NOTE);
            const url = `${ENDPOINT}/${BUCKET}/documents/call.md`;
            addFile(123, "s3", url);
            addDocument(9, historical ? "/api/files/456" : url);
            if (historical) {
                mockState.documentVersions!.push({ id: 1, documentId: 9n, url });
            }

            expect((await readFile(123)).status).toBe(404);
        }
    );

    it("keeps an ordinary document readable while another Call Note is denied", async () => {
        authenticate(DENIES_CALL_NOTE);
        addFile(123);
        addDocument(10, "/api/files/123", "General");

        const response = await readFile(123);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("file 123");
    });

    it("preserves an upload still referenced by another document's historical version", async () => {
        addFile(123);
        addDocument(9, "/api/files/123");
        addDocument(10, "/api/files/456", "General");
        mockState.documentVersions!.push({ id: 1, documentId: 10n, url: "/api/files/123" });

        await deleteStoredDocument(9);
        authenticate(DENIES_CALL_NOTE);
        const response = await readFile(123);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("file 123");
    });

    it.each(
        [
            "/api/files/123?download=1",
            "/api/files/123#note",
            "/api/files/123/",
            "http://app:3000/api/files/123/?download=1#note",
            "/api/files/00123",
            "/api/other/../files/123",
        ].flatMap(url => [
            { url, historical: false },
            { url, historical: true },
        ])
    )(
        "preserves shared upload alias $url (historical=$historical)",
        async ({ url, historical }) => {
            addFile(123);
            addDocument(9, "/api/files/123");
            addDocument(10, historical ? "/api/files/456" : url, "General");
            if (historical) {
                mockState.documentVersions!.push({ id: 1, documentId: 10n, url });
            }

            await deleteStoredDocument(9);

            const response = await readFile(123);
            expect(response.status).toBe(200);
            expect(await response.text()).toBe("file 123");
        }
    );

    it.each([false, true])(
        "preserves an external upload's blob shared by an internal alias (historical=%s)",
        async historical => {
            const url = `${ENDPOINT}/${BUCKET}/documents/shared.md`;
            const alias = "http://app:3000/api/files/123/?download=1#note";
            addFile(123, "s3", url);
            mockBlobs.set("documents/shared.md", "shared document");
            addDocument(9, url);
            addDocument(10, historical ? "/api/files/456" : alias, "General");
            if (historical) {
                mockState.documentVersions!.push({ id: 1, documentId: 10n, url: alias });
            }

            await deleteStoredDocument(9);

            expect(mockState.fileUploads!.map(row => row.id)).toEqual([123]);
            expect(mockBlobs.get("documents/shared.md")).toBe("shared document");
            expect(mockStorageEvents).toEqual(["commit"]);
        }
    );

    it("does not confuse a longer internal file id with a shared upload", async () => {
        addFile(123, "s3", `${ENDPOINT}/${BUCKET}/documents/deleted.md`);
        mockBlobs.set("documents/deleted.md", "deleted document");
        addDocument(9, "/api/files/123");
        addFile(1234);
        addDocument(10, "/api/files/1234?download=1", "General");

        await deleteStoredDocument(9);

        expect((await readFile(123)).status).toBe(404);
        expect(mockBlobs.has("documents/deleted.md")).toBe(false);
        const remaining = await readFile(1234);
        expect(remaining.status).toBe(200);
        expect(await remaining.text()).toBe("file 1234");
    });

    it("keeps the signed OCR-worker path working before a document exists", async () => {
        addFile(123);
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: new Response(null, { status: 401 }),
        });

        const response = await readFile(123, signFileAccessToken("123", SECRET));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("file 123");
    });
});

describe("S3 deletion by URL", () => {
    it.each([
        [ENDPOINT, `${ENDPOINT}/${BUCKET}/documents/call.md`],
        ["http://s3.example.test", "http://notes.s3.example.test/documents/call.md"],
        ["http://notes.s3.example.test", "http://notes.s3.example.test/documents/call.md"],
        [ENDPOINT, `${ENDPOINT}/${BUCKET}/documents/call%20note.md?download=1`],
    ])("removes the object for endpoint %s and URL %s", async (endpoint, url) => {
        env.server.NEXT_PUBLIC_S3_ENDPOINT = endpoint;
        const key = url.includes("%20") ? "documents/call note.md" : "documents/call.md";
        mockBlobs.set(key, "call note");

        await deleteFileByUrl(url);

        expect(mockBlobs.has(key)).toBe(false);
    });

    it.each([
        "http://s3.example.test.evil/storage/notes/documents/call.md",
        "http://s3.example.test/storage/notes-other/documents/call.md",
        "http://s3.example.test/storage-other/notes/documents/call.md",
        "http://notes.s3.example.test.evil/storage/documents/call.md",
    ])("does not delete an object for an unrelated endpoint or bucket: %s", async url => {
        mockBlobs.set("documents/call.md", "call note");

        await deleteFileByUrl(url);

        expect(mockBlobs.get("documents/call.md")).toBe("call note");
    });
});
