/**
 * How a saved web page's document row says what it is, and whether a page has
 * anything on it to read.
 *
 * A website source is the page's HTML, kept so ingestion can read it and the
 * company profile and Ask can quote it. It is never shown as HTML: the viewer
 * frames untrusted HTML with scripts off, and most company sites build or
 * reveal their content with JavaScript, so that frame was a white page. The
 * viewer shows the site's address and the text ingestion read instead
 * (WebsiteViewer).
 *
 * Nothing else on the row says it came from a website: the creation key is
 * stored hashed, and the file is plain HTML. So the importers write a marker
 * into `ocrMetadata`, beside the artifact and mindmap markers, which OCR
 * completion merges rather than replaces. Pages saved before the marker get
 * it from the `2026-10-website-source-markers` backfill.
 *
 * Pure shape and string work, so the import routes, the display-type sniff
 * and the viewer share it.
 */

export const WEBSITE_DOCUMENT_KIND = "website";

export interface WebsiteDocumentMarker {
    kind: typeof WEBSITE_DOCUMENT_KIND;
    /** The page's address, for "Open site". */
    url: string;
    /** When the page was fetched; null on a marker read back without one. */
    capturedAt: string | null;
}

export function websiteDocumentMarker(input: {
    url: string;
    capturedAt?: Date;
}): WebsiteDocumentMarker {
    return {
        kind: WEBSITE_DOCUMENT_KIND,
        url: input.url,
        capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    };
}

/** Only an http(s) address is a site to open: a stored `javascript:` URL is still a URL. */
function webAddress(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
        return null;
    }
}

/** The marker in a document row's `ocrMetadata`, or null when it is not a saved web page. */
export function websiteMarkerOf(ocrMetadata: unknown): WebsiteDocumentMarker | null {
    if (!ocrMetadata || typeof ocrMetadata !== "object" || Array.isArray(ocrMetadata)) {
        return null;
    }
    const record = ocrMetadata as { kind?: unknown; url?: unknown; capturedAt?: unknown };
    if (record.kind !== WEBSITE_DOCUMENT_KIND) return null;
    const url = webAddress(record.url);
    if (!url) return null;
    return {
        kind: WEBSITE_DOCUMENT_KIND,
        url,
        capturedAt:
            typeof record.capturedAt === "string" && record.capturedAt ? record.capturedAt : null,
    };
}

/** "https://www.acme.com/about" → "acme.com": the name people know a site by. */
export function websiteHost(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

/**
 * Below this many words a page has nothing worth quoting. A page that builds
 * itself with JavaScript arrives as an empty shell, perhaps with a "please
 * enable JavaScript" line, and lands well under it; a real homepage, however
 * short, says more than twenty words about what the company does.
 */
export const MIN_READABLE_WORDS = 20;

/**
 * Words in running text. Each Chinese or Japanese character counts as one,
 * since those scripts put no spaces between words.
 */
export function wordCount(text: string): number {
    const words = text.match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
    );
    return words?.filter(w => /\p{L}/u.test(w)).length ?? 0;
}

/** Elements whose contents a reader never sees as page text. */
const HIDDEN_BLOCKS = /<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi;

/**
 * Roughly how many words a person would read on the page with scripts off:
 * the body's text without scripts, styles, `<noscript>` notices or markup.
 * Only a count for {@link hasReadableText}, never text to show or index.
 */
export function visibleWordCount(html: string): number {
    const text = html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<head\b[\s\S]*?<\/head\s*>/i, " ")
        .replace(HIDDEN_BLOCKS, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&[#a-z0-9]+;/gi, " ");
    return wordCount(text);
}

/** Whether a fetched page has enough text to be worth keeping as a source. */
export function hasReadableText(html: string): boolean {
    return visibleWordCount(html) >= MIN_READABLE_WORDS;
}
