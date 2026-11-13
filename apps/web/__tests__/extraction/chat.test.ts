/**
 * What Ask's `read_extraction_table` shows the model: the list of tables,
 * and one table a line per document — found fields only, withheld rows left
 * out, long tables cut with a count of what was left.
 */
import {
    formatExtractionTable,
    formatExtractionTableList,
    type ExtractionTableOutline,
} from "~/server/extraction/chat";

import { sampleView } from "./fixtures";

const outline = (over: Partial<ExtractionTableOutline> = {}): ExtractionTableOutline => ({
    id: 7,
    title: "Supplier contracts",
    status: "done",
    fields: ["Supplier", "Annual fee"],
    counts: { total: 4, pending: 1, running: 0, done: 2, failed: 1 },
    mine: true,
    createdByName: "Ana",
    ...over,
});

describe("formatExtractionTableList", () => {
    it("lists each table with its number, fields and row counts", () => {
        const text = formatExtractionTableList([
            outline(),
            outline({
                id: 9,
                title: "Resumes",
                mine: false,
                createdByName: "Bo",
                fields: ["School"],
            }),
        ]);
        expect(text).toContain("2 extraction tables, newest first:");
        expect(text).toContain(
            '- table 7: "Supplier contracts" — done, 4 documents (2 read, 1 failed, 1 not read yet), made by this person. Fields: Supplier; Annual fee'
        );
        expect(text).toContain('- table 9: "Resumes"');
        expect(text).toContain("shared by Bo. Fields: School");
    });

    it("narrows by title or field, and says when there is nothing", () => {
        const tables = [outline(), outline({ id: 9, title: "Resumes", fields: ["School"] })];
        expect(formatExtractionTableList(tables, "school")).toContain(
            "1 extraction table matching"
        );
        expect(formatExtractionTableList(tables, "school")).not.toContain("table 7");
        expect(formatExtractionTableList(tables, "payroll")).toContain(
            "No extraction table matches"
        );
        expect(formatExtractionTableList([])).toBe(
            "The person has no extraction tables in this workspace yet."
        );
    });
});

describe("formatExtractionTable", () => {
    it("gives the fields, then one line per document with what was found", () => {
        const text = formatExtractionTable(sampleView());
        expect(text).toContain('Extraction table 7: "Supplier contracts" — done, 4 documents');
        expect(text).toContain("- Annual fee (number): In dollars");
        expect(text).toContain(
            '- "Acme MSA.pdf" (d12) — Supplier: Acme, Inc. | Annual fee: 12500.5 | Renewal date: 2027-01-31 | Auto-renews: yes | Services: Hosting; Support'
        );
        // Not-found fields are not listed.
        expect(text).toContain("(d13) — Supplier: +1 (555) 010-0000 | Auto-renews: no");
        expect(text).toContain('- "Scan.png" (d15): (could not be read)');
    });

    it("leaves out rows the person cannot open, and says how many", () => {
        const text = formatExtractionTable(sampleView());
        expect(text).not.toContain("d14");
        expect(text).not.toContain("don't have access");
        expect(text).toContain("1 row is from files this person cannot open and is left out.");
    });

    it("cuts a long table and counts the rows not shown", () => {
        const base = sampleView().rows[0]!;
        const rows = Array.from({ length: 400 }, (_, i) => ({
            ...base,
            id: i + 1,
            documentId: 100 + i,
            sourceId: `d${100 + i}`,
            title: `Contract ${i + 1}.pdf`,
        }));
        const text = formatExtractionTable(sampleView({ rows }), { maxChars: 20_000 });
        const shown = text.split("\n").filter(line => line.startsWith('- "Contract')).length;
        expect(shown).toBeGreaterThan(50);
        expect(shown).toBeLessThan(400);
        expect(text).toContain(`${400 - shown} more rows not shown.`);
        expect(text.length).toBeLessThan(21_500);
    });

    it("narrows rows with query", () => {
        const text = formatExtractionTable(sampleView(), { query: "ACME" });
        expect(text).toContain('Rows matching "ACME" (1 of 3):');
        expect(text).not.toContain("d13");
    });
});
