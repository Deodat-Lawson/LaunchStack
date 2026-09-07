/** @jest-environment jsdom */

import { citationNeedles, findTextRange } from "../find-text-range";

/**
 * The citation locator turns a retrieval snippet into a DOM Range inside a
 * rendered document. Snippets are whitespace-normalized chunk text that may
 * carry markdown syntax the renderer consumed and may be clipped mid-thought,
 * so matching is normalized and falls back to shorter windows.
 */

function root(html: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("citationNeedles", () => {
    it("puts the full snippet first and windows after", () => {
        const long = "alpha bravo charlie ".repeat(20).trim();
        const needles = citationNeedles(long);
        expect(needles[0]).toBe(long);
        expect(needles.length).toBeGreaterThan(1);
        for (const n of needles.slice(1, -1)) {
            expect(long.includes(n)).toBe(true);
        }
    });

    it("appends matchText as the last resort", () => {
        const needles = citationNeedles("some snippet text here", "keyword phrase");
        expect(needles.at(-1)).toBe("keyword phrase");
    });

    it("drops candidates too short to be selective", () => {
        expect(citationNeedles("hey", "ok")).toEqual([]);
    });
});

describe("findTextRange", () => {
    it("finds text spanning nested inline elements", () => {
        const el = root("<p>The <strong>retrieval stack</strong> indexes <em>uploads</em>.</p>");
        const range = findTextRange(el, citationNeedles("the retrieval stack indexes uploads"));
        expect(range).not.toBeNull();
        expect(range!.toString().replace(/\s+/g, " ")).toContain("retrieval stack");
    });

    it("matches despite whitespace and case differences", () => {
        const el = root("<p>Recall   improved\n\n substantially in Q3</p>");
        const range = findTextRange(el, citationNeedles("recall improved substantially IN q3"));
        expect(range).not.toBeNull();
    });

    it("matches snippets that carry markdown markers the renderer consumed", () => {
        const el = root("<p>This is a <strong>fixture document</strong> for the viewer</p>");
        const range = findTextRange(
            el,
            citationNeedles("This is a **fixture document** for the viewer")
        );
        expect(range).not.toBeNull();
    });

    it("falls back to a prefix window when the snippet tail is missing", () => {
        const el = root(
            "<p>Connector rate limits throttle the initial Drive backfill during rollout.</p>"
        );
        const clipped =
            "Connector rate limits throttle the initial Drive backfill during rollout, and the second half of this snippet lives in a chunk the renderer never shows anywhere at all so the full match fails";
        const range = findTextRange(el, citationNeedles(clipped));
        expect(range).not.toBeNull();
        expect(range!.toString()).toContain("Connector rate limits");
    });

    it("skips aria-hidden chrome such as line-number gutters", () => {
        const el = root(
            '<div><span aria-hidden="true">1</span><span>const x = compute();</span></div>' +
                '<div><span aria-hidden="true">2</span><span>return x;</span></div>'
        );
        const range = findTextRange(el, citationNeedles("const x = compute(); return x;"));
        expect(range).not.toBeNull();
    });

    it("returns null when nothing matches", () => {
        const el = root("<p>completely unrelated content</p>");
        expect(findTextRange(el, citationNeedles("the quick brown fox jumps"))).toBeNull();
    });
});
