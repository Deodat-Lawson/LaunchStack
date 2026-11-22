import {
    applyDiagramEdits,
    DiagramEditError,
    describeDiagram,
    runDiagramEdits,
    topicContext,
} from "../model/agent-edits";
import { activePage, graphIndex, nodeById, topicParent } from "../model/doc";
import { flowchartLook, flowchartToSteps, newStepBox } from "../model/flowchart";
import { buildDiagram } from "../model/generate";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramPage, MindmapDoc } from "../model/types";

/**
 * How a model reads a diagram and changes it: ids in brackets out, small
 * operations on those ids in, run through the editor's own commands — and
 * all or nothing.
 */

const OUTLINE = "- Launch\n  - Product\n    - Beta\n  - Marketing\n    - Blog";

function mindmap(): MindmapDoc {
    return buildDiagram({ title: "Launch", type: "mindmap", outline: OUTLINE });
}

function flowchart(): MindmapDoc {
    return buildDiagram({
        title: "Refunds",
        type: "flowchart",
        mermaid:
            "flowchart TD\n A([Request]) --> B{Within 30 days?}\n B -->|yes| C[Refund]\n B -->|no| D[Store credit]",
    });
}

const idOf = (page: DiagramPage, text: string) => page.nodes.find(n => n.text === text)!.id;

describe("describeDiagram", () => {
    test("writes a map as its outline, every topic with its id", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const text = describeDiagram(doc);
        expect(text).toContain(`- Launch (id: ${idOf(page, "Launch")})`);
        expect(text).toContain(`  - Product (id: ${idOf(page, "Product")})`);
        expect(text).toContain(`    - Beta (id: ${idOf(page, "Beta")})`);
        // Never in square brackets: the chat reads [x] as a citation.
        expect(text).not.toMatch(/\[n_/);
    });

    test("writes a drawing that is not a flowchart as shapes and labelled arrows", () => {
        const doc = buildTemplate("architecture", "Stack", "light");
        const page = activePage(doc);
        const text = describeDiagram(doc);
        expect(text).toContain(`- database: Postgres (id: ${idOf(page, "Postgres")})`);
        expect(text).toMatch(/API \(id: n_\w+\) → Postgres \(id: n_\w+\), labelled "SQL"/);
        expect(text).not.toContain("```steps");
    });
});

const STEPS = [
    "Start",
    "Receive the order",
    "In stock?",
    "  Yes: Pick and pack",
    "  No: Reorder from supplier -> Receive the order",
    "Ship it",
    "End",
].join("\n");

function stepsChart(mode: "light" | "dark" = "light"): MindmapDoc {
    return buildDiagram({ title: "Orders", type: "flowchart", steps: STEPS }, { mode });
}

/** The fenced step text out of a description. */
function fenced(text: string): string {
    return /```steps\n([\s\S]*?)\n```/.exec(text)![1]!;
}

describe("describeDiagram on a flowchart", () => {
    test("writes it as step text, with each step's box id listed under it", () => {
        const doc = stepsChart();
        const page = activePage(doc);
        const text = describeDiagram(doc);
        expect(fenced(text)).toBe(STEPS);
        expect(text).toContain('a line ending in "?" is a decision');
        expect(text).toContain(`- In stock? (id: ${idOf(page, "In stock?")})`);
        expect(text).toContain(
            `- Reorder from supplier (id: ${idOf(page, "Reorder from supplier")})`
        );
        // Never in square brackets: the chat reads [x] as a citation.
        expect(text).not.toMatch(/\[n_/);
        // The ids follow the steps, line for line.
        const listed = [...text.matchAll(/^- .+ \(id: (n_\w+)\)/gm)].map(m => m[1]);
        expect(listed).toEqual(flowchartToSteps(page).ids);
    });

    test("lists a decision's branches in the order their arrows were made, Yes before No", () => {
        const doc = stepsChart();
        const page = activePage(doc);
        // However the boxes happen to be stacked on the page.
        const shuffled: MindmapDoc = {
            ...doc,
            pages: [{ ...page, nodes: [...page.nodes].reverse() }],
        };
        const steps = fenced(describeDiagram(shuffled));
        expect(steps.indexOf("Yes: Pick and pack")).toBeLessThan(steps.indexOf("No: Reorder"));
    });

    test("hides nothing: notes, frames, arrows the steps cannot say", () => {
        const doc = stepsChart();
        const page = activePage(doc);
        const note = { ...newStepBox("sticky", "Ask Sam about stock", "light"), x: 900 };
        const pick = idOf(page, "Pick and pack");
        const ship = idOf(page, "Ship it");
        const withMore: MindmapDoc = {
            ...doc,
            pages: [
                {
                    ...page,
                    nodes: [...page.nodes, note],
                    edges: [
                        // An arrow to a note, and the join Pick → Ship taken away.
                        ...page.edges.filter(
                            e => !(e.from.nodeId === pick && e.to.nodeId === ship)
                        ),
                        {
                            ...page.edges[0]!,
                            id: "e_note",
                            from: { nodeId: pick },
                            to: { nodeId: note.id },
                            labels: [],
                        },
                    ],
                },
            ],
        };
        const text = describeDiagram(withMore);
        expect(text).toContain(`- sticky: Ask Sam about stock (id: ${note.id})`);
        expect(text).toMatch(
            /Arrows the steps do not show:\n- Pick and pack \(id: n_\w+\) → Ask Sam/
        );
        expect(text).toContain(
            `- Pick and pack (id: ${pick}) does not lead to Ship it (id: ${ship})`
        );
    });

    test("leaves a mind map as its outline", () => {
        expect(describeDiagram(mindmap())).not.toContain("```steps");
    });
});

describe("rewriting a flowchart from steps", () => {
    const REWRITE = [
        "Start",
        "Receive the order",
        "In stock?",
        "  Yes: Pick and pack",
        "  No: Reorder from supplier -> Receive the order",
        "Weigh the parcel",
        "Ship it",
        "End",
    ].join("\n");

    test("keeps the box of every step whose words stay, and adds the new ones in the look", () => {
        const doc = stepsChart("dark");
        const page = activePage(doc);
        const result = runDiagramEdits(doc, [{ op: "steps", text: REWRITE }]);
        const next = activePage(result.doc);
        for (const words of ["Start", "In stock?", "Pick and pack", "Ship it", "End"]) {
            expect(idOf(next, words)).toBe(idOf(page, words));
        }
        const weigh = nodeById(next, idOf(next, "Weigh the parcel"))!;
        expect(result.added).toEqual([weigh.id]);
        expect(weigh.style.fill).toBe(flowchartLook.boxLook("process", "dark").style.fill);
        expect(weigh.style.stroke).toBe("none");
        expect(weigh.textStyle.size).toBe(15);
        expect(flowchartToSteps(next).text).toBe(REWRITE);
        expect(result.applied[0]).toMatch(
            /^Redrew the flowchart from 8 steps: kept 7 of its boxes; added n_\w+ "Weigh the parcel"\.$/
        );
    });

    test("removes the boxes of steps left out, and keeps notes on the page", () => {
        const doc = stepsChart();
        const page = activePage(doc);
        const note = newStepBox("sticky", "Owner: Sam", "light");
        const withNote: MindmapDoc = { ...doc, pages: [{ ...page, nodes: [...page.nodes, note] }] };
        const result = runDiagramEdits(withNote, [
            { op: "steps", text: "Start\nReceive the order\nShip it\nEnd" },
        ]);
        const next = activePage(result.doc);
        expect(next.nodes.map(n => n.text).sort()).toEqual(
            ["End", "Owner: Sam", "Receive the order", "Ship it", "Start"].sort()
        );
        expect(result.applied[0]).toMatch(/removed n_\w+ "In stock\?"/);
    });

    test("is all or nothing, and says back every line it could not read", () => {
        const doc = stepsChart();
        const before = JSON.stringify(doc);
        let caught: unknown;
        try {
            runDiagramEdits(doc, [{ op: "steps", text: "Start\nPack -> Nowhere\nEnd" }]);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(DiagramEditError);
        expect((caught as Error).message).toMatch(
            /Line 2 \("Pack -> Nowhere"\): "-> Nowhere" points at no step/
        );
        // A good rewrite followed by a bad edit changes nothing either.
        expect(() =>
            runDiagramEdits(doc, [
                { op: "steps", text: REWRITE },
                { op: "rename", node: "n_missing", text: "x" },
            ])
        ).toThrow(DiagramEditError);
        expect(JSON.stringify(doc)).toBe(before);
    });

    test("takes the steps in a code fence, as models often send them", () => {
        const doc = stepsChart();
        const result = runDiagramEdits(doc, [{ op: "steps", text: "```\n" + REWRITE + "\n```" }]);
        expect(flowchartToSteps(activePage(result.doc)).text).toBe(REWRITE);
    });

    test("is for flowcharts: a mind map is changed with add, rename, remove and move", () => {
        expect(() => runDiagramEdits(mindmap(), [{ op: "steps", text: "A\nB" }])).toThrow(
            /this page is a mind map/
        );
        expect(() =>
            runDiagramEdits(buildTemplate("erd", "Data", "light"), [{ op: "steps", text: "A" }])
        ).toThrow(/not a flowchart its steps can say/);
    });

    test("in the editor, lands as one undo entry", () => {
        const store = new EditorStore(stepsChart());
        const before = store.getState().doc;
        applyDiagramEdits(store, [{ op: "steps", text: REWRITE }]);
        expect(flowchartToSteps(activePage(store.getState().doc)).text).toBe(REWRITE);
        store.undo();
        expect(store.getState().doc).toBe(before);
    });
});

describe("id edits on a flowchart", () => {
    test("add makes a box in the look, its kind from its words, and an auto chart takes it in", () => {
        const doc = stepsChart();
        const page = activePage(doc);
        const ship = idOf(page, "Ship it");
        const end = idOf(page, "End");
        const result = runDiagramEdits(doc, [
            { op: "disconnect", from: ship, to: end },
            { op: "add", under: ship, text: "Delivered?", ref: "q" },
            { op: "add", under: "q", text: "Close the order", label: "Yes" },
        ]);
        const next = activePage(result.doc);
        const q = nodeById(next, idOf(next, "Delivered?"))!;
        expect(q.shape).toBe("decision");
        expect(q.style.fill).toBe(flowchartLook.boxLook("decision", "light").style.fill);
        const close = nodeById(next, idOf(next, "Close the order"))!;
        expect(close.style.stroke).toBe("none");
        expect(close.textStyle.size).toBe(15);
        const arrow = next.edges.find(e => e.to.nodeId === close.id)!;
        expect(arrow.labels[0]!.text).toBe("Yes");
        expect(arrow.style.stroke).toBe(flowchartLook.edgeLook("light").style.stroke);
        // Auto layout: the new steps sit below the one they follow, on its line.
        const shipBox = nodeById(next, ship)!;
        expect(q.y).toBeGreaterThan(shipBox.y + shipBox.h);
        expect(close.y).toBeGreaterThan(q.y + q.h);
        expect(fenced(describeDiagram(result.doc))).toContain("Delivered?\n  Yes: Close the order");
    });

    test("a step renamed into a question becomes a decision, as when it is typed", () => {
        const doc = stepsChart();
        const page = activePage(doc);
        const next = activePage(
            runDiagramEdits(doc, [
                { op: "rename", node: idOf(page, "Ship it"), text: "Ready to ship?" },
            ]).doc
        );
        const box = nodeById(next, idOf(page, "Ship it"))!;
        expect(box.text).toBe("Ready to ship?");
        expect(box.shape).toBe("decision");
        expect(box.style.fill).toBe(flowchartLook.boxLook("decision", "light").style.fill);
    });
});

describe("runDiagramEdits on a mind map", () => {
    test("adds a whole branch from an outline, and later edits can use its ref", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const result = runDiagramEdits(doc, [
            {
                op: "add",
                under: idOf(page, "Marketing"),
                text: "Launch video\n  - Script\n  - Shoot",
                ref: "vid",
            },
            { op: "add", under: "vid", text: "Edit" },
        ]);
        const next = activePage(result.doc);
        const video = idOf(next, "Launch video");
        expect(topicParent(next, video)).toBe(idOf(next, "Marketing"));
        for (const child of ["Script", "Shoot", "Edit"]) {
            expect(topicParent(next, idOf(next, child))).toBe(video);
        }
        expect(result.added).toContain(video);
        // Added the way Tab adds: a topic, painted, laid out by the map.
        expect(nodeById(next, video)!.shape).toBe("mind-branch");
        expect(nodeById(next, video)!.style.stroke).toBe(
            nodeById(next, idOf(next, "Blog"))!.style.stroke
        );
    });

    test("renames, growing the box for a longer label and never shrinking it", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const beta = nodeById(page, idOf(page, "Beta"))!;
        const next = activePage(
            runDiagramEdits(doc, [
                {
                    op: "rename",
                    node: beta.id,
                    text: "Private beta with twenty design partners and a waitlist",
                },
            ]).doc
        );
        const renamed = nodeById(next, beta.id)!;
        expect(renamed.text).toMatch(/^Private beta/);
        expect(renamed.h).toBeGreaterThanOrEqual(beta.h);
        expect(renamed.w).toBeGreaterThanOrEqual(beta.w);
    });

    test("moves a topic under another, and refuses a move under its own subtopic", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const next = activePage(
            runDiagramEdits(doc, [
                { op: "move", node: idOf(page, "Beta"), under: idOf(page, "Marketing") },
            ]).doc
        );
        expect(topicParent(next, idOf(next, "Beta"))).toBe(idOf(next, "Marketing"));
        expect(() =>
            runDiagramEdits(doc, [
                { op: "move", node: idOf(page, "Product"), under: idOf(page, "Beta") },
            ])
        ).toThrow(/under itself or its own subtopic/);
    });

    test("removes a topic with its subtopics, or lifts them up a level", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const gone = activePage(
            runDiagramEdits(doc, [{ op: "remove", node: idOf(page, "Product") }]).doc
        );
        expect(gone.nodes.map(n => n.text)).not.toContain("Beta");

        const lifted = activePage(
            runDiagramEdits(doc, [
                { op: "remove", node: idOf(page, "Product"), keep_children: true },
            ]).doc
        );
        expect(topicParent(lifted, idOf(lifted, "Beta"))).toBe(idOf(lifted, "Launch"));
    });

    test("never removes the centre, which would take the whole map", () => {
        const doc = mindmap();
        expect(() =>
            runDiagramEdits(doc, [{ op: "remove", node: idOf(activePage(doc), "Launch") }])
        ).toThrow(/central topic/);
    });

    test("a cross-link is a dashed relation, and a branch line cannot be disconnected", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const linked = activePage(
            runDiagramEdits(doc, [
                {
                    op: "connect",
                    from: idOf(page, "Blog"),
                    to: idOf(page, "Beta"),
                    label: "announces",
                },
            ]).doc
        );
        const link = linked.edges.find(e => e.labels[0]?.text === "announces")!;
        expect(link.style.strokeStyle).toBe("dashed");
        // Beta keeps its parent: a cross-link is not a branch.
        expect(topicParent(linked, idOf(linked, "Beta"))).toBe(idOf(linked, "Product"));

        expect(() =>
            runDiagramEdits(doc, [
                { op: "disconnect", from: idOf(page, "Product"), to: idOf(page, "Beta") },
            ])
        ).toThrow(/branch of the tree/);
    });

    test("an `after` that names nothing puts the topic last instead of failing", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const next = activePage(
            runDiagramEdits(doc, [
                {
                    op: "add",
                    under: idOf(page, "Marketing"),
                    text: "Webinar",
                    after: "new_blog_id",
                },
            ]).doc
        );
        expect(topicParent(next, idOf(next, "Webinar"))).toBe(idOf(next, "Marketing"));
    });

    test("names shapes by id, bracketed id or a unique label", () => {
        const doc = mindmap();
        const page = activePage(doc);
        for (const ref of [
            idOf(page, "Blog"),
            `[${idOf(page, "Blog")}]`,
            `(id: ${idOf(page, "Blog")})`,
            "blog",
        ]) {
            const next = activePage(
                runDiagramEdits(doc, [{ op: "rename", node: ref, text: "Blog post" }]).doc
            );
            expect(next.nodes.map(n => n.text)).toContain("Blog post");
        }
    });

    test("is all or nothing: one bad edit and nothing changes", () => {
        const doc = mindmap();
        const page = activePage(doc);
        const before = JSON.stringify(doc);
        let caught: unknown;
        try {
            runDiagramEdits(doc, [
                { op: "add", under: idOf(page, "Product"), text: "Pricing" },
                { op: "rename", node: "n_missing", text: "x" },
            ]);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(DiagramEditError);
        expect((caught as DiagramEditError).index).toBe(1);
        expect((caught as Error).message).toMatch(/^Edit 2: no shape "n_missing"/);
        expect(JSON.stringify(doc)).toBe(before);
    });
});

describe("runDiagramEdits on a flowchart", () => {
    test("adds a step after another, connected, in the look and clear of every box", () => {
        const doc = flowchart();
        const page = activePage(doc);
        const refund = nodeById(page, idOf(page, "Refund"))!;
        const result = runDiagramEdits(doc, [
            { op: "add", under: refund.id, text: "Email the receipt", ref: "mail" },
            { op: "add", under: "mail", text: "Close", shape: "terminator", label: "done" },
        ]);
        const next = activePage(result.doc);
        const mail = nodeById(next, idOf(next, "Email the receipt"))!;
        expect(graphIndex(next).out.get(refund.id)).toContain(mail.id);
        expect(mail.style.fill).toBe(refund.style.fill);
        expect(mail.y).toBeGreaterThan(refund.y);
        const close = nodeById(next, idOf(next, "Close"))!;
        expect(close.shape).toBe("terminator");
        expect(next.edges.find(e => e.to.nodeId === close.id)!.labels[0]!.text).toBe("done");
        for (const other of next.nodes.filter(n => n.id !== mail.id)) {
            const apart =
                mail.x >= other.x + other.w ||
                other.x >= mail.x + mail.w ||
                mail.y >= other.y + other.h ||
                other.y >= mail.y + mail.h;
            expect(apart).toBe(true);
        }
    });

    test("arrange lays the whole chart out in layers again, the way it flows", () => {
        const doc = flowchart();
        const page = activePage(doc);
        // One box dragged far off to the side and up does not turn the chart.
        const refund = idOf(page, "Refund");
        const scattered: MindmapDoc = {
            ...doc,
            pages: [
                {
                    ...page,
                    nodes: page.nodes.map(n => (n.id === refund ? { ...n, x: 2400, y: -600 } : n)),
                },
            ],
        };
        const next = activePage(runDiagramEdits(scattered, [{ op: "arrange" }]).doc);
        const y = (text: string) => nodeById(next, idOf(next, text))!.y;
        expect(y("Request")).toBeLessThan(y("Within 30 days?"));
        expect(y("Within 30 days?")).toBeLessThan(y("Refund"));
    });

    test("move is for topics: a flowchart is changed with connect and disconnect", () => {
        const doc = flowchart();
        const page = activePage(doc);
        expect(() =>
            runDiagramEdits(doc, [
                { op: "move", node: idOf(page, "Refund"), under: idOf(page, "Request") },
            ])
        ).toThrow(/connect and disconnect/);
    });
});

describe("applyDiagramEdits on a live editor", () => {
    test("lands as one undo entry, marked unsaved for autosave", () => {
        const store = new EditorStore(mindmap());
        store.markSaved();
        const page = activePage(store.getState().doc);
        const before = store.getState().doc;
        applyDiagramEdits(store, [
            { op: "add", under: idOf(page, "Product"), text: "- Pricing\n- Docs" },
            { op: "rename", node: idOf(page, "Blog"), text: "Blog post" },
        ]);
        expect(store.getState().dirty).toBe(true);
        expect(activePage(store.getState().doc).nodes.map(n => n.text)).toEqual(
            expect.arrayContaining(["Pricing", "Docs", "Blog post"])
        );
        store.undo();
        expect(store.getState().doc).toBe(before);
    });
});

describe("topicContext", () => {
    test("names the branch from the centre, what is under it and the other branches", () => {
        const doc = mindmap();
        const page = activePage(doc);
        expect(topicContext(page, idOf(page, "Product"))).toEqual({
            path: ["Launch", "Product"],
            existing: ["Beta"],
            siblings: ["Marketing"],
        });
        expect(topicContext(flowchart().pages[0]!, "nope")).toBeNull();
    });
});
