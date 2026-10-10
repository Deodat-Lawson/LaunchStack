/**
 * A passage the reader selected in a document and asked about.
 *
 * It travels beside the question, never inside it. The question is what the
 * reader typed; the passage is what they were looking at. Pasting the passage
 * into the message as a Markdown quote made it the search query (so retrieval
 * mostly re-found the passage itself), dropped the page it came from, and
 * showed raw `>` lines and a machine link in the composer and the transcript.
 */
export interface ChatPassage {
    /** Workspace source id — the same id the composer's refs carry. */
    sourceId: string;
    /** Indexed document id, when the source is a document. */
    documentId?: number;
    /** The source's title when the passage was taken. */
    title: string;
    /** 1-based page, when the viewer knows it (PDFs do). */
    page?: number;
    /** The selected text, cleaned of PDF line wrapping. */
    text: string;
}

/** The passage as the chat endpoint receives it. */
export interface ChatPassagePayload {
    documentId?: number;
    title: string;
    page?: number;
    text: string;
}

export const MAX_PASSAGES = 5;
export const MAX_PASSAGE_CHARS = 4_000;
export const MAX_PASSAGE_TITLE_CHARS = 512;

/** What to ask when a passage is sent with nothing typed. */
export const DEFAULT_PASSAGE_QUESTION = "Explain this passage.";

/**
 * Undo the line wrapping a PDF text layer puts into a selection.
 *
 * A selection across a column comes back with a newline at every visual line
 * end and words hyphenated across them ("re-\ntrieval"). Single newlines join
 * with a space, a word broken at a line end joins up with its hyphen kept
 * ("re-trieval": the hyphen may be real, and keeping it means the text still
 * matches the page when the passage is highlighted there), and blank lines
 * (paragraph breaks) survive.
 */
export function cleanSelectionText(text: string): string {
    return text
        .replace(/\r\n?/g, "\n")
        .split(/\n[ \t]*\n+/)
        .map(paragraph =>
            paragraph
                .replace(/([A-Za-z])-[ \t]*\n[ \t]*(?=[a-z])/g, "$1-")
                .replace(/[ \t]*\n[ \t]*/g, " ")
                .replace(/[ \t]{2,}/g, " ")
                .trim()
        )
        .filter(Boolean)
        .join("\n\n")
        .slice(0, MAX_PASSAGE_CHARS);
}

/** Build a passage from a selection; null when nothing usable was selected. */
export function makePassage(input: {
    sourceId: string;
    documentId?: number;
    title: string;
    page?: number;
    text: string;
}): ChatPassage | null {
    const text = cleanSelectionText(input.text);
    if (!text) return null;
    return {
        sourceId: input.sourceId,
        ...(typeof input.documentId === "number" ? { documentId: input.documentId } : {}),
        title: input.title.slice(0, MAX_PASSAGE_TITLE_CHARS) || "Untitled",
        ...(input.page && input.page > 0 ? { page: Math.floor(input.page) } : {}),
        text,
    };
}

/** Same document, same page, same text: the same passage. */
export function samePassage(a: ChatPassage, b: ChatPassage): boolean {
    return a.sourceId === b.sourceId && a.page === b.page && a.text === b.text;
}

/** Add a passage to a list, skipping duplicates and keeping the newest five. */
export function addPassage(list: readonly ChatPassage[], passage: ChatPassage): ChatPassage[] {
    if (list.some(item => samePassage(item, passage))) return [...list];
    return [...list, passage].slice(-MAX_PASSAGES);
}

/** "Title · p. 3", or just the title when the page is unknown. */
export function passageLabel(passage: Pick<ChatPassage, "title" | "page">): string {
    return passage.page ? `${passage.title} · p. ${passage.page}` : passage.title;
}

export function toPassagePayload(passage: ChatPassage): ChatPassagePayload {
    return {
        ...(typeof passage.documentId === "number" ? { documentId: passage.documentId } : {}),
        title: passage.title,
        ...(passage.page ? { page: passage.page } : {}),
        text: passage.text,
    };
}

/**
 * The passages as plain text for a transcript or for the conversation history
 * a later turn sends, so a follow-up still knows what "this" was.
 */
export function passagesAsText(passages: readonly Pick<ChatPassage, "title" | "page" | "text">[]) {
    return passages
        .map(passage => `[Selected passage from "${passageLabel(passage)}"]\n"${passage.text}"`)
        .join("\n\n");
}

/**
 * The machine link older clients wrote after a pasted quote. It only ever
 * marked where the quote came from, so it is never shown.
 */
export const QUOTED_CONTEXT_MARKER = /\[Quoted context\]\(#launchstack-quoted-context\)/g;

/** A pasted-quote provenance link of either kind ("Quoted context" or "Source message"). */
export const QUOTE_MARKER =
    /\[(?:Quoted context|Source message)\]\(#(?:launchstack-quoted-context|chat-message-[\w-]+)\)/g;

/**
 * A message with its pasted `>` quotes and their provenance links removed —
 * what the person actually typed around the quote.
 */
export function withoutQuotedContext(text: string): string {
    return text
        .split("\n")
        .filter(line => !/^\s*>/.test(line))
        .join("\n")
        .replace(QUOTE_MARKER, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** A stored or received value that is a well-formed passage. */
export function isChatPassage(value: unknown): value is ChatPassage {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<ChatPassage>;
    return (
        typeof item.sourceId === "string" &&
        typeof item.title === "string" &&
        typeof item.text === "string" &&
        item.text.length > 0 &&
        item.text.length <= MAX_PASSAGE_CHARS &&
        (item.documentId === undefined || typeof item.documentId === "number") &&
        (item.page === undefined || (typeof item.page === "number" && item.page > 0))
    );
}
