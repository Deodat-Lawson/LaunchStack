/**
 * Reverses the HTML produced by LegalDocumentEditor `getSectionsAsHtml`:
 * `<h1>`, `<h2>`, `<p>` blocks in order → EditorSection[].
 */
export function parseLegalDocumentHtmlToSections(html) {
    const trimmed = html.trim();
    if (!trimmed) {
        return [];
    }
    const sections = [];
    const pattern = /<(h1|h2|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    let index = 0;
    while ((match = pattern.exec(trimmed)) !== null) {
        const tag = match[1].toLowerCase();
        const inner = match[2] ?? "";
        const id = `section-${index}`;
        if (tag === "h1") {
            sections.push({ id, type: "title", content: inner });
        }
        else if (tag === "h2") {
            sections.push({ id, type: "heading", content: inner });
        }
        else {
            sections.push({ id, type: "paragraph", content: inner });
        }
        index++;
    }
    if (sections.length === 0) {
        return [{ id: "section-0", type: "paragraph", content: trimmed }];
    }
    return sections;
}
//# sourceMappingURL=html-to-sections.js.map