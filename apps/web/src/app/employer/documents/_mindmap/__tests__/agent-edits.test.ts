import {
    applyDiagramEdits,
    DiagramEditError,
    describeDiagram,
    runDiagramEdits,
    topicContext,
} from "../model/agent-edits";
import { activePage, graphIndex, nodeById, topicParent } from "../model/doc";
import { buildDiagram } from "../model/generate";
import { EditorStore } from "../model/store";
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

    test("writes a flowchart as shapes and labelled arrows", () => {
        const doc = flowchart();
        const page = activePage(doc);
        const text = describeDiagram(doc);
        expect(text).toContain(
            `- decision: Within 30 days? (id: ${idOf(page, "Within 30 days?")})`
        );
        expect(text).toMatch(
            /Within 30 days\? \(id: n_\w+\) → Refund \(id: n_\w+\), labelled "yes"/
        );
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
    test("adds a step after another, connected, styled like it and clear of every box", () => {
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
