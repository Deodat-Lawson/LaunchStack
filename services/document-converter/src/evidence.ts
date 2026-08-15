/**
 * Map docling-serve markdown into an EvidenceDocument
 * (packages/protocol/schemas/v1/evidence-document.schema.json).
 *
 * Honesty rules (ADR-004):
 * - Pages split ONLY on explicit page-break markers (form-feed,
 *   `<!-- page break -->`). The old worker also split on `---`, mislabeling
 *   thematic breaks and frontmatter fences as page boundaries — so page
 *   numbers sent downstream were fabricated. Without real markers we emit
 *   ONE page and say so in `warnings`.
 * - `confidence` is OMITTED: docling-serve reports none. The old hardcoded
 *   confidenceScore=92.0 must not reappear anywhere.
 */
import type { EvidenceDocument, EvidencePage, LayoutBlock } from "./contracts.js";

export const NO_PAGE_BOUNDARIES_WARNING =
    "provider returned no page boundaries; page anchors are document-level";

/**
 * The exact marker docling-serve is asked to emit between pages
 * (`md_page_break_placeholder` in docling.ts). PAGE_BREAK below must always
 * match it — that round trip is what turns docling output into real pages.
 */
export const PAGE_BREAK_PLACEHOLDER = "<!-- page break -->";

/** Explicit page-break markers ONLY — never `---`. */
const PAGE_BREAK = /\f|<!--\s*page\s*break\s*-->/gi;

function isTableRow(line: string): boolean {
    const s = line.trim();
    return s.length > 1 && s.startsWith("|") && s.endsWith("|");
}

/**
 * Simple, honest markdown structure: pipe tables become `table` blocks
 * (text = the table's markdown), heading lines become `heading` blocks,
 * everything else becomes `paragraph` blocks split at blank lines.
 */
export function parseBlocks(text: string): LayoutBlock[] {
    const blocks: LayoutBlock[] = [];
    let paragraph: string[] = [];
    let table: string[] = [];

    const flushParagraph = () => {
        if (paragraph.length > 0) {
            blocks.push({ type: "paragraph", text: paragraph.join("\n") });
            paragraph = [];
        }
    };
    const flushTable = () => {
        if (table.length > 0) {
            blocks.push({ type: "table", text: table.join("\n") });
            table = [];
        }
    };

    for (const line of text.split("\n")) {
        if (isTableRow(line)) {
            flushParagraph();
            table.push(line.trim());
            continue;
        }
        flushTable();

        const stripped = line.trim();
        if (stripped === "") {
            flushParagraph();
            continue;
        }
        const headingMatch = /^(#{1,6})\s+(.*)$/.exec(stripped);
        if (headingMatch) {
            flushParagraph();
            blocks.push({ type: "heading", text: headingMatch[2].trim() });
            continue;
        }
        paragraph.push(stripped);
    }

    flushTable();
    flushParagraph();
    return blocks;
}

export interface EvidenceSource {
    filename?: string;
    mimeType?: string;
}

export function markdownToEvidenceDocument(
    markdown: string,
    source: EvidenceSource
): EvidenceDocument {
    const rawChunks = markdown.split(PAGE_BREAK);
    const hasBoundaries = rawChunks.length > 1;
    const warnings: string[] = [];

    let pageTexts: string[];
    if (hasBoundaries) {
        pageTexts = rawChunks.map(chunk => chunk.trim());
        // A marker at the very start/end produces empty edge chunks, not pages.
        while (pageTexts.length > 1 && pageTexts[0] === "") pageTexts.shift();
        while (pageTexts.length > 1 && pageTexts[pageTexts.length - 1] === "") {
            pageTexts.pop();
        }
    } else {
        pageTexts = [markdown.trim()];
        warnings.push(NO_PAGE_BOUNDARIES_WARNING);
    }

    const pages: EvidencePage[] = pageTexts.map((text, index) => {
        const blocks = parseBlocks(text);
        return {
            pageNumber: index + 1,
            text,
            ...(blocks.length > 0 ? { blocks } : {}),
        };
    });

    return {
        schemaVersion: 1,
        provider: "docling",
        source: {
            ...(source.filename ? { filename: source.filename } : {}),
            ...(source.mimeType ? { mimeType: source.mimeType } : {}),
            // pageCount only when the provider gave real boundaries — a count of
            // "1" for an unpaginated blob would be a fabrication.
            ...(hasBoundaries ? { pageCount: pages.length } : {}),
        },
        // NOTE: no `confidence` — docling-serve does not report one.
        pages,
        markdown,
        warnings,
    };
}
