import {
    applyPinOrder,
    byPinOrder,
    deriveSessionTitle,
    filterHistory,
    groupHistoryByRecency,
    movePin,
    placePin,
    relativeTime,
    sectionHistory,
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
        expect(deriveSessionTitle("What is the indemnity cap?")).toBe("What is the indemnity cap?");
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

/**
 * ADR-014 §5: the rail's three sections and the pin order. Each entry lands in
 * one section; the order of Pinned is the person's own, not recency.
 */
describe("sectionHistory", () => {
    const pinnedOld = entry("p-old", "2020-01-01T00:00:00.000Z", { pinned: true, pinRank: 0 });
    const pinnedNew = entry("p-new", NOW.toISOString(), { pinned: true, pinRank: 1 });
    const unranked = entry("p-unranked", NOW.toISOString(), { pinned: true, pinRank: null });
    const sharedPinned = entry("s-pin", NOW.toISOString(), {
        pinned: true,
        pinRank: -1,
        sharedBy: "user-b",
    });
    const sharedOld = entry("s-old", "2026-09-04T10:00:00.000Z", { sharedBy: "user-b" });
    const sharedNew = entry("s-new", "2026-09-05T13:00:00.000Z", { sharedBy: "user-c" });
    const mine = entry("mine", "2026-09-05T12:00:00.000Z");
    const run = entry("run", "2026-09-05T13:30:00.000Z", { kind: "email" });

    it("puts pins first in manual order, then shared with you, then the rest by date", () => {
        const sections = sectionHistory(
            [mine, sharedOld, pinnedNew, run, unranked, sharedNew, pinnedOld, sharedPinned],
            NOW
        );
        expect(sections.pinned.map(e => e.id)).toEqual(["s-pin", "p-old", "p-new", "p-unranked"]);
        expect(sections.shared.map(e => e.id)).toEqual(["s-new", "s-old"]);
        expect(sections.recent.map(g => [g.id, g.entries.map(e => e.id)])).toEqual([
            ["today", ["run", "mine"]],
        ]);
    });
});

describe("pin order helpers", () => {
    const order = ["a", "b", "c", "d"] as const;

    it("moves one pin by index, clamped, and returns the same array when nothing moves", () => {
        expect(movePin(order, "c", 0)).toEqual(["c", "a", "b", "d"]);
        expect(movePin(order, "a", 99)).toEqual(["b", "c", "d", "a"]);
        expect(movePin(order, "a", -1)).toBe(order);
        expect(movePin(order, "zz", 1)).toBe(order);
    });

    it("drops a pin before or after another", () => {
        expect(placePin(order, "d", "b", false)).toEqual(["a", "d", "b", "c"]);
        expect(placePin(order, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
        expect(placePin(order, "b", "c", false)).toBe(order);
        expect(placePin(order, "b", "b", true)).toBe(order);
    });

    it("restates an order as ranks on the pinned chats it names", () => {
        const entries = [
            entry("x", NOW.toISOString(), { pinned: true, pinRank: 5 }),
            entry("y", NOW.toISOString(), { pinned: true, pinRank: 9 }),
            entry("z", NOW.toISOString()),
        ];
        const next = applyPinOrder(entries, ["y", "x", "z"]);
        expect(next.map(e => [e.id, e.pinRank])).toEqual([
            ["x", 1],
            ["y", 0],
            ["z", undefined],
        ]);
        expect(
            [...next]
                .filter(e => e.pinned)
                .sort(byPinOrder)
                .map(e => e.id)
        ).toEqual(["y", "x"]);
    });
});
