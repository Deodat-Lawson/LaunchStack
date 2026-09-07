import { describe, expect, it } from "vitest";

import { TextAdapter } from "../document-converter/converters/text-adapter";
import { chunkDocument, contextHeader, prepareForEmbedding, stripContextHeader } from "./chunker";
import { estimateCounter } from "./tokenizer";
import type { PageContent } from "./types";

/**
 * The chunker decides what an embedding, a lexical index, a reranker and a
 * citation all read, because they now read the same string. These pin the
 * properties that matters for: every chunk names where it came from, a
 * branch stays with its leaves, and no line is ever cut in half.
 */

const CFG = { parentMaxTokens: 200, childMaxTokens: 60, overlapTokens: 10 };

function outline(lines: number, prefix = "Item"): string {
    return Array.from({ length: lines }, (_, i) => `- ${prefix} ${i + 1} with a few words`).join(
        "\n"
    );
}

function page(text: string, pageNumber = 1): PageContent {
    return { pageNumber, textBlocks: [text], tables: [] };
}

describe("contextHeader", () => {
    it("joins the document title and ancestors into a breadcrumb", () => {
        expect(
            contextHeader({
                pageNumber: 1,
                chunkIndex: 0,
                totalChunksInPage: 1,
                isTable: false,
                documentTitle: "Q3 plan",
                ancestors: ["Infrastructure", "Databases"],
            })
        ).toBe("Q3 plan › Infrastructure › Databases");
    });

    it("drops a step already on the path", () => {
        // An outline that restates its own title under every branch.
        expect(
            contextHeader({
                pageNumber: 1,
                chunkIndex: 0,
                totalChunksInPage: 1,
                isTable: false,
                documentTitle: "Q3 plan",
                ancestors: ["Billing", "Q3 plan"],
            })
        ).toBe("Q3 plan › Billing");
    });

    it("is null when there is nothing to say", () => {
        expect(
            contextHeader({ pageNumber: 1, chunkIndex: 0, totalChunksInPage: 1, isTable: false })
        ).toBeNull();
    });
});

describe("chunkDocument", () => {
    it("stores the breadcrumb in the chunk, not only in the embedding", async () => {
        const text = "# Plan\n\n## Infrastructure\n\n- Postgres 16 with read replicas\n";
        const chunks = await chunkDocument([page(text)], { ...CFG, documentTitle: "Plan" });
        const child = chunks[0]!.children![0]!;

        // The stored text carries it, so BM25 and the model see it too.
        expect(child.content).toBe("Plan › Infrastructure\n\n- Postgres 16 with read replicas");
        // And what is embedded is exactly what is stored.
        expect(prepareForEmbedding(chunks)[0]).toBe(child.content);
        // The body is recoverable for a citation that wants only the quote.
        expect(stripContextHeader(child.content, child.metadata)).toBe(
            "- Postgres 16 with read replicas"
        );
    });

    it("records ancestors as an array, not only a joined string", async () => {
        const text = "# Plan\n\n## Billing\n\n- Stripe subscriptions\n";
        const chunks = await chunkDocument([page(text)], { ...CFG, documentTitle: "Plan" });
        const child = chunks[0]!.children![0]!;
        // Every enclosing heading, outermost first — the H1 included.
        expect(child.metadata.ancestors).toEqual(["Plan", "Billing"]);
        // The title repeats the H1, so the breadcrumb says it once.
        expect(child.metadata.contextHeader).toBe("Plan › Billing");
    });

    it("keeps a branch with its leaves when the branch fits one chunk", async () => {
        const text = [
            "# Plan",
            "",
            "- Infrastructure",
            "  - Postgres 16 with read replicas",
            "  - Redis for session cache",
            "- Billing",
            "  - Stripe subscriptions",
        ].join("\n");
        // A budget too small for both branches, so they cannot merge and the
        // question is only whether each branch survived intact.
        const chunks = await chunkDocument([page(text)], {
            ...CFG,
            childMaxTokens: 22,
            documentTitle: "Plan",
        });
        const children = chunks.flatMap(c => c.children ?? []);

        const infra = children.find(c => c.content.includes("Postgres"))!;
        // The whole branch travelled together rather than being cut by size.
        expect(infra.content).toContain("- Infrastructure");
        expect(infra.content).toContain("Redis for session cache");
        expect(infra.content).not.toContain("Stripe");
    });

    it("merges small sibling branches rather than emitting a chunk each", async () => {
        const text = [
            "# Plan",
            "",
            "- Infrastructure",
            "  - Postgres 16",
            "- Billing",
            "  - Stripe",
        ].join("\n");
        const chunks = await chunkDocument([page(text)], { ...CFG, documentTitle: "Plan" });
        const children = chunks.flatMap(c => c.children ?? []);
        // Two tiny neighbours under one parent are one chunk, not two.
        expect(children).toHaveLength(1);
        expect(children[0]!.content).toContain("Postgres");
        expect(children[0]!.content).toContain("Stripe");
    });

    it("enters a branch too large for one chunk, naming it as an ancestor", async () => {
        const text = `# Plan\n\n- Infrastructure\n${Array.from(
            { length: 40 },
            (_, i) => `  - Server ${i + 1} with several words of description`
        ).join("\n")}`;
        const chunks = await chunkDocument([page(text)], { ...CFG, documentTitle: "Plan" });
        const children = chunks.flatMap(c => c.children ?? []);

        expect(children.length).toBeGreaterThan(1);
        for (const child of children) {
            // No leaf lost the branch it belongs to.
            expect(child.metadata.ancestors).toContain("Infrastructure");
            expect(child.content.startsWith("Plan › Infrastructure\n\n")).toBe(true);
        }
    });

    it("keeps the heading path across a page boundary", async () => {
        // The adapter cuts at 4,000 characters; the tree is built over the
        // whole document, so the heading stack cannot reset mid-way.
        const branches = ["Infrastructure", "Billing", "Go-to-market", "Risks", "Hiring"];
        let md = "# Platform plan\n\n";
        for (const b of branches) {
            md += `## ${b}\n\n`;
            md += `${outline(22, `${b} item`)}\n\n`;
        }
        const doc = await new TextAdapter().process(Buffer.from(md), {
            mimeType: "text/markdown",
            filename: "plan.md",
        });
        expect(doc.pages.length).toBeGreaterThan(1);

        const chunks = await chunkDocument(
            doc.pages.map(p => ({
                pageNumber: p.pageNumber,
                textBlocks: p.textBlocks,
                tables: [],
            })),
            { ...CFG, documentTitle: "Platform plan" }
        );
        const embedded = prepareForEmbedding(chunks);
        expect(embedded.length).toBeGreaterThan(4);
        for (const text of embedded) {
            expect(text.startsWith("Platform plan › ")).toBe(true);
        }
        // Every branch is represented, including those after the boundary.
        for (const b of branches) {
            expect(embedded.some(t => t.startsWith(`Platform plan › ${b}`))).toBe(true);
        }
    });

    it("cuts between lines, never inside one", async () => {
        const chunks = await chunkDocument([page(`# Plan\n\n${outline(120)}`)], CFG);
        for (const child of chunks.flatMap(c => c.children ?? [])) {
            for (const line of stripContextHeader(child.content, child.metadata).split("\n")) {
                if (line.trim() === "") continue;
                expect(line).toMatch(/^- Item \d+ with a few words$/);
            }
        }
    });

    it("still cuts prose at sentence ends", async () => {
        const sentence = "The quarterly review covered revenue, churn and the hiring plan. ";
        const chunks = await chunkDocument([page(sentence.repeat(60))], CFG);
        const children = chunks.flatMap(c => c.children ?? []);
        expect(children.length).toBeGreaterThan(2);
        for (const child of children) {
            expect(stripContextHeader(child.content, child.metadata).trimEnd()).toMatch(/\.$/);
        }
    });

    it("respects the token budget with the counter it was given", async () => {
        const tokens = estimateCounter(4);
        const chunks = await chunkDocument([page(`# Plan\n\n${outline(200)}`)], {
            ...CFG,
            tokens,
            documentTitle: "Plan",
        });
        for (const child of chunks.flatMap(c => c.children ?? [])) {
            expect(child.metadata.tokenCount).toBeDefined();
            expect(child.metadata.tokenCounterId).toBe("estimate:4");
            // The breadcrumb is part of the stored text, so the budget is
            // checked against the body it was measured on.
            const body = stripContextHeader(child.content, child.metadata);
            expect(tokens.count(body)).toBeLessThanOrEqual(CFG.childMaxTokens);
        }
    });

    it("a parent's content is exactly its children joined", async () => {
        const chunks = await chunkDocument([page(`# Plan\n\n${outline(60)}`)], {
            ...CFG,
            documentTitle: "Plan",
        });
        for (const parent of chunks) {
            const bodies = (parent.children ?? []).map(c =>
                stripContextHeader(c.content, c.metadata)
            );
            expect(stripContextHeader(parent.content, parent.metadata)).toBe(bodies.join("\n"));
        }
    });

    it("emits no empty or whitespace-only chunk", async () => {
        const text = "# Plan\n\n\n\n## Empty section\n\n\n\n## Real\n\n- Something here\n";
        const chunks = await chunkDocument([page(text)], { ...CFG, documentTitle: "Plan" });
        for (const chunk of [...chunks, ...chunks.flatMap(c => c.children ?? [])]) {
            expect(stripContextHeader(chunk.content, chunk.metadata).trim().length).toBeGreaterThan(
                0
            );
        }
    });

    it("leaves a fenced code block whole", async () => {
        const text = [
            "# Guide",
            "",
            "## Setup",
            "",
            "```bash",
            "pnpm install",
            "# a comment that looks like a heading",
            "pnpm dev",
            "```",
        ].join("\n");
        const chunks = await chunkDocument([page(text)], { ...CFG, documentTitle: "Guide" });
        const all = chunks.flatMap(c => c.children ?? []);
        const code = all.find(c => c.content.includes("pnpm install"))!;
        expect(code.content).toContain("pnpm dev");
        // The comment inside the fence did not become a heading.
        expect(code.metadata.ancestors).toEqual(["Guide", "Setup"]);
    });
});
