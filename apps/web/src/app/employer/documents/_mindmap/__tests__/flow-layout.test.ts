import {
    addConnected,
    addNextStep,
    alignSelection,
    arrangeNow,
    commitNodeText,
    insertShape,
    moveSelection,
    onChartHeld,
    setBranchWords,
    setFlowLayout,
    holdChartInPlace,
} from "../model/commands";
import { activePage, nodeById } from "../model/doc";
import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import { keepPlaced, tidyChart } from "../model/flowchart/arrange";
import { parseDoc } from "../model/serialize";
import { EditorStore } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramNode, FlowLayout } from "../model/types";
import { addBranch, nudge, removeStep } from "../flow/keys/actions";
import { BURST_IDLE, PREVIEW_MAX_WAIT, StepsSync } from "../flow/steps/sync";

/**
 * How a flowchart is arranged (`DocSettings.flowLayout`). A blank flowchart
 * arranges itself top to bottom after every structural change, until a box
 * is moved by hand; from then on nothing already placed moves, and new boxes
 * go beside the box they follow. Layout › Arrange automatically turns it
 * back on. Opening a document never moves anything.
 */

const page = (store: EditorStore) => activePage(store.getState().doc);
const node = (store: EditorStore, id: string) => nodeById(page(store), id)!;
const centreX = (nd: DiagramNode) => nd.x + nd.w / 2;
const layout = (store: EditorStore) => store.getState().doc.settings.flowLayout;
const at = (nd: DiagramNode) => ({ x: nd.x, y: nd.y });

function blank(flowLayout: FlowLayout = "auto"): EditorStore {
    const doc = buildTemplate("blank", "Flow", "light");
    const store = new EditorStore({ ...doc, settings: { ...doc.settings, flowLayout } });
    setBranchWords(store, { yes: "Yes", no: "No" });
    return store;
}

/** A chain typed step by step: A → B → C. */
function chain(store: EditorStore, labels = ["A", "B", "C"]): string[] {
    const ids = [insertShape(store, "process", { x: 0, y: 0 })];
    commitNodeText(store, node(store, ids[0]!), labels[0]!);
    for (const label of labels.slice(1)) {
        const id = addNextStep(store, ids.at(-1)!)!;
        commitNodeText(store, node(store, id), label);
        ids.push(id);
    }
    store.setEditing(null);
    return ids;
}

describe("which documents arrange themselves", () => {
    it("a blank flowchart does; a template's sample and an older document do not", () => {
        expect(buildTemplate("blank", "F").settings.flowLayout).toBe("auto");
        expect(buildTemplate("flowchart", "F").settings.flowLayout).toBe("manual");
        const old = createDoc("Old", [createPage()]) as unknown as Record<string, unknown>;
        const settings = { ...(old.settings as Record<string, unknown>) };
        delete settings.flowLayout;
        expect(parseDoc({ ...old, settings }, "Old").settings.flowLayout).toBe("manual");
    });

    it("opening a document never moves anything", () => {
        for (const id of ["flowchart", "user-flow", "swimlane", "blank"]) {
            const doc = buildTemplate(id, "F");
            const opened = parseDoc(JSON.parse(JSON.stringify(doc)), "F");
            const store = new EditorStore(opened);
            // The Steps panel opening over it reads it; it writes nothing.
            const sync = new StepsSync(store);
            sync.start();
            sync.stop();
            expect(activePage(store.getState().doc).nodes.map(at)).toEqual(
                activePage(doc).nodes.map(at)
            );
            expect(store.getState().canUndo).toBe(false);
        }
    });
});

describe("a chart that arranges itself", () => {
    it("lays itself out after Tab: one column, top to bottom", () => {
        const store = blank();
        const [a, b, c] = chain(store).map(id => node(store, id));
        expect(centreX(b!)).toBe(centreX(a!));
        expect(centreX(c!)).toBe(centreX(a!));
        expect(b!.y).toBeGreaterThan(a!.y + a!.h);
        expect(c!.y).toBeGreaterThan(b!.y + b!.h);
    });

    it("Tab in the middle of the line puts the step in the line", () => {
        const store = blank();
        const [a, b] = chain(store, ["A", "B"]);
        const mid = addNextStep(store, a!)!;
        const edges = page(store).edges.map(e => `${e.from.nodeId}>${e.to.nodeId}`);
        expect(edges.sort()).toEqual([`${a}>${mid}`, `${mid}>${b}`].sort());
        expect(node(store, mid).y).toBeLessThan(node(store, b!).y);
    });

    it("a decision's branches say Yes then No, side by side under it", () => {
        const store = blank();
        const [q] = chain(store, ["In stock?"]);
        expect(node(store, q!).shape).toBe("decision");
        const yes = addConnected(store, q!)!;
        const no = addConnected(store, q!)!;
        const label = (to: string) =>
            page(store).edges.find(e => e.to.nodeId === to)!.labels[0]!.text;
        expect([label(yes), label(no)]).toEqual(["Yes", "No"]);
        expect(node(store, yes).y).toBe(node(store, no).y);
        expect((centreX(node(store, yes)) + centreX(node(store, no))) / 2).toBe(
            centreX(node(store, q!))
        );
    });

    it("re-centres the chart when a finished label makes a step a decision", () => {
        const store = blank();
        const [a, b] = chain(store, ["Order", "Pack"]);
        const before = node(store, b!);
        commitNodeText(store, before, "Packed?");
        expect(node(store, b!).shape).toBe("decision");
        // Taller now, and still centred under its step.
        expect(centreX(node(store, b!))).toBe(centreX(node(store, a!)));
        expect(node(store, b!).y).toBeGreaterThan(node(store, a!).y + node(store, a!).h);
    });

    it("closes up after Delete joins the line", () => {
        const store = blank();
        const [a, b, c] = chain(store);
        removeStep(store, b!);
        expect(page(store).edges.map(e => [e.from.nodeId, e.to.nodeId])).toEqual([[a, c]]);
        const gap = node(store, c!).y - (node(store, a!).y + node(store, a!).h);
        expect(gap).toBe(64);
    });

    it("⇧Tab adds the branch beside, arranged", () => {
        const store = blank();
        const [a, b] = chain(store, ["A", "B"]);
        const branch = addBranch(store, b!)!;
        expect(node(store, branch).y).toBe(node(store, b!).y);
        expect(centreX(node(store, a!))).toBe(
            (centreX(node(store, b!)) + centreX(node(store, branch))) / 2
        );
    });
});

describe("a box moved by hand", () => {
    it("a nudge holds the chart in place, in the same undo step", () => {
        const store = blank();
        const [a] = chain(store);
        const before = node(store, a!);
        store.selectNodes([a!]);
        nudge(store, "right", true);
        expect(node(store, a!).x).toBe(before.x + 10);
        expect(layout(store)).toBe("manual");
        store.undo();
        expect(node(store, a!).x).toBe(before.x);
        expect(layout(store)).toBe("auto");
    });

    it("a drag does too: the move and the hold are one step", () => {
        const store = blank();
        const [a] = chain(store);
        const x0 = node(store, a!).x;
        store.beginInteraction("Move");
        store.updatePage(p => ({ ...p, nodes: p.nodes.map(n => ({ ...n, x: n.x + 40 })) }), {
            transient: true,
        });
        expect(holdChartInPlace(store)).toBe(true);
        store.endInteraction();
        expect(layout(store)).toBe("manual");
        store.undo();
        expect(layout(store)).toBe("auto");
        expect(node(store, a!).x).toBe(x0);
    });

    it("an align counts as placing by hand", () => {
        const store = blank();
        const ids = chain(store);
        store.selectNodes(ids);
        moveSelection(store, { x: 0, y: 0 }); // no movement: nothing changes
        expect(layout(store)).toBe("auto");
        store.updatePage(
            p => ({ ...p, nodes: p.nodes.map((n, i) => ({ ...n, x: n.x + i * 30 })) }),
            { transient: true }
        );
        alignSelection(store, "left");
        expect(layout(store)).toBe("manual");
    });

    it("says so once, the first time", () => {
        const store = blank();
        const [a] = chain(store);
        const heard = jest.fn();
        onChartHeld(store, heard);
        store.selectNodes([a!]);
        moveSelection(store, { x: 5, y: 0 }, "Nudge");
        moveSelection(store, { x: 5, y: 0 }, "Nudge");
        expect(heard).toHaveBeenCalledTimes(1);
    });
});

describe("a hand-placed chart", () => {
    function placed(): { store: EditorStore; ids: string[]; where: Map<string, unknown> } {
        const store = blank();
        const ids = chain(store);
        // Moved by hand: the middle step nudged a little to the right (the
        // line still runs down, so a next step still goes down).
        store.selectNodes([ids[1]!]);
        moveSelection(store, { x: 40, y: 0 }, "Nudge");
        store.clearSelection();
        expect(layout(store)).toBe("manual");
        return { store, ids, where: new Map(page(store).nodes.map(n => [n.id, at(n)])) };
    }

    it("Tab adds the step below its box and moves nothing else", () => {
        const { store, ids, where } = placed();
        const added = addNextStep(store, ids[2]!)!;
        for (const [id, p] of where) expect(at(node(store, id))).toEqual(p);
        const c = node(store, ids[2]!);
        expect(node(store, added).y).toBeGreaterThan(c.y + c.h);
        expect(centreX(node(store, added))).toBe(centreX(c));
    });

    it("a second branch goes beside the first, not on top of it", () => {
        const { store, ids, where } = placed();
        addNextStep(store, ids[2]!, { branch: true });
        const second = addNextStep(store, ids[2]!, { branch: true })!;
        for (const [id, p] of where) expect(at(node(store, id))).toEqual(p);
        const boxes = page(store).nodes;
        for (const x of boxes) {
            for (const y of boxes) {
                if (x.id < y.id) {
                    const apart =
                        x.x + x.w <= y.x ||
                        y.x + y.w <= x.x ||
                        x.y + x.h <= y.y ||
                        y.y + y.h <= x.y;
                    expect(apart).toBe(true);
                }
            }
        }
        expect(second).toBeTruthy();
    });

    it("Delete joins the line without moving what is left", () => {
        const { store, ids, where } = placed();
        removeStep(store, ids[1]!);
        expect(at(node(store, ids[0]!))).toEqual(where.get(ids[0]!));
        expect(at(node(store, ids[2]!))).toEqual(where.get(ids[2]!));
    });

    it("a finished label that makes a decision keeps its centre", () => {
        const { store, ids } = placed();
        const before = node(store, ids[1]!);
        commitNodeText(store, before, "Ready?");
        const after = node(store, ids[1]!);
        expect(after.shape).toBe("decision");
        expect(centreX(after)).toBe(centreX(before));
    });

    it("Arrange automatically lays it out now, and is one undo step", () => {
        const { store, ids, where } = placed();
        setFlowLayout(store, "auto");
        expect(layout(store)).toBe("auto");
        expect(centreX(node(store, ids[1]!))).toBe(centreX(node(store, ids[0]!)));
        store.undo();
        expect(layout(store)).toBe("manual");
        expect(at(node(store, ids[1]!))).toEqual(where.get(ids[1]!));
    });

    it("Arrange now lays it out once and leaves it hand-placed", () => {
        const { store, ids } = placed();
        arrangeNow(store);
        expect(centreX(node(store, ids[1]!))).toBe(centreX(node(store, ids[0]!)));
        expect(layout(store)).toBe("manual");
    });
});

describe("the Steps panel on a hand-placed chart", () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ["queueMicrotask"] }));
    afterEach(() => jest.useRealTimers());

    function write(sync: StepsSync, text: string) {
        sync.edit(text);
        jest.advanceTimersByTime(PREVIEW_MAX_WAIT);
        jest.advanceTimersByTime(BURST_IDLE);
    }

    it("never moves a box someone placed; a new line goes below the step before it", () => {
        const store = blank();
        const sync = new StepsSync(store, { origin: () => ({ x: 0, y: 0 }) });
        sync.start();
        write(sync, "Start\nPack\nShip");
        const id = (t: string) => page(store).nodes.find(n => n.text === t)!.id;
        store.selectNodes([id("Pack")]);
        moveSelection(store, { x: 300, y: 40 }, "Nudge");
        store.clearSelection();
        const where = new Map(page(store).nodes.map(n => [n.id, at(n)]));

        write(sync, "Start\nPack it\nShip\nTrack");
        for (const [nid, p] of where) expect(at(node(store, nid))).toEqual(p);
        const ship = node(store, id("Ship"));
        const track = node(store, id("Track"));
        expect(track.y).toBeGreaterThan(ship.y + ship.h);
        expect(centreX(track)).toBe(centreX(ship));
        sync.stop();
    });
});

describe("keepPlaced", () => {
    it("puts back every box and bend that was there, and places only the new", () => {
        const a = createNode({ shape: "process", x: 500, y: 0, text: "A" });
        const b = createNode({ shape: "process", x: 0, y: 300, text: "B" });
        const e = {
            ...createEdge({ from: { nodeId: a.id }, to: { nodeId: b.id } }),
            waypoints: [{ x: 250, y: 150 }],
        };
        const before = { ...createPage(), nodes: [a, b], edges: [e] };
        const c = createNode({ shape: "process", x: 0, y: 0, text: "C" });
        const relaid = tidyChart(
            {
                ...before,
                nodes: [a, b, c],
                edges: [
                    { ...e, waypoints: [] },
                    createEdge({ from: { nodeId: b.id }, to: { nodeId: c.id } }),
                ],
            },
            [a.id]
        );
        const kept = keepPlaced(before, relaid);
        expect(at(kept.nodes[0]!)).toEqual(at(a));
        expect(at(kept.nodes[1]!)).toEqual(at(b));
        expect(kept.edges[0]!.waypoints).toEqual([{ x: 250, y: 150 }]);
        expect(kept.nodes[2]!.y).toBeGreaterThan(b.y + b.h);
    });
});
