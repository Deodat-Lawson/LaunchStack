/**
 * Extraction access rules and validation, against a mocked store (no
 * database): a table is private to its creator until shared; only the
 * creator manages it; a new table keeps only documents its creator can read;
 * a reader sees a row's title and cells only for documents they can open;
 * rows can be run again only once the table has stopped.
 */
import type {
    ExtractionRowRecord,
    ExtractionTableRecord,
} from "@launchstack/pipelines/extraction/types";

import { EXTRACTION_LIMITS } from "~/lib/extraction/types";

import { makeWorkspaceContext } from "../helpers/workspace-context";

jest.mock("~/server/ai-usage/refusal", () => ({
    assertWithinAiAllowance: jest.fn(async () => undefined),
}));
jest.mock("~/server/extraction/store", () => ({
    EMPTY_COUNTS: { total: 0, pending: 0, running: 0, done: 0, failed: 0 },
    getCompanyTable: jest.fn(),
    listVisibleTables: jest.fn(),
    countRowsByTable: jest.fn(async () => new Map()),
    listTableRows: jest.fn(async () => []),
    insertTable: jest.fn(),
    updateTableMeta: jest.fn(),
    deleteTable: jest.fn(),
    requestCancel: jest.fn(),
    requeueRows: jest.fn(),
    readableDocuments: jest.fn(async () => []),
    listReadableSourceRows: jest.fn(async () => []),
}));
jest.mock("~/server/extraction/executor", () => ({
    dispatchTable: jest.fn(),
    resumeIfStalled: jest.fn(),
    readExtractionExecutor: jest.fn(() => "inline"),
}));
jest.mock("@launchstack/pipelines/extraction/db", () => {
    const finish = jest.fn();
    return { createExtractionStore: () => ({ finish }), __finish: finish };
});
jest.mock("~/server/profile/store", () => ({
    workspaceLooks: jest.fn(async (_companyId: bigint, ids: Iterable<string>) => {
        const out = new Map();
        for (const id of ids)
            out.set(id, { displayName: id === "creator" ? "Ana" : "Bo", member: id !== "gone" });
        return out;
    }),
}));

import {
    cancelExtractionTable,
    cleanFields,
    createExtractionTable,
    defaultTitle,
    deleteExtractionTable,
    exportExtractionTable,
    ExtractionError,
    extractionSourceOptions,
    findExtractionTable,
    getExtractionTable,
    listExtractionTables,
    pollExtractionTable,
    rerunExtractionTable,
    updateExtractionTable,
} from "~/server/extraction/service";

type Mocks<K extends string> = Record<K, jest.Mock>;
const store = jest.requireMock<
    Mocks<
        | "getCompanyTable"
        | "listVisibleTables"
        | "countRowsByTable"
        | "listTableRows"
        | "insertTable"
        | "updateTableMeta"
        | "deleteTable"
        | "requestCancel"
        | "requeueRows"
        | "readableDocuments"
        | "listReadableSourceRows"
    >
>("~/server/extraction/store");
const executor = jest.requireMock<
    Mocks<"dispatchTable" | "resumeIfStalled" | "readExtractionExecutor">
>("~/server/extraction/executor");
const { __finish: finish } = jest.requireMock<{ __finish: jest.Mock }>(
    "@launchstack/pipelines/extraction/db"
);
const { assertWithinAiAllowance } = jest.requireMock<Mocks<"assertWithinAiAllowance">>(
    "~/server/ai-usage/refusal"
);

const creator = makeWorkspaceContext({ authUserId: "creator", companyId: BigInt(5) });
const reader = makeWorkspaceContext({ authUserId: "reader", companyId: BigInt(5) });

function table(overrides: Partial<ExtractionTableRecord> = {}): ExtractionTableRecord {
    return {
        id: 7,
        companyId: BigInt(5),
        createdByUserId: "creator",
        title: "Supplier contracts",
        fields: [
            { id: "f1", name: "Supplier", type: "text" },
            { id: "f2", name: "Annual fee", type: "number" },
        ],
        status: "done",
        usage: { calls: 2, inputTokens: 100, outputTokens: 20 },
        error: null,
        sharedAt: null,
        cancelRequestedAt: null,
        leaseUntil: null,
        createdAt: new Date("2026-11-12T08:00:00Z"),
        startedAt: new Date("2026-11-12T08:00:01Z"),
        finishedAt: new Date("2026-11-12T08:02:00Z"),
        ...overrides,
    };
}

function row(id: number, documentId: number, over: Partial<ExtractionRowRecord> = {}) {
    return {
        id,
        tableId: 7,
        companyId: BigInt(5),
        documentId,
        documentTitle: `Doc ${documentId}.pdf`,
        status: "done",
        cells: {
            f1: {
                status: "found",
                value: `Supplier ${documentId}`,
                quote: "q",
                page: 1,
                via: "text",
            },
        },
        error: null,
        attempts: 1,
        ...over,
    } as ExtractionRowRecord;
}

async function failure(promise: Promise<unknown>): Promise<ExtractionError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(ExtractionError);
        return error as ExtractionError;
    }
    throw new Error("expected the call to be refused");
}

beforeEach(() => {
    jest.clearAllMocks();
    executor.readExtractionExecutor.mockReturnValue("inline");
    store.listTableRows.mockResolvedValue([]);
    store.readableDocuments.mockResolvedValue([]);
});

describe("field validation", () => {
    const field = (name: string, type = "text", instruction?: string) => ({
        name,
        type,
        instruction,
    });

    it("gives fields the ids f1…fn and trims what it keeps", () => {
        expect(
            cleanFields([field("  Supplier  "), field("Fee", "number", "  In dollars ")])
        ).toEqual([
            { id: "f1", name: "Supplier", type: "text" },
            { id: "f2", name: "Fee", type: "number", instruction: "In dollars" },
        ]);
    });

    it.each([
        ["no fields", [], "Add at least one field."],
        ["a non-array", "Supplier", "Add at least one field."],
        [
            "too many fields",
            Array.from({ length: EXTRACTION_LIMITS.maxFields + 1 }, (_, i) => field(`F${i}`)),
            "Use at most 30 fields.",
        ],
        ["an empty name", [field("   ")], "Every field needs a name."],
        ["a long name", [field("x".repeat(81))], "Keep field names under 80 characters."],
        [
            "a repeated name, whatever its case",
            [field("Supplier"), field("supplier")],
            'Two fields are called "supplier". Give each field its own name.',
        ],
        [
            "an unknown type",
            [field("Fee", "money")],
            'The field "Fee" has a type that isn\'t supported.',
        ],
        [
            "a long instruction",
            [field("Fee", "number", "x".repeat(501))],
            "Keep each field's instruction under 500 characters.",
        ],
    ])("refuses %s", (_what, input, message) => {
        expect(() => cleanFields(input)).toThrow(message);
    });

    it("names a table after its fields, in the reader's language", () => {
        const fields = cleanFields(["A", "B", "C", "D", "E"].map(name => field(name)));
        expect(defaultTitle(fields.slice(0, 2))).toBe("A, B");
        expect(defaultTitle(fields)).toBe("A, B, C and 2 more");
        expect(defaultTitle(fields, "zh-CN")).toBe("A、B、C 等 2 项");
    });
});

describe("createExtractionTable", () => {
    const body = {
        fields: [{ name: "Supplier", type: "text" as const }],
        documentIds: [12, 13, 12],
    };

    it("keeps only the documents the creator can read, in the order picked, then dispatches", async () => {
        store.readableDocuments.mockResolvedValue([{ id: 13, title: "B.pdf" }]);
        store.insertTable.mockImplementation(async input =>
            table({ title: input.title, status: "queued" })
        );
        store.listTableRows.mockResolvedValue([row(1, 13, { status: "pending", cells: {} })]);

        const view = await createExtractionTable(creator, body);

        expect(store.readableDocuments).toHaveBeenCalledWith(
            BigInt(5),
            expect.anything(),
            [12, 13]
        );
        expect(store.insertTable).toHaveBeenCalledWith({
            companyId: BigInt(5),
            createdByUserId: "creator",
            title: "Supplier",
            fields: [{ id: "f1", name: "Supplier", type: "text" }],
            documents: [{ id: 13, title: "B.pdf" }],
        });
        expect(assertWithinAiAllowance).toHaveBeenCalledWith(BigInt(5), "creator");
        expect(executor.dispatchTable).toHaveBeenCalledTimes(1);
        expect(view).toMatchObject({
            status: "queued",
            canManage: true,
            mine: true,
            createdByName: "Ana",
            counts: { total: 1, pending: 1 },
        });
    });

    it("refuses when none of the picked documents can be read, before anything is stored", async () => {
        const error = await failure(createExtractionTable(creator, body));
        expect(error).toMatchObject({ status: 400, code: "no_documents" });
        expect(store.insertTable).not.toHaveBeenCalled();
        expect(executor.dispatchTable).not.toHaveBeenCalled();
    });

    it("refuses no documents, too many, and ids that are not ids", async () => {
        const fields = body.fields;
        expect(
            (await failure(createExtractionTable(creator, { fields, documentIds: [] }))).message
        ).toBe("Pick at least one document.");
        expect(
            (
                await failure(
                    createExtractionTable(creator, {
                        fields,
                        documentIds: [0, -3, 1.5, "12" as unknown as number],
                    })
                )
            ).message
        ).toBe("Pick at least one document.");
        const many = Array.from({ length: EXTRACTION_LIMITS.maxDocuments + 1 }, (_, i) => i + 1);
        expect(
            (await failure(createExtractionTable(creator, { fields, documentIds: many }))).message
        ).toBe("Pick at most 500 documents.");
    });

    it("stores nothing for a person at their AI allowance", async () => {
        store.readableDocuments.mockResolvedValue([{ id: 12, title: "A.pdf" }]);
        assertWithinAiAllowance.mockRejectedValueOnce(new Error("allowance"));
        await expect(createExtractionTable(creator, body)).rejects.toThrow("allowance");
        expect(store.insertTable).not.toHaveBeenCalled();
    });

    it("takes documents.read", async () => {
        const viewer = makeWorkspaceContext({ authUserId: "creator", permissions: [] });
        expect(await failure(createExtractionTable(viewer, body))).toMatchObject({ status: 403 });
    });
});

describe("visibility", () => {
    it("hides a private table from everyone but its creator, as if it did not exist", async () => {
        store.getCompanyTable.mockResolvedValue(table());
        expect(await failure(getExtractionTable(reader, 7))).toMatchObject({
            status: 404,
            code: "not_found",
        });
        expect(await findExtractionTable(reader, 7)).toBeNull();
        expect((await getExtractionTable(creator, 7)).canManage).toBe(true);
    });

    it("shows a shared table to a colleague, who cannot manage it", async () => {
        store.getCompanyTable.mockResolvedValue(table({ sharedAt: new Date() }));
        store.listTableRows.mockResolvedValue([row(1, 12), row(2, 13)]);
        store.readableDocuments.mockResolvedValue([{ id: 12, title: "Doc 12.pdf" }]);

        const view = await getExtractionTable(reader, 7);

        expect(view).toMatchObject({
            canManage: false,
            mine: false,
            shared: true,
            createdByName: "Ana",
        });
        // The colleague can open d12 but not d13: that row gives up its title and cells.
        expect(view.rows[0]).toMatchObject({
            sourceId: "d12",
            title: "Doc 12.pdf",
            readable: true,
        });
        expect(view.rows[0]!.cells.f1!.value).toBe("Supplier 12");
        expect(view.rows[1]).toEqual({
            id: 2,
            documentId: 13,
            sourceId: "d13",
            status: "done",
            title: "A file you don't have access to",
            cells: {},
            error: null,
            readable: false,
        });
        // Counts are the table's, withheld rows included.
        expect(view.counts).toEqual({ total: 2, pending: 0, running: 0, done: 2, failed: 0 });
    });

    it("withholds from the creator too, once they can no longer open a document", async () => {
        store.getCompanyTable.mockResolvedValue(table());
        store.listTableRows.mockResolvedValue([row(1, 12)]);
        const view = await getExtractionTable(creator, 7);
        expect(view.rows[0]).toMatchObject({ readable: false, cells: {} });
    });

    it("leaves withheld rows out of an export", async () => {
        store.getCompanyTable.mockResolvedValue(table({ sharedAt: new Date() }));
        store.listTableRows.mockResolvedValue([row(1, 12), row(2, 13)]);
        store.readableDocuments.mockResolvedValue([{ id: 12, title: "Doc 12.pdf" }]);

        const file = await exportExtractionTable(reader, 7, "csv");

        expect(file.contentType).toBe("text/csv; charset=utf-8");
        expect(file.disposition).toContain('filename="Supplier contracts.csv"');
        expect(file.body).toContain("Doc 12.pdf,Supplier 12");
        expect(file.body).not.toContain("Supplier 13");
        expect(await failure(exportExtractionTable(reader, 7, "pdf"))).toMatchObject({
            status: 400,
        });
    });

    it("words a row's failure for the reader and keeps the provider's detail out", async () => {
        store.getCompanyTable.mockResolvedValue(table());
        store.listTableRows.mockResolvedValue([
            row(1, 12, {
                status: "failed",
                cells: {},
                error: "This file could not be read: 429 from api.example.test, key sk-…",
            }),
            row(2, 13, { status: "failed", cells: {}, error: "This file is no longer available." }),
        ]);
        store.readableDocuments.mockResolvedValue([
            { id: 12, title: "a" },
            { id: 13, title: "b" },
        ]);

        const en = await getExtractionTable(creator, 7);
        expect(en.rows.map(r => r.error)).toEqual([
            "This file could not be read.",
            "This file is no longer available.",
        ]);
        const zh = await getExtractionTable(creator, 7, "zh-CN");
        expect(zh.rows.map(r => r.error)).toEqual(["未能读取该文件。", "该文件已不可用。"]);
    });

    it("lists tables with their counts and says whose they are", async () => {
        store.listVisibleTables.mockResolvedValue([
            table(),
            table({ id: 8, createdByUserId: "gone", sharedAt: new Date() }),
        ]);
        store.countRowsByTable.mockResolvedValue(
            new Map([[7, { total: 3, pending: 0, running: 0, done: 2, failed: 1 }]])
        );
        const list = await listExtractionTables(creator);
        expect(list[0]).toMatchObject({ id: 7, mine: true, fieldCount: 2, counts: { failed: 1 } });
        expect(list[1]).toMatchObject({
            id: 8,
            mine: false,
            shared: true,
            createdByName: "Someone who has left",
            counts: { total: 0 },
        });
    });

    it("resumes a stalled table only when its screen polls it", async () => {
        store.getCompanyTable.mockResolvedValue(table({ status: "running" }));
        await getExtractionTable(creator, 7);
        expect(executor.resumeIfStalled).not.toHaveBeenCalled();
        await pollExtractionTable(creator, 7);
        expect(executor.resumeIfStalled).toHaveBeenCalledTimes(1);
    });
});

describe("managing a table", () => {
    it("is the creator's alone: a colleague is refused on a shared table", async () => {
        store.getCompanyTable.mockResolvedValue(table({ sharedAt: new Date() }));
        for (const attempt of [
            updateExtractionTable(reader, 7, { title: "Mine now" }),
            deleteExtractionTable(reader, 7),
            cancelExtractionTable(reader, 7),
            rerunExtractionTable(reader, 7, undefined),
        ]) {
            expect(await failure(attempt)).toMatchObject({ status: 403, code: "forbidden" });
        }
        expect(store.updateTableMeta).not.toHaveBeenCalled();
        expect(store.deleteTable).not.toHaveBeenCalled();
        expect(store.requeueRows).not.toHaveBeenCalled();
    });

    it("renames and shares, and refuses an empty title", async () => {
        store.getCompanyTable.mockResolvedValue(table());
        await updateExtractionTable(creator, 7, { title: "  Q4  contracts ", shared: true });
        expect(store.updateTableMeta).toHaveBeenCalledWith(
            BigInt(5),
            7,
            { title: "Q4 contracts", shared: true },
            expect.any(Date)
        );
        expect((await failure(updateExtractionTable(creator, 7, { title: "  " }))).message).toBe(
            "A title can't be empty."
        );
    });

    it("cancels at once when no executor holds the table, and by flag when one does", async () => {
        store.getCompanyTable.mockResolvedValue(table({ status: "running" }));
        await cancelExtractionTable(creator, 7);
        expect(store.requestCancel).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledWith(7, "cancelled", null, expect.any(Date));

        finish.mockClear();
        store.getCompanyTable.mockResolvedValue(
            table({ status: "running", leaseUntil: new Date(Date.now() + 60_000) })
        );
        await cancelExtractionTable(creator, 7);
        expect(finish).not.toHaveBeenCalled();

        store.requestCancel.mockClear();
        store.getCompanyTable.mockResolvedValue(table({ status: "done" }));
        await cancelExtractionTable(creator, 7);
        expect(store.requestCancel).not.toHaveBeenCalled();
    });

    it("runs failed rows again, or the rows named, and dispatches", async () => {
        store.getCompanyTable.mockResolvedValue(table({ status: "failed" }));
        store.requeueRows.mockResolvedValue(2);

        await rerunExtractionTable(creator, 7, undefined);
        expect(store.requeueRows).toHaveBeenLastCalledWith(BigInt(5), 7, null);
        await rerunExtractionTable(creator, 7, [4, 4, 9, "x", -1]);
        expect(store.requeueRows).toHaveBeenLastCalledWith(BigInt(5), 7, [4, 9]);
        expect(executor.dispatchTable).toHaveBeenCalledTimes(2);
        expect(assertWithinAiAllowance).toHaveBeenCalledTimes(2);
    });

    it("refuses to run rows again while the table is running, or with nothing to run", async () => {
        for (const status of ["queued", "running"] as const) {
            store.getCompanyTable.mockResolvedValue(table({ status }));
            expect(await failure(rerunExtractionTable(creator, 7, undefined))).toMatchObject({
                status: 409,
                code: "still_running",
            });
        }
        expect(store.requeueRows).not.toHaveBeenCalled();

        store.getCompanyTable.mockResolvedValue(table({ status: "done" }));
        store.requeueRows.mockResolvedValue(0);
        expect(await failure(rerunExtractionTable(creator, 7, undefined))).toMatchObject({
            status: 409,
            code: "nothing_to_rerun",
        });
        expect(await failure(rerunExtractionTable(creator, 7, []))).toMatchObject({ status: 400 });
        expect(executor.dispatchTable).not.toHaveBeenCalled();
    });
});

describe("extractionSourceOptions", () => {
    it("offers what the viewer can read, with folder, kind and readiness", async () => {
        store.listReadableSourceRows.mockResolvedValue([
            {
                id: 12,
                title: "Acme MSA.pdf",
                folder: "Clients/Acme",
                mimeType: null,
                processed: true,
            },
            { id: 13, title: "Receipt", folder: "", mimeType: "image/png", processed: false },
        ]);
        expect(await extractionSourceOptions(creator)).toEqual([
            {
                documentId: 12,
                sourceId: "d12",
                title: "Acme MSA.pdf",
                folder: "Clients/Acme",
                kind: "pdf",
                indexed: true,
            },
            {
                documentId: 13,
                sourceId: "d13",
                title: "Receipt",
                folder: null,
                kind: "image",
                indexed: false,
            },
        ]);
    });
});
