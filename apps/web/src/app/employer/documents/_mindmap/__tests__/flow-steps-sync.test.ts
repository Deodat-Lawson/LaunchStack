import {
    addNextStep,
    commitNodeText,
    deleteSelection,
    insertEdge,
    insertShape,
    setBranchWords,
    setEdgeLabel,
} from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { createEdge } from "../model/factory";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramNode, DiagramPage } from "../model/types";
import { applySteps, isStepNode, matchSteps, structureOf } from "../model/flowchart/steps";
import { flowchartLook } from "../model/flowchart/look";
import { reconcileSteps, serializeSteps } from "../model/flowchart/reconcile";
import { BURST_IDLE, PREVIEW_MAX_WAIT, StepsSync } from "../flow/steps/sync";
import { parseSteps } from "../model/flowchart/syntax";

/**
 * The Steps panel keeps its lines and the chart in step, both ways. These
 * drive the real store with the real commands — the ones Tab, Delete and the
 * label field call — and check the lines, the boxes, the arrows and the undo
 * history after each.
 */

const EXAMPLE = [
    "Start",
    "Receive the order",
    "Check stock",
    "In stock?",
    "  Yes: Pick and pack",
    "  No: Reorder from supplier -> Check stock",
    "Ship and send tracking",
    "End",
].join("\n");

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
});
afterEach(() => {
    jest.useRealTimers();
});

function setup(board: "light" | "dark" = "light") {
    const store = new EditorStore(buildTemplate("blank", "Flow", board));
    const sync = new StepsSync(store, { origin: () => ({ x: 400, y: 80 }) });
    sync.start();
    return { store, sync };
}

const page = (store: EditorStore) => activePage(store.getState().doc);
const steps = (store: EditorStore) => page(store).nodes.filter(isStepNode);
const byText = (store: EditorStore, text: string): DiagramNode => {
    const nd = page(store).nodes.find(n => n.text === text);
    if (!nd) throw new Error(`no box "${text}"`);
    return nd;
};
const centre = (nd: DiagramNode) => ({ x: nd.x + nd.w / 2, y: nd.y + nd.h / 2 });
const arrows = (store: EditorStore): string[] => {
    const p = page(store);
    const label = (id?: string) => p.nodes.find(n => n.id === id)?.text ?? "?";
    return p.edges
        .map(
            e =>
                `${label(e.from.nodeId)} → ${label(e.to.nodeId)}${e.labels[0]?.text ? ` [${e.labels[0].text}]` : ""}`
        )
        .sort();
};

/** Let the controller catch up with a canvas edit (it waits a microtask). */
async function caughtUp() {
    await Promise.resolve();
    await Promise.resolve();
}

/** Type the whole text and let it land as one burst. */
function write(sync: StepsSync, text: string) {
    sync.edit(text);
    jest.advanceTimersByTime(PREVIEW_MAX_WAIT);
    jest.advanceTimersByTime(BURST_IDLE);
}

/** Rename a box the way the label field does. */
function rename(store: EditorStore, id: string, text: string) {
    store.setEditing({ kind: "node", id });
    commitNodeText(store, nodeById(page(store), id)!, text);
    store.setEditing(null);
}

describe("Steps: text → chart", () => {
    it("draws the example as boxes and arrows", () => {
        const { store, sync } = setup();
        write(sync, EXAMPLE);
        expect(steps(store).map(n => `${n.shape}:${n.text}`)).toEqual([
            "terminator:Start",
            "process:Receive the order",
            "process:Check stock",
            "decision:In stock?",
            "process:Pick and pack",
            "process:Reorder from supplier",
            "process:Ship and send tracking",
            "terminator:End",
        ]);
        expect(arrows(store)).toEqual([
            "Check stock → In stock?",
            "In stock? → Pick and pack [Yes]",
            "In stock? → Reorder from supplier [No]",
            "Pick and pack → Ship and send tracking",
            "Receive the order → Check stock",
            "Reorder from supplier → Check stock",
            "Ship and send tracking → End",
            "Start → Receive the order",
        ]);
    });

    it("lays the chart out top to bottom, branches side by side", () => {
        const { store, sync } = setup();
        write(sync, EXAMPLE);
        const y = (t: string) => centre(byText(store, t)).y;
        expect(y("Start")).toBeLessThan(y("Receive the order"));
        expect(y("Receive the order")).toBeLessThan(y("Check stock"));
        expect(y("Check stock")).toBeLessThan(y("In stock?"));
        expect(y("In stock?")).toBeLessThan(y("Pick and pack"));
        expect(y("Pick and pack")).toBeLessThan(y("Ship and send tracking"));
        expect(y("Ship and send tracking")).toBeLessThan(y("End"));
        expect(Math.abs(y("Pick and pack") - y("Reorder from supplier"))).toBeLessThan(1);
        const xs = [
            centre(byText(store, "Pick and pack")).x,
            centre(byText(store, "Reorder from supplier")).x,
        ];
        expect(Math.abs(xs[0]! - xs[1]!)).toBeGreaterThan(150);
    });

    it("puts the first step at the top of the view, and keeps it there as lines are added", () => {
        const { store, sync } = setup();
        write(sync, "Start");
        const first = byText(store, "Start");
        expect(centre(first).x).toBe(400);
        expect(first.y).toBe(80);
        write(sync, "Start\nOne\nTwo\nThree");
        const again = byText(store, "Start");
        expect({ x: again.x, y: again.y }).toEqual({ x: first.x, y: first.y });
    });

    it("dresses every box in the flowchart look: coloured by kind, no outline, 15px regular", () => {
        for (const board of ["light", "dark"] as const) {
            const { store, sync } = setup(board);
            write(sync, EXAMPLE);
            for (const nd of steps(store)) {
                const look = flowchartLook.boxLook(nd.shape, board);
                expect(nd.textStyle.size).toBe(15);
                expect(nd.textStyle.bold).toBe(false);
                expect(nd.textStyle.color).toBe(look.text.color);
                expect(nd.style.fill).toBe(look.style.fill);
                expect(nd.style.stroke).toBe("none");
                expect(nd.style.strokeWidth).toBe(0);
            }
            for (const e of page(store).edges) {
                expect(e.kind).toBe("elbow");
                expect(e.style.strokeWidth).toBe(1.5);
                expect(e.textStyle.color).toBe(flowchartLook.edgeLook(board).style.stroke);
            }
        }
    });

    it("keeps a box's id when its words change", () => {
        const { store, sync } = setup();
        write(sync, EXAMPLE);
        const before = byText(store, "Check stock").id;
        write(sync, EXAMPLE.replace("Check stock\n", "Check the stock\n"));
        expect(byText(store, "Check the stock").id).toBe(before);
    });

    it("keeps every box's id when a line is added in the middle", () => {
        const { store, sync } = setup();
        write(sync, EXAMPLE);
        const ids = new Map(steps(store).map(n => [n.text, n.id]));
        write(sync, EXAMPLE.replace("Check stock\n", "Check stock\nWeigh the parcel\n"));
        for (const [text, id] of ids) expect(byText(store, text).id).toBe(id);
        expect(steps(store)).toHaveLength(ids.size + 1);
    });

    it("keeps a box's id when its line moves", () => {
        const { store, sync } = setup();
        write(sync, "A\nB\nC\nD");
        const c = byText(store, "C").id;
        write(sync, "A\nC\nB\nD");
        expect(byText(store, "C").id).toBe(c);
        expect(arrows(store)).toEqual(["A → C", "B → D", "C → B"]);
    });

    it("keeps the box while a new line is typed letter by letter", () => {
        const { store, sync } = setup();
        write(sync, "A\nR");
        const id = byText(store, "R").id;
        for (const t of ["Re", "Rec", "Rece", "Receive"]) write(sync, `A\n${t}`);
        expect(byText(store, "Receive").id).toBe(id);
    });

    it("turns a step into a decision, same box, when its line gets a ?", () => {
        const { store, sync } = setup();
        write(sync, "Paid\nShip");
        const id = byText(store, "Paid").id;
        write(sync, "Paid?\nShip");
        const nd = byText(store, "Paid?");
        expect(nd.id).toBe(id);
        expect(nd.shape).toBe("decision");
        expect(nd.textStyle.bold).toBe(false);
    });

    it("follows the text within the preview window, not on every keystroke", () => {
        const { store, sync } = setup();
        sync.edit("A");
        expect(steps(store)).toHaveLength(0);
        // Keep typing faster than the delay: it still draws by the max wait.
        jest.advanceTimersByTime(100);
        sync.edit("A\nB");
        jest.advanceTimersByTime(100);
        sync.edit("A\nBo");
        jest.advanceTimersByTime(PREVIEW_MAX_WAIT - 200);
        expect(steps(store).map(n => n.text)).toEqual(["A", "Bo"]);
    });

    it("lands a typing burst as one undo entry", () => {
        const { store, sync } = setup();
        for (const t of ["S", "St", "Start", "Start\nPa", "Start\nPack", "Start\nPack\nEnd"]) {
            sync.edit(t);
            jest.advanceTimersByTime(PREVIEW_MAX_WAIT);
        }
        // Mid-burst: drawn, but nothing on the undo stack yet.
        expect(steps(store)).toHaveLength(3);
        expect(store.getState().canUndo).toBe(false);
        jest.advanceTimersByTime(BURST_IDLE);
        expect(store.historyLabels().undo).toBe("Edit steps");
        store.undo();
        expect(steps(store)).toHaveLength(0);
        expect(store.getState().canUndo).toBe(false);
    });

    it("lands a burst when typing stops, even before the idle time (blur)", () => {
        const { store, sync } = setup();
        sync.edit("A\nB");
        sync.flush();
        sync.endBurst();
        expect(store.getState().canUndo).toBe(true);
    });

    it("brings the text back with undo and redo", async () => {
        const { store, sync } = setup();
        write(sync, "A\n\nB");
        write(sync, "A\n\nB\nC");
        store.undo();
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\n\nB");
        store.redo();
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\n\nB\nC");
    });

    it("does not commit a keystroke that changes nothing on the chart", () => {
        const { store, sync } = setup();
        write(sync, "A\nB");
        const before = store.getState().doc;
        write(sync, "A\nB\n\n");
        expect(store.getState().doc).toBe(before);
    });

    it("leaves boxes that are not steps alone", () => {
        const { store, sync } = setup();
        const sticky = insertShape(store, "sticky", { x: -400, y: 0 }, { text: "remember" });
        write(sync, "A\nB");
        expect(nodeById(page(store), sticky)?.text).toBe("remember");
        write(sync, "");
        expect(nodeById(page(store), sticky)).toBeDefined();
        expect(steps(store)).toHaveLength(0);
    });

    it("replaces everything at once as a single undo step", () => {
        const { store, sync } = setup();
        sync.replace(EXAMPLE, "Use an example");
        expect(steps(store)).toHaveLength(8);
        expect(store.historyLabels().undo).toBe("Use an example");
        store.undo();
        expect(steps(store)).toHaveLength(0);
    });
});

describe("Steps: chart → text", () => {
    it("rewrites a renamed box's line, and every arrow that pointed at it", async () => {
        const { store, sync } = setup();
        write(sync, EXAMPLE);
        const id = byText(store, "Check stock").id;
        rename(store, id, "Count the stock");
        await caughtUp();
        expect(sync.getSnapshot().text).toBe(
            EXAMPLE.replace("Check stock\n", "Count the stock\n").replace(
                "-> Check stock",
                "-> Count the stock"
            )
        );
        expect(byText(store, "Count the stock").id).toBe(id);
        // The loop back is still drawn.
        expect(arrows(store)).toContain("Reorder from supplier → Count the stock");
    });

    it("keeps blank lines and spacing on the lines an edit did not touch", async () => {
        const { store, sync } = setup();
        const text = "Start\n\nTake  the order\n\n  \nShip\nEnd";
        write(sync, text);
        rename(store, byText(store, "Ship").id, "Ship it");
        await caughtUp();
        expect(sync.getSnapshot().text).toBe(text.replace("Ship\n", "Ship it\n"));
    });

    it("turns a box renamed into a question into a decision, line and box", async () => {
        const { store, sync } = setup();
        write(sync, "Start\nPaid\nShip");
        const id = byText(store, "Paid").id;
        rename(store, id, "Paid?");
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Start\nPaid?\nShip");
        expect(nodeById(page(store), id)!.shape).toBe("decision");
    });

    it("lands a rename and its re-layout as one undo step, and undo brings the line back", async () => {
        const { store, sync } = setup();
        write(sync, "A\nB\nC");
        rename(store, byText(store, "B").id, "A much longer second step that wraps");
        await caughtUp();
        store.undo();
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\nB\nC");
        expect(steps(store).map(n => n.text)).toEqual(["A", "B", "C"]);
    });

    it("Tab on a step: a new line after its line, laid out between it and the next", async () => {
        const { store, sync } = setup();
        write(sync, "Start\nPack\nShip\nEnd");
        const pack = byText(store, "Pack");
        const ship = byText(store, "Ship");
        const added = addNextStep(store, pack.id)!;
        // The new box is laid out straight away, between the two.
        const fresh = nodeById(page(store), added)!;
        expect(centre(fresh).y).toBeGreaterThan(centre(pack).y);
        expect(centre(fresh).y).toBeLessThan(centre(byText(store, "Ship")).y);
        commitNodeText(store, fresh, "Weigh");
        store.setEditing(null);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Start\nPack\nWeigh\nShip\nEnd");
        expect(arrows(store)).toEqual([
            "Pack → Weigh",
            "Ship → End",
            "Start → Pack",
            "Weigh → Ship",
        ]);
        expect(byText(store, "Weigh").id).toBe(added);
        expect(byText(store, "Ship").id).toBe(ship.id);
    });

    it("Tab on a step that jumps hands the jump on to the new step", async () => {
        const { store, sync } = setup();
        write(sync, "Start\nFix -> Start\nEnd");
        const fix = byText(store, "Fix");
        const added = addNextStep(store, fix.id)!;
        commitNodeText(store, nodeById(page(store), added)!, "Test");
        store.setEditing(null);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Start\nFix\nTest -> Start\nEnd");
        expect(arrows(store)).toEqual(["Fix → Test", "Start → Fix", "Test → Start"]);
    });

    it("Tab on a decision adds a branch line", async () => {
        const { store, sync } = setup();
        write(sync, "Paid?\n  Yes: Ship\nDone");
        const added = addNextStep(store, byText(store, "Paid?").id)!;
        commitNodeText(store, nodeById(page(store), added)!, "Refund");
        store.setEditing(null);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Paid?\n  Yes: Ship\n  Refund\nDone");
        expect(arrows(store)).toContain("Refund → Done");
        expect(byText(store, "Refund").id).toBe(added);
    });

    it("Tab on a branch adds a line after the block; the other branches keep their way", async () => {
        const { store, sync } = setup();
        write(sync, "Paid?\n  Yes: Ship\n  No: Remind\nDone");
        const added = addNextStep(store, byText(store, "Ship").id)!;
        commitNodeText(store, nodeById(page(store), added)!, "Track");
        store.setEditing(null);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe(
            "Paid?\n  Yes: Ship\n  No: Remind -> Done\nTrack\nDone"
        );
        expect(arrows(store)).toEqual([
            "Paid? → Remind [No]",
            "Paid? → Ship [Yes]",
            "Remind → Done",
            "Ship → Track",
            "Track → Done",
        ]);
    });

    it("Tab and then nothing typed: the box stays as the canvas left it, with no line yet", async () => {
        const { store, sync } = setup();
        write(sync, "A\nB");
        const added = addNextStep(store, byText(store, "A").id)!;
        store.setEditing(null);
        await caughtUp();
        // The panel never takes away what the canvas made (Esc on an empty
        // step is what removes it); the box gets its line once it has words.
        expect(sync.getSnapshot().text).toBe("A\nB");
        expect(nodeById(page(store), added)).toBeDefined();
        rename(store, added, "Weigh");
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\nWeigh\nB");
    });

    it("a branch made with the keys under a fresh question stays a branch", async () => {
        const { store, sync } = setup();
        setBranchWords(store, { yes: "Yes", no: "No" });
        // Typed on the canvas from an empty board: the lines knew none of it.
        const a = insertShape(store, "process", { x: 0, y: 0 });
        rename(store, a, "Receive order");
        const q = addNextStep(store, a)!;
        rename(store, q, "In stock?");
        const pack = addNextStep(store, q)!;
        rename(store, pack, "Pack");
        const reorder = addNextStep(store, q, { branch: true })!;
        rename(store, reorder, "Reorder");
        await caughtUp();
        expect(arrows(store)).toEqual([
            "In stock? → Pack [Yes]",
            "In stock? → Reorder [No]",
            "Receive order → In stock?",
        ]);
        // Both branches written under the question (which comes first is the
        // serializer's choice).
        const lines = sync.getSnapshot().text.split("\n");
        expect(lines.slice(0, 2)).toEqual(["Receive order", "In stock?"]);
        expect(lines.slice(2).sort()).toEqual(["  No: Reorder", "  Yes: Pack"]);
    });

    it("Delete on a box takes its line, and joins the lines around it", async () => {
        const { store, sync } = setup();
        write(sync, "Start\nPack\nShip\nEnd");
        store.selectNodes([byText(store, "Pack").id]);
        deleteSelection(store);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Start\nShip\nEnd");
        expect(arrows(store)).toEqual(["Ship → End", "Start → Ship"]);
        expect(store.getState().selection).toEqual([]);
    });

    it("Delete on a decision lifts its branches into its place", async () => {
        const { store, sync } = setup();
        write(sync, "Start\nPaid?\n  Yes: Ship\n  No: -> Start\nEnd");
        store.selectNodes([byText(store, "Paid?").id]);
        deleteSelection(store);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Start\nShip\nEnd");
        expect(arrows(store)).toEqual(["Ship → End", "Start → Ship"]);
    });

    it("Delete on a written-out arrow takes the `->` out", async () => {
        const { store, sync } = setup();
        write(sync, "A -> C\nB\nC");
        const ac = page(store).edges.find(
            e => e.from.nodeId === byText(store, "A").id && e.to.nodeId === byText(store, "C").id
        )!;
        store.setSelection([{ kind: "edge", id: ac.id }]);
        deleteSelection(store);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\nB\nC");
        expect(arrows(store)).toEqual(["A → B", "B → C"]);
    });

    it("puts back an arrow the lines imply, since the lines are the truth", async () => {
        const { store, sync } = setup();
        write(sync, "A\nB");
        const ab = page(store).edges[0]!;
        store.setSelection([{ kind: "edge", id: ab.id }]);
        deleteSelection(store);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\nB");
        expect(arrows(store)).toEqual(["A → B"]);
    });

    it("writes a connector drawn between two steps as `-> Step`", async () => {
        const { store, sync } = setup();
        write(sync, "Start\nPack\nCheck\nShip");
        insertEdge(
            store,
            createEdge({
                from: { nodeId: byText(store, "Check").id, port: "auto" },
                to: { nodeId: byText(store, "Pack").id, port: "auto" },
            })
        );
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Start\nPack\nCheck -> Pack\n-> Ship\nShip");
        expect(arrows(store)).toContain("Check → Pack");
        expect(arrows(store)).toContain("Check → Ship");
    });

    it("writes a branch's arrow words changed on the canvas into its label", async () => {
        const { store, sync } = setup();
        write(sync, "Paid?\n  Yes: Ship\n  No: Remind\nDone");
        const edge = page(store).edges.find(e => e.labels[0]?.text === "No")!;
        setEdgeLabel(store, edge.id, 0, "Not yet");
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Paid?\n  Yes: Ship\n  Not yet: Remind\nDone");
    });

    it("ignores a drag: positions are not in the text", async () => {
        const { store, sync } = setup();
        write(sync, "A\nB");
        const a = byText(store, "A");
        store.updatePage(p => ({
            ...p,
            nodes: p.nodes.map(n => (n.id === a.id ? { ...n, x: n.x + 120 } : n)),
        }));
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\nB");
        expect(byText(store, "A").x).toBe(a.x + 120);
    });

    it("waits for a label being typed on the canvas to be finished", async () => {
        const { store, sync } = setup();
        write(sync, "A\nB");
        const id = byText(store, "A").id;
        store.setEditing({ kind: "node", id });
        store.updatePage(
            p => ({
                ...p,
                nodes: p.nodes.map(n => (n.id === id ? { ...n, w: n.w + 40 } : n)),
            }),
            { transient: true }
        );
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("A\nB");
        commitNodeText(store, nodeById(page(store), id)!, "Alpha");
        store.setEditing(null);
        await caughtUp();
        expect(sync.getSnapshot().text).toBe("Alpha\nB");
    });
});

describe("Steps: pure pieces", () => {
    it("matches boxes by words in order, then by position", () => {
        const old = ["A", "B", "C"].map(
            (text, i) => ({ id: `n${i}`, text }) as unknown as DiagramNode
        );
        expect(matchSteps(["A", "B2", "C"], old)).toEqual(["n0", "n1", "n2"]);
        expect(matchSteps(["A", "X", "B", "C"], old)).toEqual(["n0", null, "n1", "n2"]);
        // Lines that swapped places keep their boxes.
        expect(matchSteps(["C", "A"], old)).toEqual(["n2", "n0"]);
        // An id the caller already knows wins over the words.
        expect(matchSteps(["A"], old, ["n2"])).toEqual(["n2"]);
        // Words that changed and moved at once: paired by position in what is left.
        expect(matchSteps(["A", "Z", "C"], old)).toEqual(["n0", "n1", "n2"]);
    });

    it("writes a page it has never seen out as lines that draw the same chart", () => {
        const store = new EditorStore(buildTemplate("blank", "Flow", "light"));
        const drawn = applySteps(page(store), parseSteps(EXAMPLE), {
            look: flowchartLook,
            mode: "light",
        });
        const out = serializeSteps(drawn.page);
        const again = applySteps(drawn.page, parseSteps(out.text), {
            look: flowchartLook,
            mode: "light",
            ids: out.ids,
        });
        expect(structureOf(again.page)).toBe(structureOf(drawn.page));
    });

    it("writes the flowchart template out without losing a box", () => {
        const doc = buildTemplate("flowchart", "Flow", "light");
        const p: DiagramPage = activePage(doc);
        const out = serializeSteps(p);
        expect(out.ids.filter(Boolean)).toHaveLength(
            p.nodes.filter(n => isStepNode(n) && n.text.trim() !== "").length
        );
    });

    it("leaves the text alone when the page did not change", () => {
        const store = new EditorStore(buildTemplate("blank", "Flow", "light"));
        const text = "A\n\nB -> A\n";
        const parse = parseSteps(text);
        const drawn = applySteps(page(store), parse, { look: flowchartLook, mode: "light" });
        expect(reconcileSteps({ text, parse, ids: drawn.ids }, drawn.page).text).toBe(text);
    });
});
