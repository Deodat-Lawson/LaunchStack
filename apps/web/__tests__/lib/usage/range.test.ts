/**
 * The Usage tab's window: presets end today, a custom range is checked
 * before any query runs, and the window before it has the same length.
 */

import { parseUsageWindow, presetWindow, rangeProblem, windowDays } from "~/lib/usage/range";

const NOW = new Date("2026-10-27T15:30:00Z");
const parse = (query: string) => parseUsageWindow(new URLSearchParams(query), NOW);

describe("parseUsageWindow", () => {
    it("defaults to the last 30 days, today included, and the 30 before them", () => {
        expect(parse("")).toEqual({
            ok: true,
            window: {
                from: "2026-09-28",
                to: "2026-10-27",
                days: 30,
                previousFrom: "2026-08-29",
                previousTo: "2026-09-27",
            },
        });
    });

    it("reads a preset", () => {
        expect(parse("days=7")).toMatchObject({
            ok: true,
            window: { from: "2026-10-21", to: "2026-10-27", days: 7, previousTo: "2026-10-20" },
        });
        expect(parse("days=1")).toMatchObject({ window: { from: "2026-10-27", to: "2026-10-27" } });
    });

    it("reads a custom range, across a month end", () => {
        expect(parse("from=2026-09-25&to=2026-10-04")).toMatchObject({
            ok: true,
            window: {
                from: "2026-09-25",
                to: "2026-10-04",
                days: 10,
                previousFrom: "2026-09-15",
                previousTo: "2026-09-24",
            },
        });
    });

    it.each([
        ["days=0"],
        ["days=367"],
        ["days=7.5"],
        ["days=abc"],
        ["from=2026-10-01"],
        ["to=2026-10-01"],
        ["from=2026-10-05&to=2026-10-01"],
        ["from=2026-02-31&to=2026-03-02"],
        ["from=2026-10-01&to=2026-10-28"],
        ["from=2025-01-01&to=2026-10-27"],
        ["from=10/01/2026&to=2026-10-27"],
    ])("refuses %s", query => {
        expect(parse(query).ok).toBe(false);
    });

    it("takes a range of exactly a year and a day at most", () => {
        expect(parse("from=2025-10-27&to=2026-10-27").ok).toBe(true);
        expect(parse("from=2025-10-26&to=2026-10-27").ok).toBe(false);
    });
});

describe("windowDays", () => {
    it("lists every day, oldest first", () => {
        expect(windowDays(presetWindow(3, NOW))).toEqual([
            "2026-10-25",
            "2026-10-26",
            "2026-10-27",
        ]);
        expect(windowDays({ from: "2026-02-27", to: "2026-03-01" })).toEqual([
            "2026-02-27",
            "2026-02-28",
            "2026-03-01",
        ]);
    });
});

describe("rangeProblem", () => {
    it("names the rule a custom range breaks, the same rules the route checks", () => {
        const today = "2026-10-27";
        expect(rangeProblem("", "2026-10-01", today)).toBeNull();
        expect(rangeProblem("2026-10-01", "2026-10-27", today)).toBeNull();
        expect(rangeProblem("2026-10-05", "2026-10-01", today)).toBe("order");
        expect(rangeProblem("2026-10-01", "2026-10-28", today)).toBe("future");
        expect(rangeProblem("2025-01-01", "2026-10-01", today)).toBe("tooLong");
    });
});
