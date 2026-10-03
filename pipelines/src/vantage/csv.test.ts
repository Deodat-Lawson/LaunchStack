import { describe, expect, it } from "vitest";

import { parseMetricCsv, parseNumber, splitCsvLine } from "./csv";

describe("metric CSV import", () => {
    it("reads a header in any order and case, and keeps good rows past a bad one", () => {
        const text = [
            "Metric,Value,Period Start,Period End,Source",
            "signups,40,2026-09-21,2026-09-27,Mixpanel",
            "activated,six,2026-09-21,2026-09-27,Mixpanel",
            'paying,"1,200",2026-09-21,2026-09-27,"Stripe, export"',
        ].join("\n");
        const { rows, problems } = parseMetricCsv(text);
        expect(rows.map(r => [r.metric, r.value, r.source])).toEqual([
            ["signups", 40, "Mixpanel"],
            ["paying", 1200, "Stripe, export"],
        ]);
        expect(problems).toEqual([{ line: 3, message: '"six" is not a number.' }]);
    });

    it("accepts a single `period` column and semicolon or tab delimiters", () => {
        const semi = "metric;value;period\nsignups;12;2026-09-27";
        expect(parseMetricCsv(semi).rows[0]).toMatchObject({
            metric: "signups",
            value: 12,
            periodStart: "2026-09-27",
            periodEnd: "2026-09-27",
        });
        const tab = "metric\tvalue\tdate\nactive\t7\t2026-09-27";
        expect(parseMetricCsv(tab).rows[0]).toMatchObject({ metric: "active", value: 7 });
    });

    it("refuses a header without the columns a number needs", () => {
        expect(parseMetricCsv("metric,value\nsignups,1").problems[0]?.message).toMatch(/period/);
        expect(parseMetricCsv("name,period\nsignups,2026-09-27").problems[0]?.message).toMatch(
            /value/
        );
        expect(parseMetricCsv("   \n").problems[0]?.message).toBe("The file is empty.");
    });

    it("rejects a period that ends before it starts or is not a date", () => {
        const { rows, problems } = parseMetricCsv(
            "metric,value,period_start,period_end\nsignups,1,2026-09-27,2026-09-20\nsignups,1,Sep 20,Sep 27"
        );
        expect(rows).toEqual([]);
        expect(problems.map(p => p.line)).toEqual([2, 3]);
    });

    it("parses numbers the way spreadsheets write them", () => {
        expect(parseNumber("1,200")).toBe(1200);
        expect(parseNumber("€40.50")).toBe(40.5);
        expect(parseNumber("12.5%")).toBe(12.5);
        expect(parseNumber("-")).toBeNull();
        expect(splitCsvLine('a,"b ""quoted"", c",d', ",")).toEqual(["a", 'b "quoted", c', "d"]);
    });
});
