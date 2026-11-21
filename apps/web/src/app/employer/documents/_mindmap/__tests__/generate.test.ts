import { activePage, graphIndex, isMindmapPage, topicParent } from "../model/doc";
import { buildDiagram, DiagramSpecError, parseOutline } from "../model/generate";
import { FRAME_PAPER, themeMode } from "../model/palette";
import { parseDoc } from "../model/serialize";

/**
 * What the AI tools hand the editor: a document built by the editor's own
 * factories, theme and layouts from an outline or a Mermaid flowchart —
 * indistinguishable in kind from a map someone drew.
 */

describe("parseOutline", () => {
    test("nests by indentation, bullets or not, two or four spaces or tabs", () => {
        for (const text of [
            "- A\n  - B\n    - C\n  - D",
            "A\n    B\n        C\n    D",
            "* A\n\t* B\n\t\t* C\n\t* D",
            "1. A\n   1. B\n      1. C\n   2. D",
        ]) {
            const [a] = parseOutline(text);
            expect(a!.text).toBe("A");
            expect(a!.children.map(c => c.text)).toEqual(["B", "D"]);
            expect(a!.children[0]!.children.map(c => c.text)).toEqual(["C"]);
        }
    });

    test("reads Markdown headings as levels", () => {
        const [root] = parseOutline("# Plan\n## Product\n- Beta\n## Sales");
        expect(root!.text).toBe("Plan");
        expect(root!.children.map(c => c.text)).toEqual(["Product", "Sales"]);
    });

    test("hangs bullets from the plain title line above them", () => {
        const roots = parseOutline("Q3 launch\n- Product\n  - Beta\n- Sales");
        expect(roots).toHaveLength(1);
        expect(roots[0]!.text).toBe("Q3 launch");
        expect(roots[0]!.children.map(c => c.text)).toEqual(["Product", "Sales"]);
        expect(roots[0]!.children[0]!.children.map(c => c.text)).toEqual(["Beta"]);
        // The same with the bullets indented one step under the title.
        const [indented] = parseOutline("Q3 launch\n  - Product\n    - Beta\n  - Sales");
        expect(indented!.children.map(c => c.text)).toEqual(["Product", "Sales"]);
        expect(indented!.children[0]!.children.map(c => c.text)).toEqual(["Beta"]);
    });

    test("reads Mermaid's mindmap syntax, brackets dropped", () => {
        const [root] = parseOutline("mindmap\n  root((Launch))\n    Product\n    id[Marketing]");
        expect(root!.text).toBe("Launch");
        expect(root!.children.map(c => c.text)).toEqual(["Product", "Marketing"]);
    });

    test("drops markup from labels and hangs a skipped level from the deepest topic", () => {
        const [root] = parseOutline("- **Bold** `code` [link](http://x)\n      - Deep");
        expect(root!.text).toBe("Bold code link");
        expect(root!.children[0]!.text).toBe("Deep");
    });
});

describe("buildDiagram", () => {
    const outline =
        "- Launch\n  - Product\n    - Beta\n      - Invite list\n  - Marketing\n  - Sales";

    test("a mind map is topics: a centre, branches, and leaves at the fourth level", () => {
        const doc = buildDiagram({ title: "Launch", type: "mindmap", outline }, { mode: "light" });
        const page = activePage(doc);
        expect(isMindmapPage(page)).toBe(true);
        const shape = (text: string) => page.nodes.find(n => n.text === text)!.shape;
        expect(shape("Launch")).toBe("mind-root");
        expect(shape("Product")).toBe("mind-branch");
        expect(shape("Invite list")).toBe("mind-leaf");
        expect(doc.settings).toMatchObject({ kind: "mindmap", autoLayout: { kind: "mindmap" } });
        // Every topic but the centre hangs from the right parent.
        const id = (text: string) => page.nodes.find(n => n.text === text)!.id;
        expect(topicParent(page, id("Beta"))).toBe(id("Product"));
        expect(topicParent(page, id("Sales"))).toBe(id("Launch"));
    });

    test("is drawn in the creator's lighting and survives the trust boundary unchanged", () => {
        const dark = buildDiagram({ title: "L", type: "mindmap", outline }, { mode: "dark" });
        expect(themeMode(dark.settings.paletteId)).toBe("dark");
        expect(activePage(dark).background.color).not.toBe(
            activePage(buildDiagram({ title: "L", type: "mindmap", outline }, { mode: "light" }))
                .background.color
        );
        expect(parseDoc(JSON.parse(JSON.stringify(dark)))).toEqual(dark);
    });

    test("a mind map spreads branches to both sides; an org chart grows down; a tree grows right", () => {
        const map = activePage(buildDiagram({ title: "L", type: "mindmap", outline }));
        const centre = map.nodes.find(n => n.shape === "mind-root")!;
        const branches = map.nodes.filter(n => topicParent(map, n.id) === centre.id);
        expect(branches.some(b => b.x < centre.x)).toBe(true);
        expect(branches.some(b => b.x > centre.x)).toBe(true);

        const org = activePage(
            buildDiagram({ title: "Team", type: "org_chart", outline: "CEO\n  CTO\n  CFO" })
        );
        const ceo = org.nodes.find(n => n.text === "CEO")!;
        for (const n of org.nodes.filter(n => n.text !== "CEO")) expect(n.y).toBeGreaterThan(ceo.y);
        // Boxes all the way down in rows: no underlined leaves.
        expect(org.nodes.every(n => n.shape !== "mind-leaf")).toBe(true);

        const tree = activePage(
            buildDiagram({ title: "T", type: "tree", outline: "Root\n  A\n  B" })
        );
        const root = tree.nodes.find(n => n.text === "Root")!;
        for (const n of tree.nodes.filter(n => n.text !== "Root"))
            expect(n.x).toBeGreaterThan(root.x);
    });

    test("never repeats its own title as a branch", () => {
        const page = activePage(
            buildDiagram({
                title: "GTM plan",
                type: "mindmap",
                outline: "- GTM plan\n- Pricing\n- Channels",
            })
        );
        expect(page.nodes.map(n => n.text).filter(t => t === "GTM plan")).toHaveLength(1);
    });

    test("an outline with several top lines takes the title as its centre", () => {
        const page = activePage(
            buildDiagram({ title: "Q3", type: "mindmap", outline: "- A\n- B\n- C" })
        );
        const roots = page.nodes.filter(n => topicParent(page, n.id) === null);
        expect(roots.map(n => n.text)).toEqual(["Q3"]);
        expect(graphIndex(page).out.get(roots[0]!.id)).toHaveLength(3);
    });

    test("a flowchart is laid out from Mermaid and painted by the theme", () => {
        const doc = buildDiagram({
            title: "Refunds",
            type: "flowchart",
            mermaid:
                "flowchart TD\n A([Request]) --> B{Within 30 days?}\n B -->|yes| C[Refund]\n B -->|no| D[Store credit]",
        });
        const page = activePage(doc);
        expect(page.nodes).toHaveLength(4);
        expect(doc.settings.kind).toBe("flowchart");
        expect(doc.title).toBe("Refunds");
        expect(doc.settings.paletteId).toBeTruthy();
    });

    test("says what is wrong with a spec it cannot draw", () => {
        expect(() => buildDiagram({ title: "x", type: "mindmap", outline: "  " })).toThrow(
            DiagramSpecError
        );
        expect(() => buildDiagram({ title: "x", type: "flowchart" })).toThrow(/needs `mermaid`/);
        const huge = Array.from({ length: 300 }, (_, i) => `  - Topic ${i}`).join("\n");
        expect(() =>
            buildDiagram({ title: "x", type: "mindmap", outline: `Root\n${huge}` })
        ).toThrow(/250 or fewer/);
    });
});

describe("generated flowchart frames", () => {
    test("are paper, not a block of theme colour, in either lighting", () => {
        const mermaid = "flowchart TD\n subgraph P [Phase one]\n A --> B\n end";
        for (const mode of ["light", "dark"] as const) {
            const page = activePage(
                buildDiagram({ title: "x", type: "flowchart", mermaid }, { mode })
            );
            const frame = page.nodes.find(n => n.shape === "frame")!;
            expect(frame.style.fill).toBe(FRAME_PAPER[mode].fill);
        }
    });
});
