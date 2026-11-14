/**
 * Where Extract sends people outside its own tab. Both are site links the
 * workspace opens without leaving the page (`ToolLink` hands them over).
 */

/**
 * A document's tab in the workspace. With a cell's `quote` (and `page`), the
 * workspace opens the document at that passage and highlights it, the way a
 * chat citation does (`&find=` / `&page=` on the shell's `?source=`).
 */
export function sourceHref(
    sourceId: string,
    at?: { quote?: string | null; page?: number | null }
): string {
    const params = new URLSearchParams({ source: sourceId });
    if (at?.quote) {
        params.set("find", at.quote);
        if (at.page) params.set("page", String(at.page));
    }
    return `/employer/documents?${params.toString()}`;
}

/** The chat, with `prompt` in the composer for the person to finish. */
export function askHref(prompt: string): string {
    return `/employer/documents?ask=${encodeURIComponent(prompt)}`;
}
