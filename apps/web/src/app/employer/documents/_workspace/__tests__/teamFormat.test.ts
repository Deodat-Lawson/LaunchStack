import { createTranslator } from "use-intl";

import { englishMessages } from "~/i18n/messages";

import {
    activitySentence,
    activityTarget,
    badgeCount,
    dayKey,
    dayLabel,
    inboxSentence,
    inboxTarget,
    joinNames,
    shortAgo,
} from "../team/format";
import type { ActivityRow, InboxEntry } from "../team/api";

/** The team layer's sentences, pinned (ADR-014 §7). */

const f = {
    t: createTranslator({ locale: "en", messages: englishMessages, namespace: "team.format" }),
    locale: "en",
};

function row(over: Partial<ActivityRow>): ActivityRow {
    return {
        id: 1,
        actorUserId: "user-ada",
        verb: "added",
        targetType: "document",
        targetId: "42",
        targetLabel: "Q3 plan.pdf",
        targetPath: "Finance",
        detail: null,
        at: "2026-10-10T10:00:00Z",
        openable: true,
        ...over,
    };
}

describe("shortAgo", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    it.each([
        ["2026-10-10T11:59:30Z", "now"],
        ["2026-10-10T11:55:00Z", "5m"],
        ["2026-10-10T10:00:00Z", "2h"],
        ["2026-10-07T12:00:00Z", "3d"],
    ])("%s → %s", (iso, expected) => {
        expect(shortAgo(f, iso, now)).toBe(expected);
    });

    it("falls back to a date after a week", () => {
        expect(shortAgo(f, "2026-09-01T12:00:00Z", now)).toMatch(/Sep|9/);
    });
});

describe("dayLabel", () => {
    // Local noon, so the calendar day doesn't move with the test machine's zone.
    const now = new Date(2026, 9, 13, 12, 0).getTime();
    const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

    it("names the last two days, then the weekday and date", () => {
        expect(dayLabel(f, at(2026, 9, 13), now)).toBe("Today");
        expect(dayLabel(f, at(2026, 9, 12, 23), now)).toBe("Yesterday");
        const older = dayLabel(f, at(2026, 9, 6), now);
        expect(older).toMatch(/Oct|10/);
        expect(older).not.toMatch(/2026/);
        expect(dayLabel(f, at(2025, 11, 30), now)).toMatch(/2025/);
    });

    it("keys rows by local calendar day", () => {
        expect(dayKey(at(2026, 9, 13, 0))).toBe(dayKey(at(2026, 9, 13, 23)));
        expect(dayKey(at(2026, 9, 13))).not.toBe(dayKey(at(2026, 9, 12)));
        expect(dayKey("nonsense")).toBe("");
    });
});

describe("joinNames", () => {
    it("reads like a sentence", () => {
        expect(joinNames(f, ["Ada"])).toBe("Ada");
        expect(joinNames(f, ["Ada", "Sales team"])).toBe("Ada and Sales team");
        expect(joinNames(f, ["Ada", "Ben", "Cy", "Dee"])).toBe("Ada, Ben and 2 others");
        expect(joinNames(f, ["Ada", "Ben", "Cy"])).toBe("Ada, Ben and 1 other");
    });
});

describe("activitySentence", () => {
    it.each<[Partial<ActivityRow>, string]>([
        [{}, "Ada added Q3 plan.pdf"],
        [
            {
                verb: "shared",
                targetType: "folder",
                targetLabel: "Finance",
                detail: { added: ["Sales team"] },
            },
            "Ada shared Finance with Sales team",
        ],
        [{ verb: "shared", detail: { everyone: true } }, "Ada shared Q3 plan.pdf with everyone"],
        [
            { verb: "moved", targetLabel: "Board deck", targetPath: "Finance" },
            "Ada moved Board deck to Finance",
        ],
        [
            { verb: "moved", targetLabel: "Board deck", targetPath: null },
            "Ada moved Board deck to Unfiled",
        ],
        [
            {
                verb: "moved",
                targetType: "folder",
                targetLabel: "Q3",
                targetPath: "Archive/Q3",
            },
            "Ada moved Q3 to Archive",
        ],
        [
            {
                verb: "renamed",
                targetType: "folder",
                targetLabel: "Q4",
                targetPath: "Finance/Q4",
                detail: { from: "Finance/Q3", to: "Finance/Q4" },
            },
            "Ada renamed Q3 to Q4",
        ],
        [{ verb: "unshared", detail: { removed: ["Ben"] } }, "Ada removed Ben from Q3 plan.pdf"],
        [
            {
                verb: "created_folder",
                targetType: "folder",
                targetLabel: "Board",
                targetPath: "Board",
            },
            "Ada created the folder Board",
        ],
        [
            { verb: "created_group", targetType: "group", targetLabel: "Design" },
            "Ada created the group Design",
        ],
        [{ verb: "deleted" }, "Ada deleted Q3 plan.pdf"],
    ])("case %#", (over, expected) => {
        expect(activitySentence(f, "Ada", row(over))).toBe(expected);
    });
});

describe("activityTarget", () => {
    it("opens documents by id, folders by path, chats by id", () => {
        expect(activityTarget(row({}))).toEqual({ type: "document", id: 42 });
        expect(
            activityTarget(row({ targetType: "folder", targetId: null, targetPath: "Finance/Q3" }))
        ).toEqual({ type: "folder", path: "Finance/Q3" });
        expect(activityTarget(row({ targetType: "chat", targetId: "s1" }))).toEqual({
            type: "chat",
            id: "s1",
        });
    });

    it("opens nothing that is gone", () => {
        expect(activityTarget(row({ openable: false }))).toBeNull();
    });
});

describe("inbox", () => {
    const entry: InboxEntry = {
        id: 1,
        kind: "shared",
        actorUserId: "user-ada",
        targetType: "folder",
        targetId: "7",
        targetLabel: "Finance/Board",
        detail: { via: "group", groupName: "Sales team", path: "Finance/Board" },
        at: "2026-10-10T10:00:00Z",
        read: false,
    };

    it("says who it reached through", () => {
        expect(inboxSentence(f, "Ada", entry)).toBe("Ada shared “Board” with Sales team");
        expect(inboxSentence(f, "Ada", { ...entry, detail: { via: "direct" } })).toBe(
            "Ada shared “Board” with you"
        );
    });

    it("opens a folder by its path", () => {
        expect(inboxTarget(entry)).toEqual({ type: "folder", path: "Finance/Board" });
    });

    it("caps the badge", () => {
        expect(badgeCount(3)).toBe("3");
        expect(badgeCount(12)).toBe("9+");
    });
});
