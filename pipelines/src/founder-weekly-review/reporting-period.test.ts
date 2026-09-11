import { describe, expect, it } from "vitest";

import { resolveReportingPeriodBounds } from "./reporting-period";

describe("resolveReportingPeriodBounds", () => {
    it("interprets calendar dates as local midnight in the workspace timezone", () => {
        const bounds = resolveReportingPeriodBounds(
            { start: "2026-08-17", end: "2026-08-23" },
            "America/New_York"
        );
        // Local midnight EDT (UTC-4) — the bound is 04:00 UTC.
        expect(bounds.startInclusive.toISOString()).toBe("2026-08-17T04:00:00.000Z");
        // Exclusive end: local midnight of the day AFTER the last included day.
        expect(bounds.endExclusive.toISOString()).toBe("2026-08-24T04:00:00.000Z");
    });

    it("keeps the end exclusive across a single-day period", () => {
        const bounds = resolveReportingPeriodBounds(
            { start: "2026-01-05", end: "2026-01-05" },
            "UTC"
        );
        expect(bounds.startInclusive.toISOString()).toBe("2026-01-05T00:00:00.000Z");
        expect(bounds.endExclusive.toISOString()).toBe("2026-01-06T00:00:00.000Z");
        expect(bounds.endExclusive.getTime() - bounds.startInclusive.getTime()).toBe(
            24 * 60 * 60 * 1000
        );
    });

    it("advances the exclusive end as calendar arithmetic, surviving DST transitions", () => {
        // US DST ends 2026-11-01: the local day is 25 hours long.
        const bounds = resolveReportingPeriodBounds(
            { start: "2026-10-26", end: "2026-11-01" },
            "America/New_York"
        );
        // Start is EDT midnight (UTC-4); the day after the end is EST midnight (UTC-5).
        expect(bounds.startInclusive.toISOString()).toBe("2026-10-26T04:00:00.000Z");
        expect(bounds.endExclusive.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    });

    it("rejects an invalid timezone up front with a named error", () => {
        expect(() =>
            resolveReportingPeriodBounds({ start: "2026-08-17", end: "2026-08-23" }, "Mars/Olympus")
        ).toThrow(/time ?zone|invalid/i);
    });
});
