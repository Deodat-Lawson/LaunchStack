/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import {
    closeOpenMarkdown,
    commonPrefixLength,
    nextRevealLength,
    REVEAL,
    useSmoothText,
} from "../smoothText";

const FRAME_S = 1 / 60;

/** Run the reveal at 60fps until it shows all of `target`; returns frames taken and per-frame steps. */
function simulate(target: string, from = 0) {
    let shown = from;
    const steps: number[] = [];
    while (shown < target.length && steps.length < 10_000) {
        const next = nextRevealLength(target, shown, FRAME_S);
        steps.push(next - shown);
        shown = next;
    }
    return { frames: steps.length, steps };
}

describe("nextRevealLength", () => {
    const burst = "Either party may terminate on ninety days' written notice. ".repeat(20);

    it("spreads a one-shot answer over about two seconds instead of showing it at once", () => {
        const { frames, steps } = simulate(burst);
        expect(burst.length).toBeGreaterThan(1000);
        expect(frames / 60).toBeGreaterThan(1);
        expect(frames / 60).toBeLessThan(3);
        // No frame dumps more than the max speed allows (plus finishing one word).
        expect(Math.max(...steps)).toBeLessThanOrEqual(
            Math.ceil(REVEAL.MAX_CPS * FRAME_S) + REVEAL.WORD_REACH
        );
    });

    it("keeps up with a live token stream with well under a second of lag", () => {
        // A model writing ~250 characters a second, delivered every frame.
        const full = burst;
        let arrived = 0;
        let shown = 0;
        let worstLag = 0;
        for (let frame = 0; arrived < full.length; frame++) {
            arrived = Math.min(full.length, Math.round((frame + 1) * FRAME_S * 250));
            shown = nextRevealLength(full.slice(0, arrived), shown, FRAME_S);
            worstLag = Math.max(worstLag, arrived - shown);
        }
        expect(worstLag / 250).toBeLessThan(0.75);
    });

    it("ends on a word boundary when one is near", () => {
        const text = "alpha bravo charlie delta echo foxtrot";
        const next = nextRevealLength(text, 0, 0.001);
        expect([" ", undefined]).toContain(text[next]);
    });

    it("never splits a surrogate pair", () => {
        const text = "😀".repeat(400);
        for (let shown = 0; shown < text.length; ) {
            shown = nextRevealLength(text, shown, FRAME_S);
            expect(shown % 2).toBe(0);
        }
    });

    it("is done when nothing is behind", () => {
        expect(nextRevealLength("abc", 3, FRAME_S)).toBe(3);
    });
});

describe("closeOpenMarkdown", () => {
    it("closes bold and inline code left open mid-reveal", () => {
        expect(closeOpenMarkdown("Terms: **ninety da")).toBe("Terms: **ninety da**");
        expect(closeOpenMarkdown("Run `pnpm te")).toBe("Run `pnpm te`");
        expect(closeOpenMarkdown("**Done** and `ok`")).toBe("**Done** and `ok`");
    });

    it("closes an open code fence so it can't swallow the page", () => {
        expect(closeOpenMarkdown("Example:\n```ts\nconst a = 1")).toBe(
            "Example:\n```ts\nconst a = 1\n```"
        );
    });

    it("shows a link's text until its target arrives", () => {
        expect(closeOpenMarkdown("See [the MSA](https://exa")).toBe("See the MSA");
        expect(closeOpenMarkdown("See [the M")).toBe("See the M");
        expect(closeOpenMarkdown("See [the MSA](https://example.com) now")).toBe(
            "See [the MSA](https://example.com) now"
        );
    });

    it("holds back a table row still arriving, and a header until its divider", () => {
        expect(closeOpenMarkdown("Terms:\n\n| Clause | Notice |")).toBe("Terms:\n");
        expect(closeOpenMarkdown("Terms:\n\n| Clause | Notice |\n|---|---|\n| Renewal | 60")).toBe(
            "Terms:\n\n| Clause | Notice |\n|---|---|"
        );
        const table = "| Clause | Notice |\n|---|---|\n| Renewal | 60 days |";
        expect(closeOpenMarkdown(table)).toBe(table);
        // A row that happens to end on a pipe mid-way still has too few cells.
        expect(closeOpenMarkdown("| Clause | Notice |\n|---|---|\n| Convenience |")).toBe(
            "| Clause | Notice |\n|---|---|"
        );
    });
});

describe("commonPrefixLength", () => {
    it("counts the shared start", () => {
        expect(commonPrefixLength("The ball costs $0.05", "The ball costs 5 cents")).toBe(15);
        expect(commonPrefixLength("", "abc")).toBe(0);
    });
});

describe("useSmoothText", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: () => ({ matches: false }),
        });
    });
    afterEach(() => jest.useRealTimers());

    it("shows a stored answer whole", () => {
        const { result } = renderHook(() => useSmoothText("Stored answer", false));
        expect(result.current).toEqual({ text: "Stored answer", revealing: false });
    });

    it("reveals a burst progressively, then finishes after the stream ends without a jump", () => {
        const full = "Either party may terminate on ninety days' written notice. ".repeat(12);
        const { result, rerender } = renderHook(({ text, live }) => useSmoothText(text, live), {
            initialProps: { text: "", live: true },
        });
        rerender({ text: full, live: true });
        expect(result.current.text).toBe("");
        act(() => {
            jest.advanceTimersByTime(200);
        });
        const early = result.current.text.length;
        expect(early).toBeGreaterThan(0);
        expect(early).toBeLessThan(full.length);
        // The stream ends while the reveal is still behind: it keeps going.
        rerender({ text: full, live: false });
        expect(result.current.text.length).toBeGreaterThanOrEqual(early);
        expect(result.current.revealing).toBe(true);
        act(() => {
            jest.advanceTimersByTime(4000);
        });
        expect(result.current).toEqual({ text: full, revealing: false });
    });

    it("rewinds only to the shared prefix when the final text differs", () => {
        const { result, rerender } = renderHook(({ text, live }) => useSmoothText(text, live), {
            initialProps: { text: "The ball costs $0.05 total.", live: true },
        });
        act(() => {
            jest.advanceTimersByTime(3000);
        });
        expect(result.current.text).toBe("The ball costs $0.05 total.");
        rerender({ text: "The ball costs 5 cents total.", live: false });
        expect(result.current.text).toBe("The ball costs ");
        act(() => {
            jest.advanceTimersByTime(3000);
        });
        expect(result.current.text).toBe("The ball costs 5 cents total.");
    });

    it("doesn't hold text back in a hidden tab, where nothing animates", () => {
        const hidden = jest.spyOn(document, "hidden", "get").mockReturnValue(true);
        const { result, rerender } = renderHook(({ text }) => useSmoothText(text, true), {
            initialProps: { text: "" },
        });
        rerender({ text: "Everything that arrived while you were away." });
        expect(result.current).toEqual({
            text: "Everything that arrived while you were away.",
            revealing: false,
        });
        hidden.mockRestore();
    });

    it("shows everything at once under reduced motion", () => {
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: () => ({ matches: true }),
        });
        const { result, rerender } = renderHook(({ text }) => useSmoothText(text, true), {
            initialProps: { text: "" },
        });
        rerender({ text: "All of it." });
        expect(result.current).toEqual({ text: "All of it.", revealing: false });
    });
});
