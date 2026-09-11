import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import {
    fromEdgeList,
    fromMarkdownOutline,
    fromMermaid,
    parseDoc,
    serializeDoc,
    toMarkdownOutline,
    toMermaid,
} from "../model/serialize";
import { graphIndex } from "../model/doc";
import { DOC_SCHEMA_VERSION, type MindmapDoc } from "../model/types";

function sampleDoc(): MindmapDoc {
    const root = createNode({ shape: "mind-root", x: 0, y: 0, text: "Product" });
    const a = createNode({ shape: "mind-branch", x: 250, y: -60, text: "Discovery" });
    const b = createNode({ shape: "mind-branch", x: 250, y: 60, text: "Build" });
    const a1 = createNode({ shape: "mind-branch", x: 500, y: -60, text: "Interviews" });
    return createDoc("Product plan", [
        {
            ...createPage("Page 1"),
            nodes: [root, a, b, a1],
            edges: [
                createEdge({ from: { nodeId: root.id }, to: { nodeId: a.id }, label: "first" }),
                createEdge({ from: { nodeId: root.id }, to: { nodeId: b.id } }),
                createEdge({ from: { nodeId: a.id }, to: { nodeId: a1.id } }),
            ],
        },
    ]);
}

describe("parseDoc", () => {
    it("round-trips a real document", () => {
        const doc = sampleDoc();
        const back = parseDoc(JSON.parse(serializeDoc(doc)) as unknown);
        expect(back.title).toBe(doc.title);
        expect(back.pages[0]!.nodes).toHaveLength(4);
        expect(back.pages[0]!.edges).toHaveLength(3);
        expect(back.pages[0]!.nodes[0]!.text).toBe("Product");
    });

    it("never throws on rubbish", () => {
        for (const input of [null, undefined, 42, "text", [], { pages: "nope" }]) {
            expect(() => parseDoc(input)).not.toThrow();
        }
        expect(parseDoc(null).pages).toHaveLength(1);
    });

    it("fills in missing style objects", () => {
        const doc = parseDoc({
            title: "Bare",
            pages: [{ id: "p", name: "P", nodes: [{ id: "n", shape: "rectangle" }], edges: [] }],
        });
        const node = doc.pages[0]!.nodes[0]!;
        expect(node.style.fill).toBeTruthy();
        expect(node.textStyle.size).toBeGreaterThan(0);
        expect(node.w).toBeGreaterThan(0);
    });

    it("drops nodes with no id rather than importing a broken one", () => {
        const doc = parseDoc({
            pages: [{ nodes: [{ shape: "rectangle" }, { id: "ok", shape: "rectangle" }] }],
        });
        expect(doc.pages[0]!.nodes.map(n => n.id)).toEqual(["ok"]);
    });

    it("falls back to a rectangle for an unknown shape", () => {
        const doc = parseDoc({
            pages: [{ nodes: [{ id: "n", shape: "wormhole" }] }],
        });
        expect(doc.pages[0]!.nodes[0]!.shape).toBe("rectangle");
    });

    it("repairs an activePageId that points nowhere", () => {
        const doc = parseDoc({ activePageId: "ghost", pages: [{ id: "real", nodes: [] }] });
        expect(doc.activePageId).toBe("real");
    });

    it("clamps opacity into range", () => {
        const doc = parseDoc({
            pages: [{ nodes: [{ id: "n", shape: "rectangle", style: { opacity: 40 } }] }],
        });
        expect(doc.pages[0]!.nodes[0]!.style.opacity).toBe(1);
    });

    it("stamps the current schema version", () => {
        expect(parseDoc({ schemaVersion: 0 }).schemaVersion).toBe(DOC_SCHEMA_VERSION);
    });

    it("keeps unknown node data instead of discarding it", () => {
        const doc = parseDoc({
            pages: [{ nodes: [{ id: "n", shape: "image", data: { src: "x", alt: "y" } }] }],
        });
        expect(doc.pages[0]!.nodes[0]!.data).toEqual({ src: "x", alt: "y" });
    });
});

describe("markdown outline", () => {
    it("renders the tree in depth-first order with indentation", () => {
        const md = toMarkdownOutline(sampleDoc());
        const lines = md.split("\n").filter(l => l.trim().startsWith("-"));
        expect(lines[0]).toBe("- Product");
        expect(lines[1]).toBe("  - Discovery");
        expect(lines[2]).toBe("    - Interviews");
        expect(lines[3]).toBe("  - Build");
    });

    it("includes the document title as a heading", () => {
        expect(toMarkdownOutline(sampleDoc()).startsWith("# Product plan")).toBe(true);
    });

    it("lists labelled connectors", () => {
        const md = toMarkdownOutline(sampleDoc());
        expect(md).toContain("**Connections**");
        expect(md).toContain("first");
    });

    it("emits every node even when the graph is a cycle", () => {
        const a = createNode({ shape: "rectangle", x: 0, y: 0, text: "A" });
        const b = createNode({ shape: "rectangle", x: 0, y: 0, text: "B" });
        const doc = createDoc("Cyclic", [
            {
                ...createPage(),
                nodes: [a, b],
                edges: [
                    createEdge({ from: { nodeId: a.id }, to: { nodeId: b.id } }),
                    createEdge({ from: { nodeId: b.id }, to: { nodeId: a.id } }),
                ],
            },
        ]);
        const md = toMarkdownOutline(doc);
        expect(md).toContain("- A");
        expect(md).toContain("- B");
    });

    it("labels untitled shapes rather than emitting a blank bullet", () => {
        const doc = createDoc("T", [
            { ...createPage(), nodes: [createNode({ shape: "rectangle", x: 0, y: 0 })], edges: [] },
        ]);
        expect(toMarkdownOutline(doc)).toContain("- (untitled)");
    });
});

describe("markdown outline import", () => {
    it("builds a tree from indentation", () => {
        const doc = fromMarkdownOutline(
            ["# Plan", "- Discovery", "  - Interviews", "  - Survey", "- Build"].join("\n")
        );
        expect(doc.title).toBe("Plan");
        const page = doc.pages[0]!;
        expect(page.nodes.map(n => n.text)).toEqual(["Discovery", "Interviews", "Survey", "Build"]);
        const idx = graphIndex(page);
        const discovery = page.nodes[0]!;
        expect(idx.out.get(discovery.id)).toHaveLength(2);
    });

    it("infers the indent width, so tabs and 4 spaces nest like 2 spaces", () => {
        for (const source of ["- Parent\n\t- Child", "- Parent\n    - Child"]) {
            const page = fromMarkdownOutline(source).pages[0]!;
            expect(page.nodes.map(n => n.text)).toEqual(["Parent", "Child"]);
            expect(page.edges).toHaveLength(1);
            expect(page.edges[0]!.from.nodeId).toBe(page.nodes[0]!.id);
        }
    });

    it("attaches an over-indented line to the deepest topic instead of dropping it", () => {
        const page = fromMarkdownOutline("- A\n  - B\n        - C").pages[0]!;
        expect(page.nodes.map(n => n.text)).toEqual(["A", "B", "C"]);
        expect(page.edges).toHaveLength(2);
    });

    it("ignores blank lines", () => {
        const doc = fromMarkdownOutline("- A\n\n\n- B");
        expect(doc.pages[0]!.nodes).toHaveLength(2);
    });

    it("survives an empty document", () => {
        const doc = fromMarkdownOutline("");
        expect(doc.pages[0]!.nodes).toHaveLength(0);
    });
});

describe("mermaid", () => {
    it("exports nodes and edges", () => {
        const mmd = toMermaid(sampleDoc());
        expect(mmd.startsWith("flowchart LR")).toBe(true);
        expect(mmd).toContain('"Product"');
        expect(mmd).toContain("-->");
    });

    it("escapes newlines and quotes in labels", () => {
        const doc = createDoc("T", [
            {
                ...createPage(),
                nodes: [createNode({ shape: "rectangle", x: 0, y: 0, text: 'a\nb "c"' })],
                edges: [],
            },
        ]);
        const mmd = toMermaid(doc);
        expect(mmd).toContain("a b 'c'");
        expect(mmd.split("\n")).toHaveLength(2);
    });

    it("re-imports its own output", () => {
        const original = sampleDoc();
        const imported = fromMermaid(toMermaid(original));
        const page = imported.pages[0]!;
        expect(page.nodes).toHaveLength(4);
        expect(page.edges).toHaveLength(3);
        expect(page.nodes.map(n => n.text).sort()).toEqual([
            "Build",
            "Discovery",
            "Interviews",
            "Product",
        ]);
    });

    it("imports shapes from the bracket syntax", () => {
        const doc = fromMermaid('flowchart LR\n  A{"Choose?"} --> B(["Done"])');
        const shapes = doc.pages[0]!.nodes.map(n => n.shape);
        expect(shapes).toContain("decision");
        expect(shapes).toContain("terminator");
    });

    it("imports edge labels", () => {
        const doc = fromMermaid('flowchart LR\n  A --> |"yes"| B');
        expect(doc.pages[0]!.edges[0]!.labels[0]!.text).toBe("yes");
    });

    it("skips directives it does not understand", () => {
        const doc = fromMermaid("flowchart TD\n  %% a comment\n  classDef x fill:#fff\n  A --> B");
        expect(doc.pages[0]!.nodes).toHaveLength(2);
    });
});

describe("edge-list import", () => {
    it("builds a graph from parent,child rows", () => {
        const doc = fromEdgeList("parent,child\nCEO,Eng\nCEO,Product\nEng,Platform");
        const page = doc.pages[0]!;
        expect(page.nodes.map(n => n.text).sort()).toEqual(["CEO", "Eng", "Platform", "Product"]);
        expect(page.edges).toHaveLength(3);
    });

    it("accepts tabs and semicolons", () => {
        expect(fromEdgeList("A\tB").pages[0]!.edges).toHaveLength(1);
        expect(fromEdgeList("A;B").pages[0]!.edges).toHaveLength(1);
    });

    it("reads an optional third column as the label", () => {
        const doc = fromEdgeList("A,B,reports to");
        expect(doc.pages[0]!.edges[0]!.labels[0]!.text).toBe("reports to");
    });

    it("ignores malformed rows", () => {
        expect(fromEdgeList("A\n\nB,").pages[0]!.edges).toHaveLength(0);
    });
});
