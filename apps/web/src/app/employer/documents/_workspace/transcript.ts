import type { ThreadMessage, ThreadReference, WorkspaceSource } from "./types";

/**
 * Text shapes the chat hands to the clipboard, to a download, or to the
 * Add-source dialog. Pure, so the menus that use them can be unit-tested.
 */

/** An answer without its inline bold markers — what "Copy" should give you. */
export function plainTextOfAnswer(text: string): string {
    return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/** `“passage” — Title, p. 4` — a quote that says where it came from. */
export function citationWithSource(
    quote: string,
    source: Pick<WorkspaceSource, "title">,
    page?: number | null
): string {
    const where = page ? `${source.title}, p. ${page}` : source.title;
    return `“${quote.trim()}” — ${where}`;
}

export function citationOfReference(
    cite: ThreadReference,
    source: Pick<WorkspaceSource, "title">
): string {
    return citationWithSource(cite.snippet, source, cite.page);
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
