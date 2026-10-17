import { describe, expect, it } from "vitest";

import { normalizeModelContent } from "./normalize-content";

const raw = String.raw;

describe("normalizeModelContent: flattening", () => {
    it("joins string and object parts", () => {
        expect(normalizeModelContent(["foo", { bar: 1 }])).toBe('foo{"bar":1}');
    });

    it("returns an empty string for nullish content", () => {
        expect(normalizeModelContent(null)).toBe("");
        expect(normalizeModelContent(undefined)).toBe("");
    });

    it("normalizes math in joined parts", () => {
        expect(normalizeModelContent([raw`Let \( x `, raw`\) be real.`])).toBe("Let $x$ be real.");
    });
});

describe("normalizeModelContent: LaTeX delimiters", () => {
    it("rewrites \\( … \\) to tight inline math", () => {
        expect(normalizeModelContent(raw`So \( x^2 + 1 \) and \(y\) hold.`)).toBe(
            "So $x^2 + 1$ and $y$ hold."
        );
    });

    it("rewrites \\[ … \\] to display math, keeping block layout", () => {
        expect(
            normalizeModelContent(
                raw`The sum is` +
                    "\n" +
                    raw`\[` +
                    "\n" +
                    raw`\sum_{n=0}^{\infty} x^n` +
                    "\n" +
                    raw`\]`
            )
        ).toBe("The sum is\n$$\n" + raw`\sum_{n=0}^{\infty} x^n` + "\n$$");
        expect(normalizeModelContent(raw`where \[ E = mc^2 \] holds`)).toBe(
            "where $$ E = mc^2 $$ holds"
        );
    });

    it("keeps parentheses inside converted math", () => {
        expect(normalizeModelContent(raw`\[ (\alpha + \beta)^2 \]`)).toBe(
            raw`$$ (\alpha + \beta)^2 $$`
        );
        expect(normalizeModelContent(raw`\( f(\alpha) \)`)).toBe(raw`$f(\alpha)$`);
    });

    it("leaves markdown-escaped brackets alone", () => {
        const text = raw`See \[1\] and \[Source 2\].`;
        expect(normalizeModelContent(text)).toBe(text);
    });

    it("leaves empty, unpaired and escaped delimiters alone", () => {
        for (const text of [
            raw`empty \( \) pair`,
            raw`a lone \( opener`,
            raw`{"pattern": "\\(x\\)"}`,
        ]) {
            expect(normalizeModelContent(text)).toBe(text);
        }
    });
});

describe("normalizeModelContent: code", () => {
    it("never rewrites fenced code", () => {
        const fenced = [
            "```js",
            raw`const re = /\(\d+\)/;`,
            raw`const sq = /\[a-z\]/; // (a=b) (DATABASE_URL) ( \frac{1}{2} )`,
            "```",
        ].join("\n");
        expect(normalizeModelContent(`${fenced}\n\nThen \\( x \\).`)).toBe(
            `${fenced}\n\nThen $x$.`
        );
    });

    it("never rewrites tilde, indented, blockquoted or unclosed fences", () => {
        for (const text of [
            "~~~\n" + raw`\(x\)` + "\n~~~",
            "1. Run:\n\n    ```bash\n    grep '\\(foo\\)' file\n    ```",
            "> ```\n> " + raw`\[ x \]` + "\n> ```",
            "```\n" + raw`\(x\)` + "\n\n" + raw`( \frac{1}{2} )`,
        ]) {
            expect(normalizeModelContent(text)).toBe(text);
        }
    });

    it("never rewrites code spans", () => {
        for (const text of [
            raw`Match it with ` + "`" + raw`/\(\d+\)/` + "`" + ".",
            "Use ``" + raw`a ` + "`" + raw` \(x\)` + "`` here.",
            "Call `" + raw`( \frac{1}{2} )` + "` now.",
        ]) {
            expect(normalizeModelContent(text)).toBe(text);
        }
    });

    it("still converts math next to a code span", () => {
        expect(normalizeModelContent("Run `ls` when \\( n > 0 \\).")).toBe(
            "Run `ls` when $n > 0$."
        );
    });
});

describe("normalizeModelContent: bare parentheses", () => {
    it("leaves ordinary parentheses alone", () => {
        for (const text of [
            "Set the URL (DATABASE_URL) first.",
            "If (a=b) then stop.",
            "Pick options (a) and (b).",
            "With (C_n = 1) and (x^2).",
            "Call func(x, y) to start.",
            "Pages (1-3) and (see above).",
        ]) {
            expect(normalizeModelContent(text)).toBe(text);
        }
    });

    it("converts parentheses that hold LaTeX math", () => {
        expect(
            normalizeModelContent(raw`It equals ( \frac{1}{1-x} ) for (\sum_{n=0}^{\infty} x^n).`)
        ).toBe(raw`It equals $\frac{1}{1-x}$ for $\sum_{n=0}^{\infty} x^n$.`);
        expect(normalizeModelContent("So (x^{2} + 1) grows.")).toBe("So $x^{2} + 1$ grows.");
    });

    it("leaves commands in prose, paths and calls alone", () => {
        for (const text of [
            raw`The rate (where \alpha is the learning rate) matters.`,
            raw`Install to (C:\Users\me) now.`,
            raw`Use (\n) for newlines.`,
            raw`Then f(\alpha) is smooth.`,
            raw`A literal (\\frac{1}{2}) here.`,
            raw`Text (\alpha)s next.`,
        ]) {
            expect(normalizeModelContent(text)).toBe(text);
        }
    });
});

describe("normalizeModelContent: bare brackets", () => {
    it("leaves ordinary brackets alone", () => {
        for (const text of [
            "Array access like arr[0] should not change.",
            "The formula [ E = mc^2 ] is famous.",
            "[DATABASE_URL]",
            "- [ ] todo\n- [x] done",
            raw`See [\alpha](https://example.com) and ![\beta](img.png).`,
            raw`Index x[ \alpha ] stays.`,
        ]) {
            expect(normalizeModelContent(text)).toBe(text);
        }
    });

    it("converts brackets that hold LaTeX math", () => {
        expect(normalizeModelContent(raw`First [ \alpha + \beta ] then.`)).toBe(
            raw`First $\alpha + \beta$ then.`
        );
        expect(normalizeModelContent("Where:\n" + raw`  [ \int_0^1 f(x)\,dx ]` + "\nholds.")).toBe(
            "Where:\n" + raw`  $$\int_0^1 f(x)\,dx$$` + "\nholds."
        );
    });
});

describe("normalizeModelContent: existing math", () => {
    it("leaves dollar math and $$ blocks alone", () => {
        for (const text of [
            raw`Here $(\alpha + \beta)^2$ and $f(\alpha)$.`,
            raw`Inline $$ (\frac{1}{2}) $$ too.`,
            "$$\n" + raw`g( \alpha ) = [ \beta ]` + "\n$$",
        ]) {
            expect(normalizeModelContent(text)).toBe(text);
        }
    });

    it("leaves dollar amounts alone", () => {
        const text = raw`You'll pay $0.05 for the ball (and $1.05 for the bat) \( x \).`;
        expect(normalizeModelContent(text)).toBe(
            "You'll pay $0.05 for the ball (and $1.05 for the bat) $x$."
        );
    });
});
