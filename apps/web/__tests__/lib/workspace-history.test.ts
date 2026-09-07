import {
    deriveSessionTitle,
    filterHistory,
    groupHistoryByRecency,
    relativeTime,
    SESSION_TITLE_MAX,
    type HistoryEntry,
} from "~/lib/workspace-history";

/**
 * The History contract's pure half. These are the rules the sidebar's
 * readability rests on — what a chat is called, which day heading a row lands
 * under, and how a timestamp is spelled in 40 pixels — so they are pinned here
 * rather than re-derived by eye in the component tests.
 */

const NOW = new Date("2026-09-05T14:00:00.000Z");

function entry(id: string, at: string, over: Partial<HistoryEntry> = {}): HistoryEntry {
    return {
        id,
        kind: "chat",
        refId: id,
        title: id,
        status: "done",
        at,
        ...over,
    };
}

describe("deriveSessionTitle", () => {
    it("uses the opening question verbatim when it fits", () => {
        expect(deriveSessionTitle("What is the indemnity cap?")).toBe(
            "What is the indemnity cap?"
        );
    });

    it("collapses whitespace so a pasted multi-line question stays one line", () => {
        expect(deriveSessionTitle("  What is\n\tthe   cap? ")).toBe("What is the cap?");
    });

    it("names an empty first turn rather than storing a blank title", () => {
        expect(deriveSessionTitle("   ")).toBe("New chat");
    });

    it("cuts a long question at a word boundary and marks the cut", () => {
        const title = deriveSessionTitle(
            "Summarise every indemnity, limitation of liability and termination clause across all of the vendor agreements"
        );
        expect(title.endsWith("…")).toBe(true);
        expect(title.length).toBeLessThanOrEqual(SESSION_TITLE_MAX + 1);
        // The boundary cut must not slice a word in half.
        expect(title.slice(0, -1).trim()).toBe(title.slice(0, -1));
        expect(title.startsWith("Summarise every indemnity")).toBe(true);
    });

    it("still truncates when there is no word boundary to break on", () => {
        const title = deriveSessionTitle("x".repeat(200));
        expect(title).toBe(`${"x".repeat(SESSION_TITLE_MAX)}…`);
    });
});

describe("groupHistoryByRecency", () => {
    it("buckets by local day and drops empty headings", () => {
        const groups = groupHistoryByRecency(
            [
                entry("today", "2026-09-05T09:00:00.000Z"),
                entry("yesterday", "2026-09-04T09:00:00.000Z"),
                entry("lastMonth", "2026-08-20T09:00:00.000Z"),
            ],
            NOW
        );
        expect(groups.map(g => g.label)).toEqual(["Today", "Yesterday", "Previous 30 days"]);
        expect(groups[0]!.entries.map(e => e.id)).toEqual(["today"]);
    });

    it("orders newest first inside a heading, whatever order it was given", () => {
        const groups = groupHistoryByRecency(
            [
                entry("older", "2026-09-05T08:00:00.000Z"),
                entry("newer", "2026-09-05T13:00:00.000Z"),
            ],
            NOW
        );
        expect(groups[0]!.entries.map(e => e.id)).toEqual(["newer", "older"]);
    });

    it("puts an unparseable timestamp at the top rather than burying it in Older", () => {
        const groups = groupHistoryByRecency(
            [entry("broken", "not-a-date"), entry("today", "2026-09-05T09:00:00.000Z")],
            NOW
        );
        expect(groups[0]!.label).toBe("Today");
        expect(groups[0]!.entries.map(e => e.id)).toContain("broken");
    });
});

describe("relativeTime", () => {
    it.each([
        ["2026-09-05T13:59:30.000Z", "now"],
        ["2026-09-05T13:20:00.000Z", "40m"],
        ["2026-09-05T09:00:00.000Z", "5h"],
        ["2026-09-04T09:00:00.000Z", "1d"],
        ["2026-09-01T09:00:00.000Z", "4d"],
    ])("renders %s as %s", (at, expected) => {
        expect(relativeTime(at, NOW)).toBe(expected);
    });

    it("falls back to a day and month past a week, in the reader's own locale order", () => {
        // The order of the parts is the locale's business, so assert the parts.
        const rendered = relativeTime("2026-08-20T09:00:00.000Z", NOW);
        expect(rendered).toContain("20");
        expect(rendered).toContain("Aug");
    });

    it("counts calendar days, so late last night reads as a day ago not hours", () => {
        // 23:30 yesterday is 14.5 elapsed hours from 14:00 today, but a reader
        // calls that yesterday.
        expect(relativeTime("2026-09-04T23:30:00.000Z", NOW)).toBe("1d");
    });

    it("is empty for a timestamp it cannot read, never 'Invalid Date'", () => {
        expect(relativeTime("nonsense", NOW)).toBe("");
    });
});

describe("filterHistory", () => {
    const entries = [
        entry("a", NOW.toISOString(), { title: "Indemnity cap" }),
        entry("b", NOW.toISOString(), {
            kind: "distribution",
            title: "Q3 partners",
            subtitle: "Partner discovery",
        }),
    ];

    it("returns everything for a blank query", () => {
        expect(filterHistory(entries, "   ")).toHaveLength(2);
    });

    it("matches the subtitle and the kind label, not just the title", () => {
        expect(filterHistory(entries, "partner discovery").map(e => e.id)).toEqual(["b"]);
        expect(filterHistory(entries, "distribution").map(e => e.id)).toEqual(["b"]);
    });

    it("ignores case", () => {
        expect(filterHistory(entries, "INDEMNITY").map(e => e.id)).toEqual(["a"]);
    });
});
