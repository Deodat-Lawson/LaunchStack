/**
 * The /dev/extract harness answers every `/api/extraction/**` route of the
 * wire contract from memory, and the Extract tab is looked at against it.
 * These tests pin what the harness promises to show — the seeded tables, a
 * run filling row by row, a failed row and its retry, values read from an
 * image, a row the viewer cannot open — so a screenshot of it means what it
 * seems to.
 */
import { configureExtractSim, exportCsv, simulateExtraction } from "~/app/dev/extract/extract-sim";
import {
    EXTRACTION_LIMITS,
    type ExtractionSourceOption,
    type ExtractionTableSummary,
    type ExtractionTableView,
} from "~/lib/extraction/types";

const T0 = Date.parse("2026-11-12T12:00:00Z");

async function call<T>(
    path: string,
    init?: RequestInit,
    now = T0
): Promise<{ status: number; body: T }> {
    const response = await simulateExtraction(new URL(path, "http://harness.local"), init, now);
    if (!response) throw new Error(`no answer for ${path}`);
    return { status: response.status, body: (await response.json()) as T };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const table = async (id: number, now = T0) =>
    (await call<{ table: ExtractionTableView }>(`/api/extraction/${id}`, undefined, now)).body
        .table;

beforeEach(() => configureExtractSim({ empty: false }));

describe("extract harness: what it starts with", () => {
    it("lists about two dozen documents in folders, images among them, one not yet indexed", async () => {
        const { body } = await call<{ sources: ExtractionSourceOption[] }>(
            "/api/extraction/sources"
        );
        expect(body.sources).toHaveLength(26);
        expect(new Set(body.sources.map(s => s.documentId)).size).toBe(26);
        expect(body.sources.filter(s => !s.indexed).map(s => s.title)).toEqual(["Scan 0412.pdf"]);
        expect(body.sources.filter(s => s.kind === "image").length).toBe(6);
        expect(new Set(body.sources.map(s => s.folder))).toEqual(
            new Set(["Finance/Invoices 2026", "Finance/Receipts", "Legal/Supplier contracts", null])
        );
        for (const source of body.sources) expect(source.sourceId).toBe(`d${source.documentId}`);
    });

    it("lists a finished table, a running one and a colleague's shared one, newest first", async () => {
        const { body } = await call<{ tables: ExtractionTableSummary[] }>("/api/extraction");
        expect(body.tables.map(t => [t.id, t.status, t.mine, t.shared])).toEqual([
            [2, "running", true, false],
            [1, "done", true, false],
            [3, "done", false, true],
        ]);
        expect(body.tables[2]!.createdByName).toBe("Ingrid Vasquez-Moll");
        for (const t of body.tables) {
            const c = t.counts;
            expect(c.pending + c.running + c.done + c.failed).toBe(c.total);
        }
    });

    it("starts with nothing when asked to", async () => {
        configureExtractSim({ empty: true });
        expect((await call<{ tables: unknown[] }>("/api/extraction")).body.tables).toEqual([]);
    });
});

describe("extract harness: the finished table", () => {
    it("shows every state the grid has to draw", async () => {
        const t = await table(1);
        expect(t.status).toBe("done");
        expect(t.canManage).toBe(true);
        expect(t.fields.map(f => f.type)).toEqual([
            "text",
            "text",
            "date",
            "number",
            "text",
            "boolean",
            "list",
        ]);
        expect(t.counts).toEqual({ total: 15, pending: 0, running: 0, done: 14, failed: 1 });

        const failed = t.rows.filter(r => r.status === "failed");
        expect(failed).toHaveLength(1);
        expect(failed[0]!.error).toBeTruthy();
        expect(failed[0]!.cells).toEqual({});

        const cells = t.rows.flatMap(r => Object.values(r.cells));
        expect(cells.filter(c => c.status === "not_found").length).toBeGreaterThanOrEqual(3);
        expect(cells.filter(c => c.via === "vision")).toHaveLength(2);
        for (const cell of cells) {
            if (cell.status === "found") {
                expect(cell.value).not.toBeNull();
                expect(cell.quote).toBeTruthy();
                expect(cell.quote!.length).toBeLessThanOrEqual(EXTRACTION_LIMITS.quoteLength);
            } else {
                expect([cell.value, cell.quote, cell.page]).toEqual([null, null, null]);
            }
        }
        // Read from the picture only on picture files.
        for (const row of t.rows) {
            if (Object.values(row.cells).some(c => c.via === "vision"))
                expect(row.title).toMatch(/\.(jpg|png)$/);
        }
        // A list long enough to need "+n", and a number big enough to need separators.
        const lists = cells
            .filter(c => Array.isArray(c.value))
            .map(c => (c.value as string[]).length);
        expect(Math.max(...lists)).toBeGreaterThan(10);
        const numbers = cells.map(c => c.value).filter((v): v is number => typeof v === "number");
        expect(Math.max(...numbers)).toBeGreaterThan(1_000_000);
        // Values keep the type of their column.
        for (const row of t.rows) {
            for (const field of t.fields) {
                const cell = row.cells[field.id];
                if (cell?.status !== "found") continue;
                if (field.type === "number") expect(typeof cell.value).toBe("number");
                if (field.type === "boolean") expect(typeof cell.value).toBe("boolean");
                if (field.type === "list") expect(Array.isArray(cell.value)).toBe(true);
                if (field.type === "date") expect(cell.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            }
        }
    });

    it("retries the failed row, which then reads", async () => {
        const before = await table(1);
        const failed = before.rows.find(r => r.status === "failed")!;
        const { body } = await call<{ table: ExtractionTableView }>(
            "/api/extraction/1/rerun",
            post({ rowIds: [failed.id] })
        );
        expect(body.table.status).toBe("running");
        expect(body.table.counts.failed).toBe(0);
        const after = await table(1, T0 + 10_000);
        expect(after.status).toBe("done");
        expect(after.counts).toEqual({ total: 15, pending: 0, running: 0, done: 15, failed: 0 });
        expect(Object.keys(after.rows.find(r => r.id === failed.id)!.cells)).toHaveLength(7);
        // Nothing left to retry.
        expect((await call("/api/extraction/1/rerun", post({}), T0 + 11_000)).status).toBe(409);
    });

    it("exports a CSV with a row per document", () => {
        const file = exportCsv(1, T0)!;
        expect(file.name).toBe("Q3-vendor-invoices.csv");
        const lines = file.content.trim().split("\r\n");
        expect(lines).toHaveLength(16);
        expect(lines[0]).toContain("Vendor,Vendor — quote,Vendor — page");
        expect(file.content).toContain("1284500");
        expect(exportCsv(999, T0)).toBeNull();
    });
});

describe("extract harness: a run in progress", () => {
    it("fills row by row until it is done", async () => {
        const early = await table(2);
        expect(early.status).toBe("running");
        expect(early.counts).toEqual({ total: 10, pending: 5, running: 2, done: 3, failed: 0 });
        const later = await table(2, T0 + 5_000);
        expect(later.counts.done).toBe(5);
        const end = await table(2, T0 + 60_000);
        expect(end.status).toBe("done");
        expect(end.counts.done).toBe(10);
        expect(end.finishedAt).not.toBeNull();
        // A document with none of the fields reads as a row of "not found".
        const board = end.rows.find(r => r.title.startsWith("Board pack"))!;
        expect(Object.values(board.cells).every(c => c.status === "not_found")).toBe(true);
    });

    it("stops when cancelled and leaves the rest unread", async () => {
        const { body } = await call<{ table: ExtractionTableView }>(
            "/api/extraction/2/cancel",
            post({})
        );
        expect(body.table.status).toBe("cancelled");
        expect(body.table.counts).toEqual({
            total: 10,
            pending: 7,
            running: 0,
            done: 3,
            failed: 0,
        });
        expect((await table(2, T0 + 60_000)).counts.done).toBe(3);
    });
});

describe("extract harness: a shared table", () => {
    it("withholds the row the viewer cannot open, and cannot be managed", async () => {
        const t = await table(3);
        expect(t.canManage).toBe(false);
        const withheld = t.rows.filter(r => !r.readable);
        expect(withheld).toHaveLength(1);
        expect(withheld[0]!.cells).toEqual({});
        expect((await call("/api/extraction/3", { method: "DELETE" })).status).toBe(403);
        expect(
            (
                await call("/api/extraction/3", {
                    method: "PATCH",
                    body: JSON.stringify({ title: "x" }),
                })
            ).status
        ).toBe(403);
    });
});

describe("extract harness: making and managing a table", () => {
    const body = {
        title: "Receipts check",
        fields: [
            { name: "Vendor", type: "text" },
            { name: "总金额", type: "number" },
            { name: "Favourite colour", type: "text", instruction: "Not in any document" },
        ],
        documentIds: [110, 111, 112],
    };

    it("creates a table that reads its documents over the next seconds", async () => {
        const created = await call<{ table: ExtractionTableView }>("/api/extraction", post(body));
        expect(created.status).toBe(201);
        const id = created.body.table.id;
        expect(created.body.table.status).toBe("queued");
        expect(created.body.table.fields.map(f => f.id)).toEqual(["f1", "f2", "f3"]);
        expect(created.body.table.rows.map(r => r.sourceId)).toEqual(["d110", "d111", "d112"]);

        const mid = await table(id, T0 + 1_300);
        expect(mid.status).toBe("running");
        expect(mid.counts.done).toBe(1);
        const done = await table(id, T0 + 5_000);
        expect(done.status).toBe("done");
        const taxi = done.rows[0]!;
        expect(taxi.cells.f1).toMatchObject({ status: "found", value: "Citybound Cabs" });
        // A Chinese field name finds the same fact; this one was read from the image.
        expect(taxi.cells.f2).toMatchObject({ status: "found", value: 46.8, via: "vision" });
        expect(taxi.cells.f3!.status).toBe("not_found");
    });

    it("refuses a table with no fields, repeated names, or a document still being processed", async () => {
        expect((await call("/api/extraction", post({ ...body, fields: [] }))).status).toBe(400);
        expect((await call("/api/extraction", post({ ...body, documentIds: [] }))).status).toBe(
            400
        );
        expect(
            (
                await call(
                    "/api/extraction",
                    post({ ...body, fields: [body.fields[0], { name: "vendor", type: "text" }] })
                )
            ).status
        ).toBe(400);
        expect((await call("/api/extraction", post({ ...body, documentIds: [131] }))).status).toBe(
            400
        );
    });

    it("renames, shares and deletes", async () => {
        const renamed = await call<{ table: ExtractionTableView }>("/api/extraction/1", {
            method: "PATCH",
            body: JSON.stringify({ title: "Invoices, third quarter", shared: true }),
        });
        expect(renamed.body.table).toMatchObject({
            title: "Invoices, third quarter",
            shared: true,
        });
        expect((await call("/api/extraction/1", { method: "DELETE" })).body).toEqual({ ok: true });
        expect((await call("/api/extraction/1")).status).toBe(404);
        expect((await call("/api/extraction/77")).status).toBe(404);
    });
});
