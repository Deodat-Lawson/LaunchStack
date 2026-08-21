import { pageBounds } from "../model/doc";
import { SHAPE_BY_ID } from "../model/shapes";
import { TEMPLATE_META } from "../model/template-meta";
import {
    TEMPLATES,
    TEMPLATE_BY_ID,
    TEMPLATE_CATEGORIES,
    buildTemplate,
    buildersMissingMetadata,
    templatesMissingBuilders,
} from "../model/templates";
import { parseDoc, serializeDoc, toMarkdownOutline } from "../model/serialize";

describe("metadata and builders stay in step", () => {
    it("gives every listed template a builder", () => {
        expect(templatesMissingBuilders()).toEqual([]);
    });

    it("has no builder the UI cannot reach", () => {
        expect(buildersMissingMetadata()).toEqual([]);
    });

    it("exposes the same ids from both modules", () => {
        expect(TEMPLATES.map(t => t.id)).toEqual(TEMPLATE_META.map(t => t.id));
    });
});

describe("template registry", () => {
    it("has unique ids and a blank starter", () => {
        const ids = TEMPLATES.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain("blank");
        expect(ids).toContain("mindmap");
    });

    it("puts every template in a listed category", () => {
        for (const template of TEMPLATES) {
            expect(TEMPLATE_CATEGORIES).toContain(template.category);
        }
    });

    it("indexes by id", () => {
        for (const template of TEMPLATES) {
            expect(TEMPLATE_BY_ID[template.id]).toBe(template);
        }
    });

    it("falls back to blank for an unknown id", () => {
        expect(buildTemplate("nope").pages[0]!.nodes).toHaveLength(0);
    });
});

describe("every template builds a valid document", () => {
    it.each(TEMPLATES.map(t => [t.id, t.name] as const))("%s (%s)", id => {
        const doc = buildTemplate(id, "Test title");

        expect(doc.title).toBe("Test title");
        expect(doc.pages.length).toBeGreaterThan(0);
        expect(doc.pages.some(p => p.id === doc.activePageId)).toBe(true);

        for (const page of doc.pages) {
            const nodeIds = new Set(page.nodes.map(n => n.id));
            expect(nodeIds.size).toBe(page.nodes.length);

            for (const node of page.nodes) {
                expect(SHAPE_BY_ID[node.shape]).toBeDefined();
                expect(Number.isFinite(node.x)).toBe(true);
                expect(Number.isFinite(node.y)).toBe(true);
                expect(node.w).toBeGreaterThan(0);
                expect(node.h).toBeGreaterThan(0);
                expect(node.style.opacity).toBeGreaterThan(0);
            }

            // Every connector points at shapes that exist on the same page.
            for (const edge of page.edges) {
                if (edge.from.nodeId) expect(nodeIds.has(edge.from.nodeId)).toBe(true);
                if (edge.to.nodeId) expect(nodeIds.has(edge.to.nodeId)).toBe(true);
            }
        }
    });

    it.each(TEMPLATES.filter(t => t.id !== "blank").map(t => [t.id] as const))(
        "%s produces visible content",
        id => {
            const doc = buildTemplate(id);
            const bounds = pageBounds(doc.pages[0]!);
            expect(bounds).not.toBeNull();
            expect(bounds!.w).toBeGreaterThan(0);
            expect(bounds!.h).toBeGreaterThan(0);
        }
    );

    it.each(TEMPLATES.map(t => [t.id] as const))("%s survives a save/load round trip", id => {
        const doc = buildTemplate(id);
        const back = parseDoc(JSON.parse(serializeDoc(doc)) as unknown);
        expect(back.pages[0]!.nodes).toHaveLength(doc.pages[0]!.nodes.length);
        expect(back.pages[0]!.edges).toHaveLength(doc.pages[0]!.edges.length);
    });

    it.each(TEMPLATES.map(t => [t.id] as const))("%s exports readable markdown", id => {
        const md = toMarkdownOutline(buildTemplate(id, "Doc"));
        expect(md.startsWith("# Doc")).toBe(true);
        expect(md).not.toContain("undefined");
    });
});

describe("laid-out templates", () => {
    it("tidies the mindmap so no two topics sit on top of each other", () => {
        const page = buildTemplate("mindmap").pages[0]!;
        for (let i = 0; i < page.nodes.length; i++) {
            for (let j = i + 1; j < page.nodes.length; j++) {
                const a = page.nodes[i]!;
                const b = page.nodes[j]!;
                const overlaps =
                    a.x < b.x + b.w - 1 &&
                    b.x < a.x + a.w - 1 &&
                    a.y < b.y + b.h - 1 &&
                    b.y < a.y + a.h - 1;
                expect({ pair: `${a.text}/${b.text}`, overlaps }).toEqual({
                    pair: `${a.text}/${b.text}`,
                    overlaps: false,
                });
            }
        }
    });

    it("fans the mindmap's first level to both sides of the root", () => {
        const page = buildTemplate("mindmap").pages[0]!;
        const root = page.nodes.find(n => n.shape === "mind-root")!;
        const firstLevel = page.edges
            .filter(e => e.from.nodeId === root.id)
            .map(e => page.nodes.find(n => n.id === e.to.nodeId)!);
        const sides = new Set(firstLevel.map(n => Math.sign(n.x - root.x)));
        expect(sides.size).toBe(2);
    });

    it("gives the org chart a top-down shape", () => {
        const page = buildTemplate("org-chart").pages[0]!;
        const ceo = page.nodes[0]!;
        const reports = page.edges
            .filter(e => e.from.nodeId === ceo.id)
            .map(e => page.nodes.find(n => n.id === e.to.nodeId)!);
        expect(reports.length).toBeGreaterThan(0);
        for (const report of reports) expect(report.y).toBeGreaterThan(ceo.y);
    });
});
