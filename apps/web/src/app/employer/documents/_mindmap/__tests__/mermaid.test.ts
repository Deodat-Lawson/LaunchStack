import { mermaidToDoc, parseMermaidFlowchart } from "../model/mermaid";
import { fromMermaid } from "../model/serialize";

/**
 * Mermaid is what models write flowcharts in and what READMEs carry, so the
 * parser takes the grammar people actually use and skips what it cannot
 * draw rather than failing on it.
 */

describe("parseMermaidFlowchart", () => {
    test("reads the direction from the header", () => {
        expect(parseMermaidFlowchart("flowchart LR\n A --> B").direction).toBe("right");
        expect(parseMermaidFlowchart("graph TD\n A --> B").direction).toBe("down");
        expect(parseMermaidFlowchart("flowchart BT\n A --> B").direction).toBe("up");
        expect(parseMermaidFlowchart("A --> B").direction).toBe("down");
    });

    test("reads every bracket shape", () => {
        const graph = parseMermaidFlowchart(
            [
                "flowchart TD",
                "A([Start]) --> B[Step]",
                "B --> C{Decide?}",
                "C --> D[(Store)]",
                "D --> E((Hub))",
                "E --> F{{Prepare}}",
                "F --> G[/Input/]",
                "G --> H[[Subroutine]]",
                "H --> I(Rounded)",
            ].join("\n")
        );
        const shape = (key: string) => graph.nodes.find(n => n.key === key)!.shape;
        expect(shape("A")).toBe("terminator");
        expect(shape("B")).toBe("process");
        expect(shape("C")).toBe("decision");
        expect(shape("D")).toBe("database");
        expect(shape("E")).toBe("circle");
        expect(shape("F")).toBe("preparation");
        expect(shape("G")).toBe("data");
        expect(shape("H")).toBe("predefined-process");
        expect(shape("I")).toBe("rounded-rectangle");
    });

    test("reads quoted labels with brackets in them, and <br> as a line break", () => {
        const graph = parseMermaidFlowchart(
            'flowchart TD\n A["Pay (card) [1]"] --> B["Two<br/>lines"]'
        );
        expect(graph.nodes.map(n => n.label)).toEqual(["Pay (card) [1]", "Two\nlines"]);
    });

    test("reads chains, fan-outs and both label forms", () => {
        const graph = parseMermaidFlowchart(
            "flowchart TD\n A --> B --> C\n C -->|yes| D & E\n C -- no --> F\n F -.-> A\n F ==> G\n G --- H"
        );
        const pairs = graph.edges.map(e => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`);
        expect(pairs).toEqual(["A>B", "B>C", "C>D:yes", "C>E:yes", "C>F:no", "F>A", "F>G", "G>H"]);
        expect(graph.edges.find(e => e.from === "F" && e.to === "A")!.stroke).toBe("dashed");
        expect(graph.edges.find(e => e.from === "F" && e.to === "G")!.stroke).toBe("thick");
        expect(graph.edges.find(e => e.from === "G")!.endArrow).toBe("none");
    });

    test("files nodes into subgraphs, nested, including ones mentioned earlier", () => {
        const graph = parseMermaidFlowchart(
            [
                "flowchart TD",
                "A --> B --> C",
                "subgraph wh [Warehouse]",
                "  B",
                "  subgraph pack[Packing]",
                "    C --> D",
                "  end",
                "end",
            ].join("\n")
        );
        expect(graph.clusters).toEqual([
            { key: "wh", title: "Warehouse", parent: null },
            { key: "pack", title: "Packing", parent: "wh" },
        ]);
        const in_ = (key: string) => graph.nodes.find(n => n.key === key)!.clusters;
        expect(in_("A")).toEqual([]);
        expect(in_("B")).toEqual(["wh"]);
        expect(in_("C")).toEqual(["wh", "pack"]);
        expect(in_("D")).toEqual(["wh", "pack"]);
    });

    test("skips styling, comments and code fences", () => {
        const graph = parseMermaidFlowchart(
            "```mermaid\nflowchart TD\n %% note\n classDef hot fill:#f00\n A:::hot --> B\n style A fill:#fff\n click A href\n```"
        );
        expect(graph.nodes.map(n => n.key)).toEqual(["A", "B"]);
        expect(graph.edges).toHaveLength(1);
    });

    test("an arrow may end on a subgraph", () => {
        const graph = parseMermaidFlowchart("flowchart TD\n subgraph S [Team]\n X\n end\n A --> S");
        expect(graph.nodes.map(n => n.key)).toEqual(["X", "A"]);
        expect(graph.edges).toEqual([expect.objectContaining({ from: "A", to: "S" })]);
    });
});

describe("mermaidToDoc", () => {
    test("draws subgraphs as frames that hold their members", () => {
        const doc = mermaidToDoc(
            "flowchart TD\n A --> B\n subgraph T [Team]\n B --> C\n end",
            "Flow"
        );
        const page = doc.pages[0]!;
        const frame = page.nodes.find(n => n.shape === "frame")!;
        expect(frame.text).toBe("Team");
        const inFrame = page.nodes.filter(n => n.parentId === frame.id).map(n => n.text);
        expect(inFrame.sort()).toEqual(["B", "C"]);
        // Frames are drawn under what they hold.
        expect(page.nodes.indexOf(frame)).toBe(0);
        expect(doc.settings.kind).toBe("flowchart");
        expect(doc.settings.autoLayout).toBeNull();
    });

    test("sizes boxes to their labels", () => {
        const doc = mermaidToDoc(
            "flowchart TD\n A[Short] --> B[A much longer label that has to wrap onto lines]"
        );
        const [a, b] = doc.pages[0]!.nodes;
        expect(b!.w * b!.h).toBeGreaterThan(a!.w * a!.h);
    });

    test("is what the Import dialog's fromMermaid uses", () => {
        const doc = fromMermaid("flowchart LR\n A --> B", "Imported");
        expect(doc.pages[0]!.nodes).toHaveLength(2);
        const [a, b] = doc.pages[0]!.nodes;
        expect(b!.x).toBeGreaterThan(a!.x);
    });
});
