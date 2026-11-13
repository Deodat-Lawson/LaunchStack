/**
 * The Extract tool's plain functions: which screen a location shows, how a
 * value reads and sorts, what is wrong with a field, and how many documents
 * get selected at once.
 */
import {
    dateMs,
    filterRows,
    formatDate,
    formatNumber,
    isLive,
    listPreview,
    nextSort,
    progressOf,
    sortRows,
    valueText,
} from "~/app/employer/tools/extract/_lib/cells";
import {
    addToSelection,
    findSources,
    groupByFolder,
    reconcileSelection,
    removeFromSelection,
    sourcesUnderFolder,
} from "~/app/employer/tools/extract/_lib/documents";
import {
    STARTER_HINTS,
    STARTER_SETS,
    blankField,
    fieldProblems,
    isUntouched,
    moveField,
    starterHintKey,
    toFieldInputs,
    type FieldDraft,
} from "~/app/employer/tools/extract/_lib/fields";
import { askHref, sourceHref } from "~/app/employer/tools/extract/_lib/links";
import {
    extractScreenFor,
    newPath,
    parseDocIds,
    tablePath,
} from "~/app/employer/tools/extract/_lib/screens";
import en from "~/i18n/messages/en/extract.json";
import zh from "~/i18n/messages/zh-CN/extract.json";
import {
    EXTRACTION_LIMITS,
    type ExtractionCell,
    type ExtractionField,
    type ExtractionRowView,
    type ExtractionSourceOption,
    type ExtractionValue,
} from "~/lib/extraction/types";

const WORDS = { yes: "Yes", no: "No", listSeparator: ", " };

const found = (value: ExtractionValue): ExtractionCell => ({
    status: "found",
    value,
    quote: "q",
    page: 1,
    via: "text",
});
const NOT_FOUND: ExtractionCell = {
    status: "not_found",
    value: null,
    quote: null,
    page: null,
    via: "text",
};

function row(
    id: number,
    title: string,
    cells: ExtractionRowView["cells"],
    over: Partial<ExtractionRowView> = {}
): ExtractionRowView {
    return {
        id,
        documentId: id,
        sourceId: `d${id}`,
        title,
        status: "done",
        cells,
        error: null,
        readable: true,
        ...over,
    };
}

const FIELDS: ExtractionField[] = [
    { id: "f1", name: "Total", type: "number" },
    { id: "f2", name: "Date", type: "date" },
    { id: "f3", name: "Vendor", type: "text" },
    { id: "f4", name: "Paid", type: "boolean" },
];

describe("extract screens", () => {
    it("maps a location to its screen", () => {
        expect(extractScreenFor("/")).toEqual({ kind: "list" });
        expect(extractScreenFor("/t")).toEqual({ kind: "list" });
        expect(extractScreenFor("/new")).toEqual({ kind: "new", docs: [] });
        expect(extractScreenFor("/t/12")).toEqual({ kind: "table", id: 12 });
        expect(extractScreenFor("/t/12/")).toEqual({ kind: "table", id: 12 });
        expect(extractScreenFor("/t/abc")).toEqual({ kind: "not-found" });
        expect(extractScreenFor("/runs")).toEqual({ kind: "not-found" });
    });

    it("reads the documents a deep link chose", () => {
        expect(extractScreenFor("/new?docs=12,15,18")).toEqual({ kind: "new", docs: [12, 15, 18] });
        // Workspace source ids pass as they are; non-documents and junk are dropped.
        expect(parseDocIds("d12, d15,m3,12,x,,0,-4,1.5")).toEqual([12, 15]);
        expect(parseDocIds(null)).toEqual([]);
        expect(parseDocIds("")).toEqual([]);
    });

    it("builds paths that parse back", () => {
        expect(tablePath(7)).toBe("/t/7");
        expect(newPath()).toBe("/new");
        expect(extractScreenFor(newPath([3, 9]))).toEqual({ kind: "new", docs: [3, 9] });
    });
});

describe("extract links", () => {
    it("opens a source and hands a prompt to the chat as workspace links", () => {
        expect(sourceHref("d12")).toBe("/employer/documents?source=d12");
        expect(sourceHref("d12", { quote: "Total due: USD 12.00", page: 3 })).toBe(
            "/employer/documents?source=d12&find=Total+due%3A+USD+12.00&page=3"
        );
        expect(sourceHref("d12", { quote: null, page: 3 })).toBe("/employer/documents?source=d12");
        const prompt = en.table.askPrompt.replace("{title}", "Q3 & Q4").replace("{id}", "7");
        const href = askHref(prompt);
        expect(href.startsWith("/employer/documents?ask=")).toBe(true);
        expect(new URL(href, "http://x").searchParams.get("ask")).toBe(
            'Using the extraction table "Q3 & Q4" (#7): '
        );
    });

    it("keeps the table id in the prompt in every language", () => {
        // The chat tool `read_extraction_table` takes the id from this text.
        for (const catalogue of [en, zh]) {
            expect(catalogue.table.askPrompt).toContain("#{id}");
            expect(catalogue.table.askPrompt).toContain("{title}");
        }
    });
});

describe("extract values", () => {
    it("formats numbers in the reader's locale, without inventing decimals", () => {
        expect(formatNumber(1284500, "en")).toBe("1,284,500");
        expect(formatNumber(96320.75, "en")).toBe("96,320.75");
        expect(formatNumber(1284500, "de")).toBe("1.284.500");
        expect(formatNumber(0.5, "en")).toBe("0.5");
    });

    it("formats ISO dates as calendar days and leaves anything else alone", () => {
        expect(formatDate("2026-03-14", "en")).toBe("Mar 14, 2026");
        expect(formatDate("2026-03-14T23:30:00-08:00", "en")).toBe("Mar 14, 2026");
        expect(formatDate("Q3 2026", "en")).toBe("Q3 2026");
        expect(dateMs("2026-01-01")).toBe(Date.UTC(2026, 0, 1));
        expect(dateMs("soon")).toBeNull();
    });

    it("says a value as one line of text by type", () => {
        expect(valueText(true, "boolean", "en", WORDS)).toBe("Yes");
        expect(valueText(false, "boolean", "en", WORDS)).toBe("No");
        expect(valueText(["a", "b"], "list", "en", WORDS)).toBe("a, b");
        expect(valueText(12000, "number", "en", WORDS)).toBe("12,000");
        expect(valueText("12000", "number", "en", WORDS)).toBe("12,000");
        expect(valueText("about twelve", "number", "en", WORDS)).toBe("about twelve");
        expect(valueText("2026-07-03", "date", "en", WORDS)).toBe("Jul 3, 2026");
        expect(valueText("Halvorsen", "text", "en", WORDS)).toBe("Halvorsen");
        expect(valueText(null, "text", "en", WORDS)).toBe("");
    });

    it("previews a long list as its first items and a count", () => {
        expect(listPreview(["a", "b", "c", "d", "e"], 2)).toEqual({ shown: ["a", "b"], more: 3 });
        expect(listPreview(["a"], 2)).toEqual({ shown: ["a"], more: 0 });
    });

    it("counts progress as documents finished, read or failed", () => {
        expect(progressOf({ total: 24, pending: 4, running: 2, done: 16, failed: 2 })).toEqual({
            finished: 18,
            total: 24,
            percent: 75,
        });
        expect(progressOf({ total: 0, pending: 0, running: 0, done: 0, failed: 0 }).percent).toBe(
            0
        );
        expect(isLive("queued")).toBe(true);
        expect(isLive("running")).toBe(true);
        expect(isLive("done")).toBe(false);
        expect(isLive("cancelled")).toBe(false);
    });
});

describe("extract sorting", () => {
    const rows = [
        row(1, "b.pdf", {
            f1: found(300),
            f2: found("2026-03-01"),
            f3: found("Meridian"),
            f4: found(true),
        }),
        row(2, "a.pdf", { f1: NOT_FOUND, f2: NOT_FOUND, f3: NOT_FOUND, f4: NOT_FOUND }),
        row(3, "c.pdf", {
            f1: found(20),
            f2: found("2025-11-20"),
            f3: found("aldgate"),
            f4: found(false),
        }),
        row(4, "d.pdf", {}, { status: "failed", error: "x" }),
        row(5, "e.pdf", { f1: found(1284500), f2: found("2026-01-15"), f3: found("Brightwater") }),
        row(6, "f.pdf", {}, { readable: false }),
        row(7, "g.pdf", {}, { status: "running" }),
    ];
    const ids = (sorted: ExtractionRowView[]) => sorted.map(r => r.id);

    it("leaves the order alone without a sort", () => {
        expect(ids(sortRows(rows, FIELDS, null, "en"))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("sorts numbers by value with rows that have none last, in both directions", () => {
        expect(ids(sortRows(rows, FIELDS, { column: "f1", direction: "asc" }, "en"))).toEqual([
            3, 1, 5, 2, 4, 6, 7,
        ]);
        expect(ids(sortRows(rows, FIELDS, { column: "f1", direction: "desc" }, "en"))).toEqual([
            5, 1, 3, 2, 4, 6, 7,
        ]);
    });

    it("sorts dates by the day, text without regard to case, yes after no", () => {
        expect(
            ids(sortRows(rows, FIELDS, { column: "f2", direction: "asc" }, "en")).slice(0, 3)
        ).toEqual([3, 5, 1]);
        expect(
            ids(sortRows(rows, FIELDS, { column: "f3", direction: "asc" }, "en")).slice(0, 3)
        ).toEqual([3, 5, 1]);
        expect(
            ids(sortRows(rows, FIELDS, { column: "f4", direction: "asc" }, "en")).slice(0, 2)
        ).toEqual([3, 1]);
        // Row 5 was never read for "Paid": no cell is the same as not found.
        expect(ids(sortRows(rows, FIELDS, { column: "f4", direction: "desc" }, "en"))).toEqual([
            1, 3, 2, 4, 5, 6, 7,
        ]);
    });

    it("sorts by document title, and ignores a column that is not there", () => {
        expect(
            ids(sortRows(rows, FIELDS, { column: "title", direction: "desc" }, "en")).slice(0, 2)
        ).toEqual([7, 6]);
        expect(ids(sortRows(rows, FIELDS, { column: "nope", direction: "asc" }, "en"))).toEqual([
            1, 2, 3, 4, 5, 6, 7,
        ]);
    });

    it("does not change the rows it was given", () => {
        const before = ids(rows);
        sortRows(rows, FIELDS, { column: "f1", direction: "desc" }, "en");
        expect(ids(rows)).toEqual(before);
    });

    it("toggles a header between ascending and descending", () => {
        expect(nextSort(null, "f1")).toEqual({ column: "f1", direction: "asc" });
        expect(nextSort({ column: "f1", direction: "asc" }, "f1")).toEqual({
            column: "f1",
            direction: "desc",
        });
        expect(nextSort({ column: "f1", direction: "desc" }, "f1")).toEqual({
            column: "f1",
            direction: "asc",
        });
        expect(nextSort({ column: "f1", direction: "desc" }, "f2")).toEqual({
            column: "f2",
            direction: "asc",
        });
    });

    it("filters by words of the document title", () => {
        const list = [
            row(1, "Halvorsen Freight — INV-4471.pdf", {}),
            row(2, "Café Lumen receipt.png", {}),
        ];
        expect(ids(filterRows(list, "  "))).toEqual([1, 2]);
        expect(ids(filterRows(list, "freight HALV"))).toEqual([1]);
        expect(ids(filterRows(list, "receipt pdf"))).toEqual([]);
    });
});

describe("extract fields", () => {
    const draft = (name: string, over: Partial<FieldDraft> = {}): FieldDraft => ({
        ...blankField(),
        name,
        ...over,
    });

    it("finds empty and repeated names", () => {
        const a = draft("Vendor");
        const b = draft("");
        const c = draft("  vendor ");
        const d = draft("Total");
        expect(fieldProblems([a, b, c, d])).toEqual({
            [a.key]: "duplicate",
            [b.key]: "empty",
            [c.key]: "duplicate",
        });
        expect(fieldProblems([a, d])).toEqual({});
    });

    it("finds names and instructions past the limits", () => {
        const long = draft("x".repeat(EXTRACTION_LIMITS.fieldNameLength + 1));
        const wordy = draft("Notes", {
            instruction: "y".repeat(EXTRACTION_LIMITS.instructionLength + 1),
        });
        expect(fieldProblems([long, wordy])).toEqual({
            [long.key]: "nameTooLong",
            [wordy.key]: "instructionTooLong",
        });
    });

    it("sends trimmed fields and leaves an empty instruction out", () => {
        expect(
            toFieldInputs([
                draft("  Total   amount ", { type: "number", instruction: "  incl. tax " }),
                draft("Vendor", { instruction: "   " }),
            ])
        ).toEqual([
            { name: "Total amount", type: "number", instruction: "incl. tax" },
            { name: "Vendor", type: "text" },
        ]);
    });

    it("knows an editor nobody has typed in", () => {
        expect(isUntouched([blankField(), blankField("date")])).toBe(true);
        expect(isUntouched([draft("Vendor")])).toBe(false);
        expect(isUntouched([draft("", { instruction: "x" })])).toBe(false);
    });

    it("moves a row up or down, and not past the ends", () => {
        expect(moveField(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
        expect(moveField(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
        expect(moveField(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
        expect(moveField(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    });

    it("has a name for every starter field, and a hint where one is promised, in both languages", () => {
        for (const catalogue of [en, zh]) {
            const names = catalogue.new.starterFields as Record<string, string>;
            const hints = catalogue.new.starterHints as Record<string, string>;
            const sets = catalogue.new.starters as Record<string, string>;
            for (const set of STARTER_SETS) {
                expect(sets[set.id]).toBeTruthy();
                const filled = set.fields.map(field => names[field.key]);
                expect(filled.every(Boolean)).toBe(true);
                // A starter set must not trip the editor's own validation.
                expect(new Set(filled).size).toBe(filled.length);
                expect(set.fields.length).toBeLessThanOrEqual(EXTRACTION_LIMITS.maxFields);
            }
            for (const key of STARTER_HINTS) expect(hints[key]).toBeTruthy();
        }
        expect(starterHintKey("totalAmount")).toBe("totalAmount");
        expect(starterHintKey("vendor")).toBeNull();
    });
});

describe("extract document picker", () => {
    const source = (
        documentId: number,
        title: string,
        folder: string | null,
        indexed = true
    ): ExtractionSourceOption => ({
        documentId,
        sourceId: `d${documentId}`,
        title,
        folder,
        kind: "pdf",
        indexed,
    });
    const sources = [
        source(1, "Invoice 10.pdf", "Finance/Invoices"),
        source(2, "Invoice 2.pdf", "Finance/Invoices"),
        source(3, "Lease.pdf", "Legal"),
        source(4, "Scan.pdf", null, false),
        source(5, "Board pack.pdf", null),
    ];

    it("finds by title or folder", () => {
        expect(findSources(sources, "invoice").map(s => s.documentId)).toEqual([1, 2]);
        expect(findSources(sources, "legal").map(s => s.documentId)).toEqual([3]);
        expect(findSources(sources, "finance 10").map(s => s.documentId)).toEqual([1]);
        expect(findSources(sources, "").length).toBe(5);
    });

    it("groups by folder in name order, numbers in titles in number order, unfiled last", () => {
        const groups = groupByFolder(sources, "en");
        expect(groups.map(g => g.folder)).toEqual(["Finance/Invoices", "Legal", null]);
        expect(groups[0]!.sources.map(s => s.documentId)).toEqual([2, 1]);
        expect(groups[2]!.sources.map(s => s.documentId)).toEqual([5, 4]);
    });

    it("selects many at once, skipping files still being processed and stopping at the limit", () => {
        expect(addToSelection([3], sources, 500)).toEqual([3, 1, 2, 5]);
        expect(addToSelection([3], sources, 2)).toEqual([3, 1]);
        expect(removeFromSelection([3, 1, 2, 5], sources.slice(0, 2))).toEqual([3, 5]);
    });

    it("drops what a deep link names that cannot be chosen, and says how many", () => {
        expect(reconcileSelection([2, 4, 99, 5], sources, 500)).toEqual({
            picked: [2, 5],
            dropped: 2,
        });
        expect(reconcileSelection([1, 2, 3], sources, 2)).toEqual({ picked: [1, 2], dropped: 1 });
    });
});

describe("sourcesUnderFolder", () => {
    const at = (documentId: number, folder: string | null) => ({
        documentId,
        sourceId: `d${documentId}`,
        title: `doc ${documentId}`,
        folder,
        kind: "pdf",
        indexed: true,
    });
    const all = [
        at(1, "Client intake"),
        at(2, "Client intake/Invoices"),
        at(3, "Client intake 2"),
        at(4, null),
    ];

    it("takes a folder with the folders inside it, not its look-alike siblings", () => {
        expect(sourcesUnderFolder(all, "Client intake").map(s => s.documentId)).toEqual([1, 2]);
        expect(sourcesUnderFolder(all, "Client intake/Invoices").map(s => s.documentId)).toEqual([
            2,
        ]);
        expect(sourcesUnderFolder(all, null).map(s => s.documentId)).toEqual([4]);
    });
});
