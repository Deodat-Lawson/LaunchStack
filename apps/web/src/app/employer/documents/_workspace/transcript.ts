import type { ThreadMessage, ThreadReference, WorkspaceSource } from "./types";

/**
 * Text shapes the chat hands to the clipboard, to a download, or to the
 * Add-source dialog. Pure, so the menus that use them can be unit-tested.
 */

/** An answer without its inline bold markers — what "Copy" should give you. */
export function plainTextOfAnswer(text: string): string {
    return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/**
 * `“passage” — Title` — a quote that says where it came from.
 *
 * No page number, deliberately. Indexing writes `page_number: 1` for every
 * chunk of every document, so a page shown here was never a real location —
 * it said "p. 1" whether the passage came from the first page or the
 * fortieth. Printing it made a citation look precise while being wrong, which
 * is worse than omitting it. Restore the argument once the chunker records
 * real pages and existing documents have been reindexed.
 */
export function citationWithSource(quote: string, source: Pick<WorkspaceSource, "title">): string {
    return `“${quote.trim()}” — ${source.title}`;
}

export function citationOfReference(
    cite: ThreadReference,
    source: Pick<WorkspaceSource, "title">
): string {
    return citationWithSource(cite.snippet, source);
}

/** The whole conversation as Markdown, citations included. */
export function transcriptMarkdown(thread: ThreadMessage[], sources: WorkspaceSource[]): string {
    const titleOf = (id: string) => sources.find(s => s.id === id)?.title ?? id;
    const blocks = thread.map(msg => {
        if (msg.role === "user") {
            const refs = (msg.refs ?? []).map(titleOf);
            const scope = refs.length ? `\n\n_Asked over: ${refs.join(", ")}_` : "";
            return `## You\n\n${msg.text}${scope}`;
        }
        const cites = (msg.citations ?? [])
            .map(c => {
                const source = sources.find(s => s.id === c.sourceId);
                return source ? `- ${citationOfReference(c, source)}` : null;
            })
            .filter((line): line is string => Boolean(line));
        const grounded = cites.length ? `\n\n**Grounded in**\n\n${cites.join("\n")}` : "";
        const model = msg.model ? ` (${msg.model})` : "";
        return `## Launchstack${model}\n\n${msg.text}${grounded}`;
    });
    return `# Chat transcript\n\n${blocks.join("\n\n---\n\n")}\n`;
}

/** A passage as a Markdown blockquote, ready to type under. */
export function quoteBlock(text: string): string {
    const lines = text.trim().split("\n");
    return `${lines.map(line => `> ${line}`).join("\n")}\n\n`;
}

/** A filename-safe stem for a downloaded transcript. */
export function transcriptFilename(thread: ThreadMessage[]): string {
    const first = thread.find(m => m.role === "user")?.text ?? "chat";
    const stem = first
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return `${stem || "chat"}.md`;
}

/** Hands the browser a text file to save. */
export function downloadTextFile(name: string, text: string, type = "text/markdown"): void {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** A question that carries a quoted passage, split into its parts. */
export interface QuotedMessage {
    /** What was asked, before the quote. */
    lead: string;
    /** The passage, `>` markers stripped and line breaks kept. Null if none. */
    quote: string | null;
    /** Anything typed after the quote. */
    trail: string;
}

/**
 * Split a message into question and quoted passage.
 *
 * `quoteBlock()` writes a Markdown blockquote, but the chat renders a user
 * turn as plain text — so the `>` markers showed up literally and, with
 * `white-space: normal`, the whole thing collapsed onto one line. Reading the
 * markers back out lets the UI draw the passage as a passage.
 *
 * Only a contiguous run of `>` lines counts, so a line that merely starts with
 * a chevron mid-question does not silently become a quote.
 */
export function parseQuotedMessage(text: string): QuotedMessage {
    const lines = text.split("\n");
    const first = lines.findIndex(line => /^\s*>/.test(line));
    if (first === -1) return { lead: text.trim(), quote: null, trail: "" };

    let last = first;
    while (last + 1 < lines.length && /^\s*>/.test(lines[last + 1] ?? "")) last += 1;

    const quote = lines
        .slice(first, last + 1)
        // `>` alone is a blank line inside the quote, not a line reading ">".
        .map(line => line.replace(/^\s*>\s?/, ""))
        .join("\n")
        .trim();

    return {
        lead: lines.slice(0, first).join("\n").trim(),
        quote: quote.length > 0 ? quote : null,
        trail: lines
            .slice(last + 1)
            .join("\n")
            .trim(),
    };
}
