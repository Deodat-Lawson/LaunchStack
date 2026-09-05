import type { EditorSection } from "./section-builders.js";
/**
 * Reverses the HTML produced by LegalDocumentEditor `getSectionsAsHtml`:
 * `<h1>`, `<h2>`, `<p>` blocks in order → EditorSection[].
 */
export declare function parseLegalDocumentHtmlToSections(html: string): EditorSection[];
//# sourceMappingURL=html-to-sections.d.ts.map