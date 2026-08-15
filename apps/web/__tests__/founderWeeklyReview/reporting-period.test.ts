import { resolveReportingPeriodBounds } from "@launchstack/features/founder-weekly-review";

describe("resolveReportingPeriodBounds", () => {
    it("resolves midnight-to-midnight bounds in the workspace timezone", () => {
        // America/Los_Angeles in February is PST (UTC-8), so local midnight is 08:00 UTC.
        const bounds = resolveReportingPeriodBounds(
            { start: "2026-02-16", end: "2026-02-22" },
            "America/Los_Angeles"
        );

        expect(bounds.startInclusive.toISOString()).toBe("2026-02-16T08:00:00.000Z");
        // end is the last included day, so the exclusive bound is the next day's midnight.
        expect(bounds.endExclusive.toISOString()).toBe("2026-02-23T08:00:00.000Z");
    });

    it("accounts for daylight saving in the same timezone", () => {
        // Same zone, but July is PDT (UTC-7), so local midnight is 07:00 UTC, not 08:00.
        const bounds = resolveReportingPeriodBounds(
            { start: "2026-07-06", end: "2026-07-12" },
            "America/Los_Angeles"
        );

        expect(bounds.startInclusive.toISOString()).toBe("2026-07-06T07:00:00.000Z");
        expect(bounds.endExclusive.toISOString()).toBe("2026-07-13T07:00:00.000Z");
    });

    it("uses the following local midnight across the DST spring transition", () => {
        const bounds = resolveReportingPeriodBounds(
            { start: "2026-03-08", end: "2026-03-08" },
            "America/Los_Angeles"
        );
        expect(bounds.startInclusive.toISOString()).toBe("2026-03-08T08:00:00.000Z");
        expect(bounds.endExclusive.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    });

    it("treats UTC boundaries as literal midnight", () => {
        const bounds = resolveReportingPeriodBounds(
            { start: "2026-02-16", end: "2026-02-22" },
            "UTC"
        );

        expect(bounds.startInclusive.toISOString()).toBe("2026-02-16T00:00:00.000Z");
        expect(bounds.endExclusive.toISOString()).toBe("2026-02-23T00:00:00.000Z");
    });

    it("throws on an invalid timezone", () => {
        expect(() =>
            resolveReportingPeriodBounds({ start: "2026-02-16", end: "2026-02-22" }, "Not/AZone")
        ).toThrow(/invalid workspace timezone/i);
    });
});
