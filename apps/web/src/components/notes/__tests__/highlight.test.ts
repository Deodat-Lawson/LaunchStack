import { DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_TAG, highlightColorOf } from "../_shared/highlight";

describe("highlightColorOf", () => {
    const anchor = (color?: unknown) => ({
        type: "pdf",
        primary: { kind: "pdf", page: 2, quads: [[0.1, 0.2, 0.5, 0.25]], color },
        quote: { exact: "net revenue" },
    });

    it("reads a highlight's colour off its anchor", () => {
        expect(highlightColorOf({ tags: [HIGHLIGHT_TAG], anchor: anchor("green") })).toBe("green");
    });

    it("reads an ordinary note, even one with a colour, as no highlight", () => {
        expect(highlightColorOf({ tags: ["todo"], anchor: anchor("green") })).toBeNull();
        expect(highlightColorOf({ tags: null, anchor: null })).toBeNull();
    });

    it("falls back to yellow when the colour is missing or not one of ours", () => {
        expect(highlightColorOf({ tags: [HIGHLIGHT_TAG], anchor: anchor() })).toBe(
            DEFAULT_HIGHLIGHT_COLOR
        );
        expect(highlightColorOf({ tags: [HIGHLIGHT_TAG], anchor: anchor("#ff0000") })).toBe(
            DEFAULT_HIGHLIGHT_COLOR
        );
    });
});
