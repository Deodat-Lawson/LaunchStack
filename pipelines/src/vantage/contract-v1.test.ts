import { describe, expect, it } from "vitest";
import { reportPeriod, validDate } from "./period-v1";
import { fingerprint } from "./repository-v1";

describe("Contract v1 reporting boundary", () => {
    it("Monday selects the previous complete week in New York", () => {
        expect(reportPeriod(new Date("2026-10-19T13:00:00Z"))).toEqual({
            weekStart: "2026-10-12",
            timeZone: "America/New_York",
            startInclusive: "2026-10-12T04:00:00.000Z",
            endExclusive: "2026-10-19T04:00:00.000Z",
            asOf: "2026-10-19T13:00:00.000Z",
            kind: "completed-week",
        });
    });
    it("Saturday stops at the captured cutoff", () => {
        const p = reportPeriod(new Date("2026-10-17T14:00:00Z"));
        expect(p.weekStart).toBe("2026-10-12");
        expect(p.endExclusive).toBe(p.asOf);
        expect(p.kind).toBe("week-to-date");
    });
    it("uses local Sunday even when UTC is already Monday", () => {
        expect(reportPeriod(new Date("2026-10-19T02:00:00Z")).kind).toBe("week-to-date");
    });
    it("handles a complete DST fall-back week as 169 hours", () => {
        const p = reportPeriod(new Date("2026-11-02T14:00:00Z"));
        expect((Date.parse(p.endExclusive) - Date.parse(p.startInclusive)) / 3600000).toBe(169);
    });
    it("handles a complete DST spring-forward week as 167 hours", () => {
        const p = reportPeriod(new Date("2026-03-09T14:00:00Z"));
        expect((Date.parse(p.endExclusive) - Date.parse(p.startInclusive)) / 3600000).toBe(167);
    });
    it("normalizes explicit history and rejects future generation", () => {
        expect(reportPeriod(new Date("2026-10-17T14:00:00Z"), "2026-10-08").weekStart).toBe(
            "2026-10-05"
        );
        expect(() => reportPeriod(new Date("2026-10-17T14:00:00Z"), "2026-10-26")).toThrow(
            "future"
        );
    });
    it("rejects rollover dates", () => {
        expect(validDate("2026-02-30")).toBe(false);
        expect(validDate("2028-02-29")).toBe(true);
        expect(() => reportPeriod(new Date(), "2026-02-30")).toThrow("real");
    });
    it("fingerprints object content independently of key order", () => {
        expect(fingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(
            fingerprint({ a: { c: 3, d: 4 }, b: 2 })
        );
        expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
    });
});
