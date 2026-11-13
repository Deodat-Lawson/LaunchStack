/**
 * Tolerant quote matching for the grounding check.
 *
 * The same normalisation the company profile's gate uses
 * (`company-metadata/passages.ts`), kept as a copy here because a vertical may
 * not import a sibling vertical (see `__tests__/architecture/tools-boundary`).
 * If a third reader needs it, move it to `@launchstack/tools`.
 */

const MIN_QUOTE_CHARS = 12;

function stripInlineMarkdown(text: string): string {
    return text
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2")
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1$2")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/<\/?(?:br|b|i|em|strong|code|sup|sub)\s*\/?>/gi, "");
}

/** Whitespace/hyphenation/quote-mark normalisation shared by the grounding gate. */
export function normalizeForMatch(text: string): string {
    return (
        stripInlineMarkdown(text)
            .normalize("NFKC")
            // Soft hyphens and zero-width characters are invisible in the source.
            .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
            .replace(/[\u2018\u2019\u201A\u201B\u2032`\u00B4]/g, "'")
            .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
            .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
            // A word split across a line break: "doc- ument", "pre-\ntrained".
            .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2")
            .replace(/\s+/g, " ")
            // PDF text spaces out punctuation ("proposition , for"); a quote won't.
            .replace(/ (?=[,.;:!?)\]}])/g, "")
            .replace(/(?<=[([{]) /g, "")
            .trim()
            .toLowerCase()
    );
}

/** True when `quote` (≥ 12 normalised chars) appears verbatim in `text` after normalising both. */
export function quoteAppearsIn(quote: string, text: string): boolean {
    const needle = normalizeForMatch(quote)
        .replace(/^["'\s]+|["'\s]+$/g, "")
        .replace(/^(?:\.{3}|…)\s*|\s*(?:\.{3}|…)$/g, "")
        .replace(/[.,;:]+$/, "")
        .trim();
    if (needle.length < MIN_QUOTE_CHARS) return false;
    const haystack = normalizeForMatch(text);
    if (haystack.includes(needle)) return true;
    // A real hyphen that fell at a line end ("open- source") reads "open-source"
    // in the model's quote; compare once more with hyphens between letters gone.
    return dropWordHyphens(haystack).includes(dropWordHyphens(needle));
}

function dropWordHyphens(text: string): string {
    return text.replace(/(?<=\p{L})-(?=\p{L})/gu, "");
}
