import { chunkDocument, prepareForEmbedding } from "@launchstack/conversion/ocr/chunker";

import { toMarkdownOutline } from "~/app/employer/documents/_mindmap/model/serialize";
import { buildTemplate, TEMPLATE_BY_ID } from "~/app/employer/documents/_mindmap/model/templates";
import type { MindmapDoc } from "~/app/employer/documents/_mindmap/model/types";
import { LAUNCH_PLAN, treeDoc, type Tree } from "./mindmap-fixtures";

/**
 * What the retrieval layer sees of a published mindmap, without a model in
 * the loop: the outline the publish route renders, run through the real
 * chunker and the real "prepare for embedding" step. These pin the shape of
 * the text that gets embedded — every label present, the map's title on
 * every chunk, no line cut in half — so the embedding-quality eval (which
 * needs an API key) is measuring the pipeline, not a fixture.
 */

// The publish route chunks with the pipeline's defaults (chunkPages).
const PIPELINE_CHUNKING = {
    parentMaxTokens: 1000,
    childMaxTokens: 256,
    overlapTokens: 50,
    includePageContext: true,
};

async function embeddedStrings(doc: MindmapDoc, sections: boolean): Promise<string[]> {
    const markdown = toMarkdownOutline(doc, { sections });
    const chunks = await chunkDocument(
        [{ pageNumber: 1, textBlocks: [markdown], tables: [] }],
        PIPELINE_CHUNKING
    );
    return prepareForEmbedding(chunks);
}

function labelsOf(doc: MindmapDoc): string[] {
    return doc.pages.flatMap(p => p.nodes.map(n => n.text.trim()).filter(Boolean));
}

describe("a published mindmap, as the embedder sees it", () => {
    it("keeps every node label in at least one embedded string", async () => {
        const doc = treeDoc("Q3 launch plan", LAUNCH_PLAN);
        for (const sections of [false, true]) {
            const strings = await embeddedStrings(doc, sections);
            for (const label of labelsOf(doc)) {
                expect(strings.some(s => s.includes(label))).toBe(true);
            }
        }
    });

    it("prefixes every chunk with the map's title, so a chunk always says which map it is", async () => {
        const doc = treeDoc("Q3 launch plan", LAUNCH_PLAN);
        for (const sections of [false, true]) {
            for (const text of await embeddedStrings(doc, sections)) {
                expect(text).toMatch(/^Section: Q3 launch plan/);
            }
        }
    });

    it("with sections on, a chunk also says which branch it came from", async () => {
        const doc = treeDoc("Q3 launch plan", LAUNCH_PLAN);
        const strings = await embeddedStrings(doc, true);
        const branches = ["Infrastructure", "Billing", "Go-to-market", "Risks"];
        for (const branch of branches) {
            const own = strings.filter(s => s.startsWith(`Section: Q3 launch plan > ${branch}`));
            expect(own.length).toBeGreaterThan(0);
            // The root topic leads every branch section so the central idea is
            // never separated from its children.
            for (const s of own) expect(s).toContain("- Q3 launch plan");
        }
        // Nothing from one branch is filed under another.
        const billing = strings.filter(s => s.startsWith("Section: Q3 launch plan > Billing"));
        expect(billing.join("\n")).not.toContain("Kubernetes");
    });

    it("never cuts an outline line in half, even for a map far larger than one chunk", async () => {
        const big: Tree = {};
        for (let b = 0; b < 12; b++) {
            const leaves: Tree = {};
            for (let l = 0; l < 25; l++) leaves[`Branch ${b} item ${l} with several words`] = null;
            big[`Branch ${b}`] = leaves;
        }
        const doc = treeDoc("Big map", { "Big map": big });
        for (const sections of [false, true]) {
            const strings = await embeddedStrings(doc, sections);
            expect(strings.length).toBeGreaterThan(3);
            for (const text of strings) {
                const body = text.split("\nContent: ")[1] ?? text;
                for (const line of body.split("\n")) {
                    if (line.trim() === "") continue;
                    expect(line).toMatch(
                        /^\s*- (Big map|Branch \d+( item \d+ with several words)?)$/
                    );
                }
            }
        }
    });

    it("keeps a chunk within the child budget the pipeline embeds with", async () => {
        const doc = treeDoc("Q3 launch plan", LAUNCH_PLAN);
        const limit = PIPELINE_CHUNKING.childMaxTokens * 4;
        for (const text of await embeddedStrings(doc, true)) {
            const body = text.split("\nContent: ")[1] ?? text;
            expect(body.length).toBeLessThanOrEqual(limit + 4);
        }
    });

    it("renders every starter template to an outline with its labels intact", async () => {
        for (const id of Object.keys(TEMPLATE_BY_ID)) {
            if (id === "blank") continue;
            const doc = buildTemplate(id, `Template ${id}`);
            const strings = await embeddedStrings(doc, true);
            const labels = labelsOf(doc).map(l => l.replace(/\n+/g, " "));
            for (const label of labels) {
                expect(strings.some(s => s.includes(label))).toBe(true);
            }
        }
    });

    it("keeps the download export as one outline, without section headings", () => {
        const doc = treeDoc("Q3 launch plan", LAUNCH_PLAN);
        const plain = toMarkdownOutline(doc);
        expect(plain).toMatch(/^# Q3 launch plan\n\n- Q3 launch plan\n  - Infrastructure\n/);
        expect(plain).not.toContain("\n## ");
    });
});
