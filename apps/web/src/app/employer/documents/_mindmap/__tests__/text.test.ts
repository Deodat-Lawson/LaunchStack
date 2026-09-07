import { defaultTextStyle } from "../model/factory";
import { firstBaseline, layoutText, measureText, preferredTextSize, wrapText } from "../model/text";

const style = defaultTextStyle({ size: 14 });

describe("measureText", () => {
    it("returns zero for empty text", () => {
        expect(measureText("", style)).toBe(0);
    });

    it("grows with length", () => {
        expect(measureText("mm", style)).toBeGreaterThan(measureText("m", style));
    });

    it("grows with font size", () => {
        const big = defaultTextStyle({ size: 28 });
        expect(measureText("hello", big)).toBeGreaterThan(measureText("hello", style));
    });

    it("gives narrow glyphs less width than wide ones", () => {
        expect(measureText("iiii", style)).toBeLessThan(measureText("mmmm", style));
    });
});

describe("wrapText", () => {
    it("keeps a short line intact", () => {
        expect(wrapText("hello", style, 500).map(l => l.text)).toEqual(["hello"]);
    });

    it("breaks between words", () => {
        const lines = wrapText("alpha beta gamma delta", style, 60).map(l => l.text);
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
            expect(line).not.toMatch(/^\s|\s$/);
        }
    });

    it("honours explicit newlines", () => {
        expect(wrapText("one\ntwo", style, 500).map(l => l.text)).toEqual(["one", "two"]);
    });

    it("preserves blank lines between paragraphs", () => {
        expect(wrapText("a\n\nb", style, 500).map(l => l.text)).toEqual(["a", "", "b"]);
    });

    it("hard-breaks a word wider than the box", () => {
        const lines = wrapText("supercalifragilistic", style, 30).map(l => l.text);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join("")).toBe("supercalifragilistic");
    });

    it("never returns an empty list", () => {
        expect(wrapText("", style, 100)).toHaveLength(1);
    });

    it("does not wrap at all for a non-positive width", () => {
        expect(wrapText("a b c d e f g", style, 0).map(l => l.text)).toEqual(["a b c d e f g"]);
    });

    it("reports each line's own measured width", () => {
        for (const line of wrapText("alpha beta gamma", style, 60)) {
            expect(line.width).toBeCloseTo(measureText(line.text, style));
        }
    });
});

describe("layoutText", () => {
    it("scales height with the line count and line height", () => {
        const one = layoutText("a", style, 500);
        const two = layoutText("a\nb", style, 500);
        expect(two.height).toBeCloseTo(one.height * 2);
        expect(one.lineHeight).toBeCloseTo(style.size * style.lineHeight);
    });

    it("reports the widest line as the block width", () => {
        const laid = layoutText("a\nlonger line", style, 500);
        expect(laid.width).toBeCloseTo(measureText("longer line", style));
    });
});

describe("firstBaseline", () => {
    const laid = layoutText("one\ntwo", style, 500);

    it("stacks from the top for top alignment", () => {
        expect(firstBaseline(200, laid, "top")).toBeCloseTo(laid.lineHeight * 0.78);
    });

    it("centres the block for middle alignment", () => {
        const baseline = firstBaseline(200, laid, "middle");
        expect(baseline).toBeCloseTo((200 - laid.height) / 2 + laid.lineHeight * 0.78);
    });

    it("pushes the block down for bottom alignment", () => {
        expect(firstBaseline(200, laid, "bottom")).toBeGreaterThan(
            firstBaseline(200, laid, "middle")
        );
    });
});

describe("preferredTextSize", () => {
    it("reports a box big enough for the wrapped text", () => {
        const size = preferredTextSize("alpha beta gamma delta", style, 80);
        expect(size.w).toBeLessThanOrEqual(80);
        expect(size.h).toBeGreaterThan(style.size);
    });
});
