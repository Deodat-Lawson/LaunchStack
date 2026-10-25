import { escapeCurrencyDollars } from "../markdown-math";

/**
 * remark-math pairs any two single dollars in a paragraph. The pre-pass
 * escapes the dollars Pandoc's rule would leave literal, so prices stay text
 * and real inline math still reaches KaTeX.
 */

describe("escapeCurrencyDollars", () => {
    it("escapes two prices in one sentence", () => {
        expect(
            escapeCurrencyDollars("You'll pay $0.05 for the ball (and $1.05 for the bat).")
        ).toBe("You'll pay \\$0.05 for the ball (and $1.05 for the bat).");
    });

    it.each([
        "$x^2$",
        "where $E = mc^2$ holds",
        "$ \\frac{a}{b} $",
        "$a$, $b$ and the $x$-axis",
        "$$\\sum_i x_i$$ inline",
        "$$\nx = 5\n$$",
        "Already escaped: \\$5 and \\$10",
        "Only one price: $5",
    ])("leaves %j unchanged", text => {
        expect(escapeCurrencyDollars(text)).toBe(text);
    });

    it.each([
        ["from $5–$10", "from \\$5–$10"],
        ["$5,000/$7,500 a month", "\\$5,000/$7,500 a month"],
        ["US$5 or C$10", "US\\$5 or C$10"],
        ["5$ or 10$", "5\\$ or 10$"],
        ["| Ball | $0.05 | Bat | $1.05 |", "| Ball | \\$0.05 | Bat | $1.05 |"],
    ])("treats %j as currency", (text, expected) => {
        expect(escapeCurrencyDollars(text)).toBe(expected);
    });

    it("keeps math that follows a price", () => {
        expect(escapeCurrencyDollars("It costs $5 and grows as $x^2$.")).toBe(
            "It costs \\$5 and grows as $x^2$."
        );
    });

    it("pairs dollars within a paragraph, not across a blank line", () => {
        expect(escapeCurrencyDollars("Ball: $0.05\n\nBat: $1.05")).toBe(
            "Ball: $0.05\n\nBat: $1.05"
        );
        expect(escapeCurrencyDollars("Ball: $0.05\nBat: $1.05")).toBe("Ball: \\$0.05\nBat: $1.05");
    });

    it("never edits code", () => {
        const fenced = "```sh\necho $HOME and $PATH\n```";
        const tilde = "> ~~~\n> cost $5 and $6\n> ~~~";
        const span = "Run `echo $HOME $PATH` for $x$";
        expect(escapeCurrencyDollars(fenced)).toBe(fenced);
        expect(escapeCurrencyDollars(tilde)).toBe(tilde);
        expect(escapeCurrencyDollars(span)).toBe(span);
        expect(escapeCurrencyDollars(`${fenced}\n\nIt was $5 then $6`)).toBe(
            `${fenced}\n\nIt was \\$5 then $6`
        );
    });
});
