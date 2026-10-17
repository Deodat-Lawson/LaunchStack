/**
 * Post-process LLM chat responses into clean markdown.
 *
 * Several LangChain providers return `AIMessageChunk.content` as either a
 * string or an array of content parts (text + tool use + images). This
 * helper flattens that to a string, then rewrites LaTeX math delimiters into
 * the dollar notation remark-math reads:
 *
 * - `\(x\)` becomes `$x$`, trimmed so `\( x \)` gives `$x$`;
 * - `\[x\]` becomes `$$x$$`, unless it reads as escaped brackets (`\[1\]`);
 * - a bare `( … )` or `[ … ]` becomes math only when it holds a LaTeX math
 *   command or a braced sub/superscript and no prose words, for models that
 *   drop the backslashes ("( \frac{1}{1-x} )"). "(a=b)", "(DATABASE_URL)",
 *   "options (a) and (b)" and "[ E = mc^2 ]" stay text.
 *
 * Fenced code, code spans, existing `$…$` / `$$…$$` math and escaped
 * delimiters (`\\(`) pass through untouched. Fences and dollar pairing follow
 * apps/web's `escapeCurrencyDollars` (lib/markdown-math.ts), which runs on
 * this output in the browser.
 */

/** A fence line: `` ``` ``, `~~~` or `$$`, possibly inside blockquotes or list indents. */
const FENCE = /^(?:\s*>)*\s*(`{3,}|~{3,}|\${2,})(.*)$/;
const BLANK = /^(?:\s*>)*\s*$/;

/** A `[ … ]` or `( … )` group with no nesting, code, math or line break inside. */
const BARE_GROUP = /\[([^[\]\n`$]+)\]|\(([^()\n`$]+)\)/g;

/** A LaTeX command not preceded by an escaping backslash (`\\frac` is literal text). */
const COMMAND = /(?<!\\)(?:\\\\)*\\([A-Za-z]+)/g;

/** Commands that only mean something in math, so a bare group holding one is math. */
const MATH_COMMANDS = new Set(
    `alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda
    mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega
    Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega
    sum prod coprod int iint iiint oint bigcup bigcap lim limsup liminf sup inf max min
    argmax argmin sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg
    exp det dim ker deg gcd frac dfrac tfrac cfrac sqrt binom tbinom dbinom
    le leq ge geq ne neq approx equiv sim simeq cong propto ll gg prec succ mid parallel
    perp in notin ni subset subseteq supset supseteq cup cap setminus emptyset varnothing
    forall exists nexists neg lnot land lor wedge vee to gets rightarrow leftarrow
    Rightarrow Leftarrow leftrightarrow Leftrightarrow iff implies impliedby mapsto
    longrightarrow longmapsto uparrow downarrow cdot times div pm mp ast star circ bullet
    oplus ominus otimes odot infty partial nabla hbar ell Re Im aleph prime angle
    ldots cdots vdots ddots dots mathbf mathrm mathbb mathcal mathfrak mathit mathsf
    mathtt boldsymbol bm text textbf textit operatorname hat bar vec tilde dot ddot
    overline underline widehat widetilde overrightarrow left right big Big bigl bigr
    langle rangle lvert rvert lVert rVert lfloor rfloor lceil rceil quad qquad`.split(/\s+/)
);

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

/** Pandoc's rule for whether `$…$` between `open` and `close` is math. */
function pairsAsMath(text: string, open: number, close: number): boolean {
    const inner = text.slice(open + 1, close);
    if (!inner.trim()) return false;
    const paddedStart = /\s/.test(inner[0] ?? "");
    const paddedEnd = /\s/.test(inner[inner.length - 1] ?? "");
    return paddedStart === paddedEnd && !/\d/.test(text[close + 1] ?? "");
}

/** Index of the unescaped `\)` or `\]` that closes a delimiter, or -1. */
function findClosingDelimiter(text: string, char: string, from: number): number {
    for (let i = from; i < text.length; i++) {
        if (text[i] !== "\\") continue;
        if (text[i + 1] === char) return i;
        i++;
    }
    return -1;
}

function inlineMath(inner: string): string | null {
    const trimmed = inner.trim();
    return trimmed ? `$${trimmed}$` : null;
}

function displayMath(inner: string): string | null {
    if (!inner.trim()) return null;
    // `\[1\]` and `\[Source 2\]` are markdown-escaped brackets, not display math.
    const padded = /^\s/.test(inner) && /\s$/.test(inner);
    return padded || /[\\^_=+<>{}]/.test(inner) ? `$$${inner}$$` : null;
}

function isClearlyMath(inner: string): boolean {
    const hasSignal =
        /[_^]\{/.test(inner) ||
        [...inner.matchAll(COMMAND)].some(match => MATH_COMMANDS.has(match[1] ?? ""));
    if (!hasSignal) return false;
    // A stray command in prose ("(where \alpha is the rate)") stays text.
    let bare = inner.replace(/\\[A-Za-z]+/g, " ");
    for (let previous = ""; previous !== bare; ) {
        previous = bare;
        bare = bare.replace(/\{[^{}]*\}/g, " ");
    }
    return !/[A-Za-z]{3,}/.test(bare);
}

function aloneOnLine(text: string, from: number, to: number): boolean {
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = text.indexOf("\n", to);
    return (
        !text.slice(lineStart, from).trim() &&
        !text.slice(to, lineEnd === -1 ? text.length : lineEnd).trim()
    );
}

/** Rewrite clearly mathematical bare groups in the prose `text[start, end)`. */
function rewriteBareMath(text: string, start: number, end: number): string {
    const prose = text.slice(start, end);
    if (!prose.includes("\\") && !/[_^]\{/.test(prose)) return prose;
    return prose.replace(
        BARE_GROUP,
        (match, bracket: string | undefined, paren: string | undefined, offset: number) => {
            const inner = bracket ?? paren ?? "";
            if (!isClearlyMath(inner)) return match;
            const from = start + offset;
            const to = from + match.length;
            const before = text[from - 1] ?? "";
            const after = text[to] ?? "";
            if (paren !== undefined) {
                // `f(\alpha)` is a call inside math, and `$` neighbours would merge into `$$`.
                const call = /[\w\\\]$]/.test(before) || /[\w$]/.test(after);
                return call ? match : `$${inner.trim()}$`;
            }
            // Links, images, reference definitions and `x[i]` indexing keep their brackets.
            if (/[\w\\!\]$]/.test(before) || /[([:$]/.test(after)) return match;
            if (aloneOnLine(text, from, to)) return `$$${inner.trim()}$$`;
            const padded = /^\s/.test(inner) && /\s$/.test(inner);
            return padded ? `$${inner.trim()}$` : match;
        }
    );
}

/** Rewrite one paragraph, leaving code spans and existing math as they are. */
function normalizeParagraph(text: string): string {
    let out = "";
    let prose = 0;
    const keep = (from: number, replacement: string, resume: number) => {
        out += rewriteBareMath(text, prose, from) + replacement;
        prose = resume;
    };
    for (let i = 0; i < text.length; ) {
        const char = text[i];
        if (char === "\\") {
            const next = text[i + 1];
            if (next === "(" || next === "[") {
                const close = findClosingDelimiter(text, next === "(" ? ")" : "]", i + 2);
                const inner = text.slice(i + 2, close);
                const math =
                    close === -1 ? null : next === "(" ? inlineMath(inner) : displayMath(inner);
                if (math !== null) {
                    keep(i, math, close + 2);
                    i = close + 2;
                    continue;
                }
            }
            i += 2;
            continue;
        }
        if (char !== "`" && char !== "$") {
            i++;
            continue;
        }
        const size = runLength(text, i);
        let end = -1;
        if (char === "`" || size > 1) {
            const close = findRun(text, char, size, i + size);
            if (close !== -1) end = close + size;
        } else {
            const close = findRun(text, "$", 1, i + 1);
            if (close !== -1 && pairsAsMath(text, i, close)) end = close + 1;
        }
        if (end === -1) {
            i += size;
            continue;
        }
        keep(i, text.slice(i, end), end);
        i = end;
    }
    return out + rewriteBareMath(text, prose, text.length);
}

function normalizeMath(markdown: string): string {
    if (!markdown.includes("\\") && !/[_^]\{/.test(markdown)) return markdown;
    const out: string[] = [];
    let paragraph: string[] = [];
    let fence: { char: string; size: number } | null = null;
    const flush = () => {
        if (paragraph.length > 0) out.push(normalizeParagraph(paragraph.join("\n")));
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

export function normalizeModelContent(content: unknown): string {
    if (typeof content === "string") {
        return normalizeMath(content);
    }

    if (Array.isArray(content)) {
        const joined = content
            .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
            .join("");
        return normalizeMath(joined);
    }

    if (content == null) {
        return "";
    }

    try {
        return JSON.stringify(content);
    } catch {
        return Object.prototype.toString.call(content);
    }
}
