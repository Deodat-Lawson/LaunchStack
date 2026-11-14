/**
 * A table as a file (acceptance criterion C4): the CSV parses back to the
 * results grid, the workbook reads back with its two sheets, numbers stay
 * numbers, text that a spreadsheet would run as a formula is disarmed in
 * both formats, and a row the reader can't open never reaches a file.
 */
import * as XLSX from "xlsx";

import {
    attachmentDisposition,
    evidenceGrid,
    exportFileName,
    resultsGrid,
    tableToCsv,
    tableToXlsx,
} from "~/server/extraction/export";

import { LABELS, sampleView } from "./fixtures";

/** A small RFC 4180 reader: quoted cells, doubled quotes, CRLF rows. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (char === '"') quoted = false;
            else cell += char;
        } else if (char === '"') quoted = true;
        else if (char === ",") {
            row.push(cell);
            cell = "";
        } else if (char === "\r" && text[i + 1] === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            i++;
        } else cell += char;
    }
    return rows;
}

describe("tableToCsv", () => {
    const csv = tableToCsv(sampleView(), LABELS);

    it("starts with a byte-order mark so Excel reads UTF-8", () => {
        expect(csv.charCodeAt(0)).toBe(0xfeff);
    });

    it("parses back to the results grid: Document, then a column per field", () => {
        const rows = parseCsv(csv.slice(1));
        expect(rows[0]).toEqual([
            "Document",
            "Supplier",
            "Annual fee",
            "Renewal date",
            "Auto-renews",
            "Services",
        ]);
        expect(rows[1]).toEqual([
            "Acme MSA.pdf",
            "Acme, Inc.",
            "12500.5",
            "2027-01-31",
            "Yes",
            "Hosting; Support",
        ]);
        // Not found and never read are both empty.
        expect(rows[2]!.slice(2)).toEqual(["", "", "No", ""]);
        // The failed row keeps its line, with nothing in it.
        expect(rows[3]).toEqual(["Scan.png", "", "", "", "", ""]);
    });

    it("leaves out the row the reader cannot open", () => {
        const rows = parseCsv(csv.slice(1));
        expect(rows).toHaveLength(4);
        expect(csv).not.toContain("don't have access");
    });

    it("disarms text a spreadsheet would run as a formula", () => {
        const rows = parseCsv(csv.slice(1));
        expect(rows[2]![0]).toBe('\'=HYPERLINK("http://evil")');
        expect(rows[2]![1]).toBe("'+1 (555) 010-0000");
    });
});

describe("tableToXlsx", () => {
    const book = XLSX.read(tableToXlsx(sampleView(), LABELS), { type: "buffer" });

    it("has the Results and Evidence sheets, in that order", () => {
        expect(book.SheetNames).toEqual(["Results", "Evidence"]);
    });

    it("writes the results grid with typed values", () => {
        const sheet = book.Sheets.Results!;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
        expect(rows[0]).toEqual([
            "Document",
            "Supplier",
            "Annual fee",
            "Renewal date",
            "Auto-renews",
            "Services",
        ]);
        expect(rows[1]).toEqual([
            "Acme MSA.pdf",
            "Acme, Inc.",
            12500.5,
            "2027-01-31",
            "Yes",
            "Hosting; Support",
        ]);
        expect(rows).toHaveLength(4);
        // The number is a numeric cell, not text that looks like one.
        expect(sheet.C2.t).toBe("n");
        expect(sheet.C2.v).toBe(12500.5);
        expect(sheet.B2.t).toBe("s");
        // Not found: no cell at all.
        expect(sheet.C3).toBeUndefined();
    });

    it("disarms formula-like text and never writes a formula", () => {
        const sheet = book.Sheets.Results!;
        expect(sheet.A3.t).toBe("s");
        expect(sheet.A3.v).toBe('\'=HYPERLINK("http://evil")');
        expect(sheet.B3.v).toBe("'+1 (555) 010-0000");
        for (const name of book.SheetNames) {
            for (const [ref, cell] of Object.entries(book.Sheets[name]!)) {
                if (ref.startsWith("!")) continue;
                expect((cell as XLSX.CellObject).f).toBeUndefined();
            }
        }
    });

    it("lists every found cell on the Evidence sheet with its quote, page and where it was read", () => {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Evidence!, {
            header: 1,
            defval: null,
        });
        expect(rows[0]).toEqual(["Document", "Field", "Value", "Quote", "Page", "Read from"]);
        // Five found cells in the first row, two in the second; none for not found.
        expect(rows).toHaveLength(1 + 5 + 2);
        expect(rows[2]).toEqual([
            "Acme MSA.pdf",
            "Annual fee",
            12500.5,
            "an annual fee of $12,500.50",
            3,
            "text",
        ]);
        expect(rows[6]).toEqual([
            '\'=HYPERLINK("http://evil")',
            "Supplier",
            "'+1 (555) 010-0000",
            "'@call us",
            null,
            "image",
        ]);
    });

    it("uses the reader's words for sheets, headers and booleans", () => {
        const zh = { ...LABELS, results: "结果", evidence: "依据", document: "文档", yes: "是" };
        const localised = XLSX.read(tableToXlsx(sampleView(), zh), { type: "buffer" });
        expect(localised.SheetNames).toEqual(["结果", "依据"]);
        expect(localised.Sheets["结果"]!.A1.v).toBe("文档");
        expect(localised.Sheets["结果"]!.E2.v).toBe("是");
    });
});

describe("grids", () => {
    it("are empty but headed for a table with no readable rows", () => {
        const view = sampleView({ rows: sampleView().rows.filter(row => !row.readable) });
        expect(resultsGrid(view, LABELS).rows).toEqual([]);
        expect(evidenceGrid(view, LABELS).rows).toEqual([]);
        expect(XLSX.read(tableToXlsx(view, LABELS), { type: "buffer" }).SheetNames).toHaveLength(2);
    });
});

describe("file names", () => {
    it("come from the title, without characters a file system refuses", () => {
        expect(exportFileName("Supplier contracts", "xlsx", "Extraction")).toBe(
            "Supplier contracts.xlsx"
        );
        expect(exportFileName('../etc/pass"wd: Q3?*', "csv", "Extraction")).toBe(
            "etc pass wd Q3.csv"
        );
        expect(exportFileName("  ///  ", "csv", "Extraction")).toBe("Extraction.csv");
        expect(exportFileName("x".repeat(300), "csv", "Extraction")).toHaveLength(104);
    });

    it("are sent with an ASCII fallback and the RFC 5987 name", () => {
        expect(attachmentDisposition("供应商 (2026).xlsx")).toBe(
            "attachment; filename=\"___ (2026).xlsx\"; filename*=UTF-8''%E4%BE%9B%E5%BA%94%E5%95%86%20%282026%29.xlsx"
        );
        expect(attachmentDisposition("a\r\nb.csv")).not.toMatch(/[\r\n]/);
    });
});
