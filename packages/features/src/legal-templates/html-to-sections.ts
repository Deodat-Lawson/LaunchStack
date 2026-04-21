import type { EditorSection } from "./section-builders";

/**
 * Reverses the HTML produced by LegalDocumentEditor `getSectionsAsHtml`:
 * `<h1>`, `<h2>`, `<p>` blocks in order → EditorSection[].
 */
export function parseLegalDocumentHtmlToSections(html: string): EditorSection[] {
  const trimmed = html.trim();
  if (!trimmed) {
    return [];
  }

  const sections: EditorSection[] = [];
  const pattern = /<(h1|h2|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(trimmed)) !== null) {
    const tag = match[1]!.toLowerCase();
    const inner = match[2] ?? "";
    const id = `section-${index}`;
    if (tag === "h1") {
      sections.push({ id, type: "title", content: inner });
    } else if (tag === "h2") {
      sections.push({ id, type: "heading", content: inner });
    } else {
      sections.push({ id, type: "paragraph", content: inner });
    }
    index++;
  }

  if (sections.length === 0) {
    return [{ id: "section-0", type: "paragraph", content: trimmed }];
  }

  return sections;
}
