/**
 * Export CSV: what a spreadsheet opens is what was on screen, and a cell
 * that looks like a formula opens as text.
 */

import { csvFileName, toCsv } from "~/lib/usage/csv";

describe("toCsv", () => {
    it("writes a header and rows, CRLF-terminated", () => {
        expect(
            toCsv(
                ["a", "b"],
                [
                    [1, "x"],
                    [2.5, null],
                ]
            )
        ).toBe("a,b\r\n1,x\r\n2.5,\r\n");
    });

    it("quotes commas, quotes and line breaks", () => {
        expect(toCsv(["v"], [["a,b"], ['say "hi"'], ["two\nlines"]])).toBe(
            'v\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n'
        );
    });

    it("makes formula-looking text into text, but keeps negative numbers numbers", () => {
        expect(toCsv(["v"], [["=1+1"], ["+cmd"], ["-2"], ["@SUM(A1)"], ["\tx"], [-2]])).toBe(
            "v\r\n'=1+1\r\n'+cmd\r\n'-2\r\n'@SUM(A1)\r\n'\tx\r\n-2\r\n"
        );
    });

    it("leaves non-finite numbers and missing values empty", () => {
        expect(toCsv(["v"], [[Number.NaN], [undefined], [Number.POSITIVE_INFINITY]])).toBe(
            "v\r\n\r\n\r\n\r\n"
        );
    });
});

describe("csvFileName", () => {
    it("names the export by what and when", () => {
        expect(csvFileName("people", { from: "2026-09-28", to: "2026-10-27" })).toBe(
            "usage-people-2026-09-28-to-2026-10-27.csv"
        );
    });
});
