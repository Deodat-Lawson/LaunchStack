/**
 * Keep dollar amounts out of inline math.
 *
 * remark-math pairs any two single dollars in a paragraph, so "You'll pay
 * $0.05 for the ball (and $1.05 for the bat)" renders as one KaTeX span.
 * Single-dollar math has to stay on: no prompt tells models how to write
 * math, and `normalizeModelContent` rewrites `\(…\)` to `$…$` on the server.
 * Instead this pre-pass applies Pandoc's `tex_math_dollars` rule and
 * backslash-escapes each `$` that the rule leaves literal:
 *
 * - a single `$` pairs with the next single `$` in its paragraph;
 * - the pair is math only if the closing `$` is not followed by a digit
 *   ("$5–$10") and the inside is tight at both ends ("$x^2$") or padded at
 *   both ends ("$ x^2 $", what `\( x^2 \)` normalizes to);
 * - otherwise the opening `$` is a literal and the closing one may open the
 *   next pair ("$5 and $x$" keeps `x` as math).
 *
 * Code spans, fenced code, `$$` math and existing `\$` escapes pass through.
 * A `$` with no later partner is left alone, since remark-math can't pair it.
 */

/** A fence line: `` ``` ``, `~~~` or `$$`, possibly inside blockquotes or list indents. */
const FENCE = /^(?:\s*>)*\s*(`{3,}|~{3,}|\${2,})(.*)$/;
const BLANK = /^(?:\s*>)*\s*$/;

function runLength(text: string, at: number): number {
    let end = at;
    while (text[end] === text[at]) end++;
    return end - at;
}

/** Index of the next run of exactly `size` copies of `char`, or -1. */
function findRun(text: string, char: string, size: number, from: number): number {
    for (let i = from; i < text.length; ) {
        if (text[i] !== char) {
            i++;
            continue;
        }
        const run = runLength(text, i);
        if (run === size) return i;
        i += run;
    }
    return -1;
}

function pairsAsMath(text: string, open: number, close: number): boolean {
    const inner = text.slice(open + 1, close);
    if (!inner.trim()) return false;
    const paddedStart = /\s/.test(inner[0] ?? "");
    const paddedEnd = /\s/.test(inner[inner.length - 1] ?? "");
    return paddedStart === paddedEnd && !/\d/.test(text[close + 1] ?? "");
}

function escapeParagraph(text: string): string {
    const literal: number[] = [];
    for (let i = 0; i < text.length; ) {
        const char = text[i];
        if (char === "\\") {
            i += 2;
            continue;
        }
        if (char !== "`" && char !== "$") {
            i++;
            continue;
        }
        const size = runLength(text, i);
        if (char === "`" || size > 1) {
            // Code spans and `$$` math: skip to the matching run, if any.
            const close = findRun(text, char, size, i + size);
            i = close === -1 ? i + size : close + size;
            continue;
        }
        // Math content has no escapes or code spans, so the partner is simply the next lone `$`.
        const close = findRun(text, "$", 1, i + 1);
        if (close !== -1 && pairsAsMath(text, i, close)) {
            i = close + 1;
            continue;
        }
        if (close !== -1) literal.push(i);
        i++;
    }
    if (literal.length === 0) return text;
    let out = "";
    let from = 0;
    for (const at of literal) {
        out += `${text.slice(from, at)}\\`;
        from = at;
    }
    return out + text.slice(from);
}

export function escapeCurrencyDollars(markdown: string): string {
    if (!markdown.includes("$")) return markdown;
    const out: string[] = [];
    let paragraph: string[] = [];
    let fence: { char: string; size: number } | null = null;
    const flush = () => {
        if (paragraph.length > 0) out.push(escapeParagraph(paragraph.join("\n")));
        paragraph = [];
    };
    for (const line of markdown.split("\n")) {
        const match = FENCE.exec(line);
        const run = match?.[1] ?? "";
        const rest = match?.[2] ?? "";
        if (fence) {
            out.push(line);
            if (run.startsWith(fence.char) && run.length >= fence.size && !rest.trim())
                fence = null;
            continue;
        }
        // An info string can't hold its own fence character (`$$x$$` is inline math).
        const char = run[0];
        if (char && (char === "~" || !rest.includes(char))) {
            flush();
            out.push(line);
            fence = { char, size: run.length };
            continue;
        }
        if (BLANK.test(line)) {
            flush();
            out.push(line);
            continue;
        }
        paragraph.push(line);
    }
    flush();
    return out.join("\n");
}
