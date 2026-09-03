import { describe, expect, it } from "vitest";

import { chunkDocument, prepareForEmbedding } from "./chunker";

/**
 * The chunker decides what an embedding ever sees. Two properties matter for
 * line-structured sources (outlines, lists, transcripts): a line is never cut
 * in half, and every chunk carries the heading path it came from.
 */

function outline(lines: number, prefix = "Item"): string {
    return Array.from({ length: lines }, (_, i) => `- ${prefix} ${i + 1} with a few words`).join(
        "\n"
    );
}

describe("chunkDocument on line-structured text", () => {
    it("cuts between lines, never inside one", async () => {
        const text = `# Plan\n\n${outline(120)}`;
        const chunks = await chunkDocument([{ pageNumber: 1, textBlocks: [text], tables: [] }], {
            parentMaxTokens: 200,
            childMaxTokens: 60,
            overlapTokens: 10,
        });
        const children = chunks.flatMap(c => c.children ?? []);
        expect(children.length).toBeGreaterThan(3);
        for (const child of children) {
            for (const line of child.content.split("\n")) {
                // A whole line, or the overlap re-starting at a line head.
                expect(line).toMatch(/^(- Item \d+ with a few words|)$/);
            }
        }
    });

    it("stamps every child with the heading path so context survives the cut", async () => {
        const text = `# Plan\n\n## Infrastructure\n\n${outline(60, "Server")}\n\n## Billing\n\n${outline(60, "Invoice")}`;
        const chunks = await chunkDocument([{ pageNumber: 1, textBlocks: [text], tables: [] }], {
            parentMaxTokens: 200,
            childMaxTokens: 60,
            overlapTokens: 10,
        });
        const embedded = prepareForEmbedding(chunks);
        expect(embedded.length).toBeGreaterThan(2);
        for (const text of embedded) {
            expect(text).toMatch(/^Section: Plan > (Infrastructure|Billing)\nContent: /);
        }
        // Nothing from one section is filed under the other.
        for (const text of embedded) {
            if (text.startsWith("Section: Plan > Infrastructure")) {
                expect(text).not.toContain("Invoice");
            }
            if (text.startsWith("Section: Plan > Billing")) {
                expect(text).not.toContain("Server");
            }
        }
    });

    it("still cuts prose at sentence ends", async () => {
        const sentence = "The quarterly review covered revenue, churn and the hiring plan. ";
        const text = sentence.repeat(60);
        const chunks = await chunkDocument([{ pageNumber: 1, textBlocks: [text], tables: [] }], {
            parentMaxTokens: 200,
            childMaxTokens: 60,
            overlapTokens: 10,
        });
        const children = chunks.flatMap(c => c.children ?? []);
        expect(children.length).toBeGreaterThan(2);
        for (const child of children) {
            expect(child.content.trimEnd()).toMatch(/\.$/);
        }
    });
});
