/** @jest-environment jsdom */

/**
 * "Not yet" and "Ignore" on a suggestion without server state of its own
 * set it aside in this browser until a date. These pin the dates (one day
 * means today only), that expired entries are pruned on the next write,
 * that every screen reading the set hears about a change, and that storage
 * which throws — private windows, blocked site data — still hides the card
 * for the page and never breaks it.
 */
import { act, renderHook } from "@testing-library/react";

import {
    hiddenOn,
    hideSuggestion,
    unhideSuggestion,
    useHiddenSuggestions,
} from "~/app/employer/tools/vantage/_lib/hidden";
import { addDaysIso, todayIso } from "~/app/employer/tools/vantage/_lib/format";

const KEY = "vantage:hidden:v1";

function stored(): Record<string, string> {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
}

beforeEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
});

describe("hideSuggestion", () => {
    it("hides for one day: today, not tomorrow", () => {
        hideSuggestion("check-in:c1", 1, "2026-10-03");

        expect(stored()).toEqual({ "check-in:c1": "2026-10-04" });
        expect(hiddenOn(stored(), "2026-10-03").has("check-in:c1")).toBe(true);
        expect(hiddenOn(stored(), "2026-10-04").has("check-in:c1")).toBe(false);
    });

    it("hides for a week through the sixth day after, not the seventh", () => {
        hideSuggestion("quiet:2026-10-05", 7, "2026-10-03");

        expect(hiddenOn(stored(), "2026-10-09").has("quiet:2026-10-05")).toBe(true);
        expect(hiddenOn(stored(), "2026-10-10").has("quiet:2026-10-05")).toBe(false);
    });

    it("prunes expired entries on the next hide, and keeps live ones", () => {
        window.localStorage.setItem(
            KEY,
            JSON.stringify({
                expired: "2026-10-01",
                "ends-today": "2026-10-03",
                live: "2026-10-10",
            })
        );

        hideSuggestion("new", 1, "2026-10-03");

        expect(stored()).toEqual({ live: "2026-10-10", new: "2026-10-04" });
    });
});

describe("unhideSuggestion", () => {
    it("takes back one id and leaves the rest", () => {
        hideSuggestion("a", 1, "2026-10-03");
        hideSuggestion("b", 1, "2026-10-03");

        unhideSuggestion("a");

        expect(stored()).toEqual({ b: "2026-10-04" });
    });
});

describe("useHiddenSuggestions", () => {
    it("reads what is hidden today on the first render", () => {
        window.localStorage.setItem(
            KEY,
            JSON.stringify({ snoozed: "2999-01-01", expired: "2000-01-01" })
        );

        const { result } = renderHook(() => useHiddenSuggestions());

        expect([...result.current]).toEqual(["snoozed"]);
    });

    it("follows hides and unhides made anywhere on the page", () => {
        const { result } = renderHook(() => useHiddenSuggestions());
        expect(result.current.size).toBe(0);

        act(() => hideSuggestion("check-in:c1", 1));
        expect(result.current.has("check-in:c1")).toBe(true);

        act(() => unhideSuggestion("check-in:c1"));
        expect(result.current.has("check-in:c1")).toBe(false);
    });

    it("follows a change another tab made", () => {
        const { result } = renderHook(() => useHiddenSuggestions());

        act(() => {
            window.localStorage.setItem(KEY, JSON.stringify({ elsewhere: "2999-01-01" }));
            window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
        });

        expect(result.current.has("elsewhere")).toBe(true);
    });
});

describe("when storage throws", () => {
    beforeEach(() => {
        jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new DOMException("The operation is insecure.", "SecurityError");
        });
        jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("Quota exceeded", "QuotaExceededError");
        });
    });

    it("still hides and unhides for the page, and nothing throws", () => {
        const { result } = renderHook(() => useHiddenSuggestions());
        const today = todayIso();

        expect(() => act(() => hideSuggestion("check-in:private", 1, today))).not.toThrow();
        expect(result.current.has("check-in:private")).toBe(true);

        expect(() => act(() => unhideSuggestion("check-in:private"))).not.toThrow();
        expect(result.current.has("check-in:private")).toBe(false);
    });

    it("prunes and hides from the page's own copy", () => {
        const today = todayIso();
        hideSuggestion("old", 3, today);
        // A later write, on a day "old" has run out by, drops it from the copy.
        hideSuggestion("fresh", 1, addDaysIso(today, 5));

        const { result } = renderHook(() => useHiddenSuggestions());

        expect(result.current.has("fresh")).toBe(true);
        expect(result.current.has("old")).toBe(false);
    });
});
