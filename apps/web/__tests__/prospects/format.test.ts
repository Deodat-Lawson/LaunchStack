import {
    duration,
    joinNatural,
    plural,
    relativeTime,
} from "~/app/employer/tools/prospects/_lib/format";

describe("relativeTime", () => {
    const now = new Date("2026-09-17T03:10:00").getTime();
    const at = (iso: string) => relativeTime(iso, now);

    it("speaks in the product's words", () => {
        expect(relativeTime(null, now)).toBe("never");
        expect(at("2026-09-17T03:09:40")).toBe("just now");
        expect(at("2026-09-17T02:50:00")).toBe("20 min ago");
        expect(at("2026-09-16T09:00:00")).toBe("18 hours ago");
        expect(at("2026-09-16T02:00:00")).toBe("yesterday");
        expect(at("2026-09-15T09:00:00")).toBe("2 days ago");
        expect(at("2026-09-05T09:00:00")).toBe("12 days ago");
    });

    it("does not call a few hours ago yesterday just because midnight passed", () => {
        expect(at("2026-09-17T01:10:00")).toMatch(/^today /);
        expect(at("2026-09-16T23:30:00")).toBe("4 hours ago");
    });
});

describe("small formatters", () => {
    it("formats durations, plurals and lists", () => {
        expect(duration(800)).toBe("800 ms");
        expect(duration(42_000)).toBe("42 s");
        expect(duration(252_000)).toBe("4 min 12 s");
        expect(plural(1, "company", "companies")).toBe("1 company");
        expect(plural(3, "deal")).toBe("3 deals");
        expect(joinNatural(["NL", "DE", "UK"])).toBe("NL, DE and UK");
        expect(joinNatural(["NL"])).toBe("NL");
    });
});
