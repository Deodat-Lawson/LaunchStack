import { describe, expect, it } from "vitest";

import {
    addDays,
    daysBetween,
    defaultAgendaWeek,
    parseIsoDate,
    weekEndOf,
    weekStartOf,
} from "./week";

describe("vantage week arithmetic", () => {
    it("starts a week on Monday, whatever day it is asked about", () => {
        expect(weekStartOf(new Date(2026, 8, 28))).toBe("2026-09-28"); // Monday
        expect(weekStartOf(new Date(2026, 8, 30))).toBe("2026-09-28"); // Wednesday
        expect(weekStartOf(new Date(2026, 9, 4))).toBe("2026-09-28"); // Sunday
        expect(weekEndOf("2026-09-28")).toBe("2026-10-04");
    });

    it("prepares this week's agenda until Wednesday and next week's from Thursday", () => {
        expect(defaultAgendaWeek(new Date(2026, 8, 28))).toBe("2026-09-28"); // Mon
        expect(defaultAgendaWeek(new Date(2026, 8, 30))).toBe("2026-09-28"); // Wed
        expect(defaultAgendaWeek(new Date(2026, 9, 1))).toBe("2026-10-05"); // Thu
        expect(defaultAgendaWeek(new Date(2026, 9, 2))).toBe("2026-10-05"); // Fri
        expect(defaultAgendaWeek(new Date(2026, 9, 4))).toBe("2026-10-05"); // Sun
    });

    it("adds days across month ends and counts the days between", () => {
        expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
        expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
        expect(daysBetween("2026-09-28", "2026-10-05")).toBe(7);
        expect(daysBetween("2026-10-05", "2026-09-28")).toBe(-7);
    });

    it("rejects anything that is not YYYY-MM-DD", () => {
        expect(parseIsoDate("2026-9-1")).toBeNull();
        expect(parseIsoDate("28/09/2026")).toBeNull();
        expect(parseIsoDate("")).toBeNull();
        expect(parseIsoDate("2026-09-28")?.getDate()).toBe(28);
    });
});
