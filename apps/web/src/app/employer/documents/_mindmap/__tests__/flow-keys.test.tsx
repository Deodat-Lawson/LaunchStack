/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { commitNodeText, insertShape, previewTextGrowth } from "../model/commands";
import { activePage, graphIndex, nodeById } from "../model/doc";
import { createEdge, createNode, createPage } from "../model/factory";
import { rectsIntersect } from "../model/geometry";
import { EditorStore, type EditorState } from "../model/store";
import { buildTemplate } from "../model/templates";
import type { DiagramNode, DiagramPage } from "../model/types";
import { renderWithLocale } from "~/i18n/testing/render";

import { EditorProvider, useEditor } from "../ui/EditorContext";
import { TextEditorOverlay } from "../ui/TextEditorOverlay";
import { useKeyboard, type KeyboardActions } from "../ui/useKeyboard";
import { viewportToShow } from "../flow/keys/actions";
import {
    branchLabel,
    isQuestion,
    removeStepJoining,
    tidyChart,
    treePositions,
    walkFrom,
} from "../model/flowchart/arrange";
import { EmptyFlowHint, FlowOverlay } from "../flow";
import { flowchartLook } from "../model/flowchart/look";

/**
 * The flowchart's keys, driven the way a person drives them: keys go to
 * whatever has focus — the label field while typing, the page otherwise —
 * through the editor's real window listener and the real label field, with
 * the flowchart's hooks answering first. The stage overlay is mounted because
 * it is what hands the handlers the stage size and the branch words.
 */

const STAGE = { w: 1000, h: 700 };

beforeAll(() => {
    // jsdom has no canvas; text is measured by the model's fallback.
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    // Keyboard steps glide the view to a new box; reduced motion makes that
    // immediate, so no animation frame outlives a test.
    window.matchMedia = ((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
});

function KeyboardHost({ store }: { store: EditorStore }) {
    const actions: KeyboardActions = {
        isActive: () => true,
        onSave: () => undefined,
        onFind: () => undefined,
        onCommandPalette: () => undefined,
        onExport: () => undefined,
        onTogglePresent: () => undefined,
        onShowShortcuts: () => undefined,
        onEditSelection: () => {
            const node = store.getState().selection.find(s => s.kind === "node");
            if (node) store.setEditing({ kind: "node", id: node.id });
        },
        getViewportSize: () => STAGE,
    };
    useKeyboard(store, actions);
    return null;
}

const selectEmpty = (s: EditorState) => activePage(s.doc).nodes.length === 0;

/** The empty-board hint, shown while the page is empty, as the editor shows it. */
function EmptyOnly() {
    return useEditor(selectEmpty) ? <EmptyFlowHint onPasteOutline={() => undefined} /> : null;
}

function mount(store = flowStore()) {
    const view = render(
        <EditorProvider store={store}>
            <TextEditorOverlay />
            <KeyboardHost store={store} />
            <FlowOverlay canvasSize={STAGE} />
            <EmptyOnly />
        </EditorProvider>
    );
    return { store, view };
}

function flowStore(board: "light" | "dark" = "light"): EditorStore {
    const store = new EditorStore(buildTemplate("blank", "Flow", board));
    store.setViewport({ x: -STAGE.w / 2, y: -STAGE.h / 2, zoom: 1 });
    return store;
}

/** A key pressed wherever focus is. Returns false when it was default-prevented. */
function press(key: string, init: Partial<KeyboardEventInit> = {}): boolean {
    return fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
}

function field(): HTMLTextAreaElement {
    const el = document.querySelector<HTMLTextAreaElement>("textarea[data-mindmap-editor]");
    if (!el) throw new Error("label editor not mounted");
    return el;
}

function type(text: string) {
    fireEvent.change(field(), { target: { value: text } });
}

const page = (store: EditorStore) => activePage(store.getState().doc);
const node = (store: EditorStore, id: string) => nodeById(page(store), id)!;
const byText = (store: EditorStore, text: string) =>
    page(store).nodes.find(nd => nd.text === text)!;
const editingId = (store: EditorStore) => store.getState().editing?.id ?? null;
const selected = (store: EditorStore) => store.selectedNodeIds();
const centreX = (nd: DiagramNode) => nd.x + nd.w / 2;
const labelOf = (store: EditorStore, from: string, to: string) =>
    page(store).edges.find(e => e.from.nodeId === from && e.to.nodeId === to)?.labels[0]?.text ??
    "";

function noOverlaps(p: DiagramPage) {
    for (const a of p.nodes) {
        for (const b of p.nodes) {
            if (a.id < b.id) expect(rectsIntersect(a, b)).toBe(false);
        }
    }
}

/** Type the first step onto an empty board, then each next one after a Tab. */
function typeChain(store: EditorStore, steps: string[]) {
    press(steps[0]![0]!);
    type(steps[0]!);
    for (const step of steps.slice(1)) {
        press("Tab");
        type(step);
    }
}

afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
});

describe("one look for every box", () => {
    it("a step is a 168 × 64 box with 15px regular text and no outline", () => {
        const look = flowchartLook.boxLook("process", "light");
        expect(look.size).toEqual({ w: 168, h: 64 });
        expect(look.style).toMatchObject({ stroke: "none", strokeWidth: 0, radius: 12 });
        expect(look.text).toMatchObject({ size: 15, bold: false, italic: false });
        expect(flowchartLook.boxLook("decision", "light").size).toEqual({ w: 168, h: 104 });
    });

    it("leaves frames and text marks their own colours", () => {
        expect(flowchartLook.boxLook("frame", "light").style).toEqual({});
        expect(flowchartLook.boxLook("text", "dark").style).toEqual({});
    });

    it("a long label wraps and the box grows down, never wider", () => {
        const store = flowStore();
        const id = insertShape(store, "process", { x: 0, y: 0 });
        const start = node(store, id);
        const words = "Check the customer's credit limit against the order total";
        previewTextGrowth(store, start, words);
        expect(node(store, id).w).toBe(168);
        commitNodeText(store, start, words);
        expect(node(store, id).w).toBe(168);
        expect(node(store, id).h).toBeGreaterThan(64);
    });

    it("leaves a freeform drawing's growth as it was", () => {
        const store = new EditorStore(buildTemplate("blank", "Flow", "light"));
        store.update(d => ({ ...d, settings: { ...d.settings, kind: "freeform" } }), {
            transient: true,
        });
        const id = insertShape(store, "process", { x: 0, y: 0 });
        const start = node(store, id);
        commitNodeText(store, start, "Check the customer's credit limit against the order total");
        expect(node(store, id).w).toBeGreaterThan(start.w);
    });
});

describe("an empty board", () => {
    it("starts the chart with the key that was typed, in the middle of the stage", () => {
        const { store } = mount();
        expect(screen.getByText("Start your flowchart")).toBeInTheDocument();
        press("R");
        const [first] = page(store).nodes;
        expect(first).toBeDefined();
        expect(editingId(store)).toBe(first!.id);
        expect(field().value).toBe("R");
        expect(first!.shape).toBe("process");
        expect(centreX(first!)).toBeCloseTo(0);
        expect(first!.y + first!.h / 2).toBeCloseTo(0);
    });

    it("a click on the ghost starts it empty", () => {
        const { store } = mount();
        fireEvent.click(screen.getByRole("button", { name: "Type your first step" }));
        expect(page(store).nodes).toHaveLength(1);
        expect(field().value).toBe("");
    });

    it("Enter, or an input method's first key, starts it empty for the words to go into", () => {
        const { store } = mount();
        press("Enter");
        expect(page(store).nodes).toHaveLength(1);
        expect(field().value).toBe("");
        const other = mount(flowStore()).store;
        (document.activeElement as HTMLElement | null)?.blur?.();
        press("Process");
        expect(page(other).nodes).toHaveLength(1);
    });

    it("leaves Space and the shortcuts key alone", () => {
        const { store } = mount();
        press(" ");
        press("?");
        expect(page(store).nodes).toHaveLength(0);
    });
});

describe("Tab adds the next step below", () => {
    it("while typing: finishes the label, adds a joined step below it, label open", () => {
        const { store } = mount();
        typeChain(store, ["Receive order", "Check stock"]);
        const a = byText(store, "Receive order");
        const b = node(store, editingId(store)!);
        expect(graphIndex(page(store)).out.get(a.id)).toEqual([b.id]);
        expect(b.y).toBeGreaterThan(a.y + a.h);
        expect(centreX(b)).toBe(centreX(a));
        expect(b.textStyle).toMatchObject({ size: 15, bold: false });
    });

    it("with a box selected, the same", () => {
        const { store } = mount();
        typeChain(store, ["Receive order"]);
        press("Enter");
        const a = byText(store, "Receive order");
        expect(selected(store)).toEqual([a.id]);
        press("Tab");
        const b = node(store, editingId(store)!);
        expect(b.y).toBeGreaterThan(a.y + a.h);
        expect(centreX(b)).toBe(centreX(a));
    });

    it("keeps the first box where it is and is one undo step", () => {
        const { store } = mount();
        typeChain(store, ["Receive order"]);
        press("Enter");
        const before = page(store);
        const first = byText(store, "Receive order");
        press("Tab");
        expect(byText(store, "Receive order")).toMatchObject({ x: first.x, y: first.y });
        act(() => store.undo());
        expect(page(store).nodes).toEqual(before.nodes);
    });

    it("brings a new step below the stage into view", () => {
        const { store } = mount();
        typeChain(store, ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"]);
        const last = node(store, editingId(store)!);
        const v = store.getState().viewport;
        expect((last.y + last.h - v.y) * v.zoom).toBeLessThanOrEqual(STAGE.h);
        expect(viewportToShow(store, last.id, STAGE)).toBeNull();
    });
});

describe("⇧Tab adds a branch beside", () => {
    it("a sibling right after the current step, sharing its parent", () => {
        const { store } = mount();
        typeChain(store, ["Start", "Left", "Right"]);
        const start = byText(store, "Start");
        const left = byText(store, "Left");
        press("Escape");
        act(() => store.selectNodes([left.id]));
        // The arrows: Left → Right, so go back up and branch from Left.
        press("Tab", { shiftKey: true });
        const branch = node(store, editingId(store)!);
        expect(graphIndex(page(store)).in.get(branch.id)).toEqual([start.id]);
        expect(graphIndex(page(store)).out.get(start.id)).toEqual([left.id, branch.id]);
        expect(branch.y).toBe(node(store, left.id).y);
        expect(branch.x).toBeGreaterThan(node(store, left.id).x + node(store, left.id).w);
        noOverlaps(page(store));
    });

    it("while typing, too", () => {
        const { store } = mount();
        typeChain(store, ["Start", "Yes path"]);
        press("Tab", { shiftKey: true });
        type("Other path");
        press("Enter");
        const start = byText(store, "Start");
        expect(graphIndex(page(store)).out.get(start.id)).toEqual([
            byText(store, "Yes path").id,
            byText(store, "Other path").id,
        ]);
    });

    it("on a box nothing leads into, is Tab", () => {
        const { store } = mount();
        typeChain(store, ["Start"]);
        press("Tab", { shiftKey: true });
        const next = node(store, editingId(store)!);
        expect(graphIndex(page(store)).in.get(next.id)).toEqual([byText(store, "Start").id]);
    });
});

describe("a question becomes a decision", () => {
    it("on commit, in the same undo step as the words, centred where it was", () => {
        const { store } = mount();
        typeChain(store, ["Check stock", "In stock?"]);
        const id = editingId(store)!;
        const before = node(store, id);
        press("Enter");
        const after = node(store, id);
        expect(after).toMatchObject({ shape: "decision", w: 168, h: 104, text: "In stock?" });
        expect(centreX(after)).toBe(centreX(before));
        act(() => store.undo());
        expect(node(store, id)).toMatchObject({ shape: "process", text: "" });
    });

    it("Tab from it labels the first branch Yes, the second No, then nothing", () => {
        const { store } = mount();
        typeChain(store, ["In stock?", "Pack and ship"]);
        const q = byText(store, "In stock?");
        press("Escape");
        act(() => store.selectNodes([q.id]));
        press("Tab");
        type("Order more");
        press("Escape");
        act(() => store.selectNodes([q.id]));
        press("Tab");
        type("Ask the customer");
        const kids = graphIndex(page(store)).out.get(q.id)!;
        expect(kids.map(k => labelOf(store, q.id, k))).toEqual(["Yes", "No", ""]);
        expect(kids.map(k => node(store, k).shape)).toEqual(["process", "process", "process"]);
        const yes = page(store).edges.find(e => e.labels[0]?.text === "Yes")!;
        expect(yes.textStyle).toMatchObject({ size: 12, bold: false });
        noOverlaps(page(store));
    });

    it("⇧Tab on the Yes branch makes the No branch beside it", () => {
        const { store } = mount();
        typeChain(store, ["In stock?", "Pack and ship"]);
        press("Tab", { shiftKey: true });
        type("Order more");
        press("Enter");
        const q = byText(store, "In stock?");
        expect(labelOf(store, q.id, byText(store, "Pack and ship").id)).toBe("Yes");
        expect(labelOf(store, q.id, byText(store, "Order more").id)).toBe("No");
    });

    it("full-width question marks count; a decision losing its ? goes back to a step", () => {
        expect(isQuestion("有货吗？")).toBe(true);
        expect(isQuestion("Ship it ")).toBe(false);
        const { store } = mount();
        typeChain(store, ["Paid?"]);
        press("Enter");
        const id = byText(store, "Paid?").id;
        press("Enter");
        type("Take payment");
        press("Enter");
        expect(node(store, id)).toMatchObject({ shape: "process", w: 168, h: 64 });
    });
});

describe("branch words are the reader's", () => {
    it("labels a decision's branches in Chinese for a Chinese reader", () => {
        const store = flowStore();
        renderWithLocale(
            <EditorProvider store={store}>
                <TextEditorOverlay />
                <KeyboardHost store={store} />
                <FlowOverlay canvasSize={STAGE} />
            </EditorProvider>,
            "zh-CN"
        );
        typeChain(store, ["有货吗？", "发货"]);
        press("Tab", { shiftKey: true });
        type("补货");
        press("Enter");
        const q = byText(store, "有货吗？");
        expect(q.shape).toBe("decision");
        expect(labelOf(store, q.id, byText(store, "发货").id)).toBe("是");
        expect(labelOf(store, q.id, byText(store, "补货").id)).toBe("否");
    });
});

describe("the arrow keys walk the chart", () => {
    function decisionChart() {
        const mounted = mount();
        const { store } = mounted;
        typeChain(store, ["Receive order", "In stock?", "Pack and ship"]);
        press("Tab", { shiftKey: true });
        type("Order more");
        press("Escape");
        return store;
    }

    it("down to the first next step, up to the step before, sideways among siblings", () => {
        const store = decisionChart();
        const id = (t: string) => byText(store, t).id;
        act(() => store.selectNodes([id("Receive order")]));
        press("ArrowDown");
        expect(selected(store)).toEqual([id("In stock?")]);
        press("ArrowDown");
        expect(selected(store)).toEqual([id("Pack and ship")]);
        press("ArrowRight");
        expect(selected(store)).toEqual([id("Order more")]);
        press("ArrowLeft");
        expect(selected(store)).toEqual([id("Pack and ship")]);
        press("ArrowUp");
        expect(selected(store)).toEqual([id("In stock?")]);
    });

    it("does nothing where there is nowhere to go — no nudge either", () => {
        const store = decisionChart();
        const top = byText(store, "Receive order");
        act(() => store.selectNodes([top.id]));
        expect(press("ArrowUp")).toBe(false);
        press("ArrowLeft");
        expect(selected(store)).toEqual([top.id]);
        expect(byText(store, "Receive order")).toMatchObject({ x: top.x, y: top.y });
    });

    it("⌥ still nudges; with nothing selected an arrow picks the first step", () => {
        const store = decisionChart();
        const top = byText(store, "Receive order");
        act(() => store.selectNodes([top.id]));
        press("ArrowDown", { altKey: true });
        expect(byText(store, "Receive order").y).toBeGreaterThan(top.y);
        act(() => store.clearSelection());
        press("ArrowRight");
        expect(selected(store)).toEqual([top.id]);
    });

    it("Enter opens the selected step's label; Enter while typing finishes it", () => {
        const store = decisionChart();
        const q = byText(store, "In stock?");
        act(() => store.selectNodes([q.id]));
        press("Enter");
        expect(editingId(store)).toBe(q.id);
        press("Enter");
        expect(editingId(store)).toBeNull();
        expect(selected(store)).toEqual([q.id]);
    });
});

describe("Delete takes the step out and joins the line", () => {
    it("joins the step before to the steps after, keeps its label, lays out, selects the step before", () => {
        const { store } = mount();
        typeChain(store, ["In stock?", "Pack and ship", "Send invoice", "Done"]);
        press("Escape");
        const q = byText(store, "In stock?");
        const pack = byText(store, "Pack and ship");
        const invoice = byText(store, "Send invoice");
        act(() => store.selectNodes([pack.id]));
        press("Delete");
        expect(byText(store, "Pack and ship")).toBeUndefined();
        expect(graphIndex(page(store)).out.get(q.id)).toEqual([invoice.id]);
        expect(labelOf(store, q.id, invoice.id)).toBe("Yes");
        expect(selected(store)).toEqual([q.id]);
        expect(centreX(byText(store, "Send invoice"))).toBe(centreX(byText(store, "In stock?")));
        noOverlaps(page(store));
        act(() => store.undo());
        expect(byText(store, "Pack and ship")).toBeDefined();
    });

    it("Backspace too; a decision's branches go to the step before it, labels kept", () => {
        const { store } = mount();
        typeChain(store, ["Receive order", "In stock?", "Ship"]);
        press("Tab", { shiftKey: true });
        type("Reorder");
        press("Escape");
        const q = byText(store, "In stock?");
        const start = byText(store, "Receive order");
        act(() => store.selectNodes([q.id]));
        press("Backspace");
        const kids = graphIndex(page(store)).out.get(start.id)!;
        expect(kids).toEqual([byText(store, "Ship").id, byText(store, "Reorder").id]);
        expect(kids.map(k => labelOf(store, start.id, k))).toEqual(["Yes", "No"]);
    });

    it("Esc on a step that was never given words takes it back", () => {
        const { store } = mount();
        typeChain(store, ["Receive order", ""]);
        expect(page(store).nodes).toHaveLength(2);
        press("Escape");
        expect(page(store).nodes).toHaveLength(1);
        expect(selected(store)).toEqual([byText(store, "Receive order").id]);
    });
});

describe("the chart, as pure page edits", () => {
    const box = (id: string, w = 176, h = 56) => ({ id, w, h });

    it("a tree: chains straight, a parent centred over its first and last child", () => {
        const at = treePositions(
            [box("a"), box("q", 176, 96), box("y"), box("n"), box("y2")],
            [
                { from: "a", to: "q" },
                { from: "q", to: "y" },
                { from: "q", to: "n" },
                { from: "y", to: "y2" },
            ]
        )!;
        const cx = (id: string) => at.get(id)!.x + 88;
        expect(cx("a")).toBe(cx("q"));
        expect(cx("q")).toBe((cx("y") + cx("n")) / 2);
        expect(cx("y2")).toBe(cx("y"));
        expect(at.get("y")!.y).toBe(at.get("n")!.y);
    });

    it("is not a tree with a merge or a loop: the layered layout takes over", () => {
        const merge = [
            { from: "a", to: "b" },
            { from: "a", to: "c" },
            { from: "b", to: "d" },
            { from: "c", to: "d" },
        ];
        expect(
            treePositions(
                ["a", "b", "c", "d"].map(id => box(id)),
                merge
            )
        ).toBeNull();
        const nodes = ["a", "b", "c", "d"].map(id => ({
            ...createNode({ shape: "process", x: 0, y: 0, w: 176, h: 56 }),
            id,
        }));
        const edges = merge.map(m =>
            createEdge({ from: { nodeId: m.from }, to: { nodeId: m.to } })
        );
        const tidied = tidyChart({ ...createPage(), nodes, edges }, ["a"]);
        noOverlaps(tidied);
    });

    it("returns the page itself when nothing moves", () => {
        const store = flowStore();
        const a = insertShape(store, "process", { x: 0, y: 0 });
        const p = page(store);
        expect(tidyChart(p, [a])).toBe(p);
    });

    it("labels a decision's branches with the reader's words", () => {
        const q = { ...createNode({ shape: "decision", x: 0, y: 0 }), id: "q" };
        const p = { ...createPage(), nodes: [q] };
        expect(branchLabel(p, "q", { yes: "是", no: "否" })).toBe("是");
        expect(branchLabel(p, "q", { yes: "", no: "" })).toBe("");
    });

    it("walks nowhere from a lone box, and joins nothing when it has no neighbours", () => {
        const lone = { ...createNode({ shape: "process", x: 0, y: 0 }), id: "x" };
        const p = { ...createPage(), nodes: [lone] };
        expect(walkFrom(p, "x", "down")).toBeNull();
        expect(walkFrom(p, "x", "left")).toBeNull();
        expect(removeStepJoining(p, "x").page.nodes).toHaveLength(0);
    });
});

describe("the key legend", () => {
    it("lists the five keys and folds away to a button", () => {
        const { store } = mount();
        typeChain(store, ["Start"]);
        press("Enter");
        const legend = screen.getByRole("region", {
            name: "Keyboard shortcuts for drawing the chart",
        });
        for (const words of [
            "Next step",
            "Branch beside",
            "Question → decision",
            "Move around",
            "Remove step",
        ]) {
            expect(legend).toHaveTextContent(words);
        }
        fireEvent.click(screen.getByRole("button", { name: "Hide keys" }));
        expect(screen.queryByRole("region")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Show keys" }));
        expect(screen.getByRole("region")).toBeInTheDocument();
    });
});
