import { activePage } from "../model/doc";
import {
    flowchartLook,
    flowchartToSteps,
    KINDS,
    parseSteps,
    stepsToFlowchart,
} from "../model/flowchart";
import { parseDoc } from "../model/serialize";
import { buildTemplate } from "../model/templates";
import type { DiagramPage } from "../model/types";

/**
 * The step language as the one way in and out of a flowchart: the Steps
 * panel, the agent tools and the published text all use `stepsToFlowchart`
 * and `flowchartToSteps`, in the product's look.
 */

const ORDER = [
    "Start",
    "Receive order",
    "In stock?",
    "  Yes: Pick and pack",
    "  No: Reorder -> Receive order",
    "Ship it",
    "End",
].join("\n");

function blankPage(): DiagramPage {
    return activePage(buildTemplate("blank", "Flow", "light"));
}

describe("stepsToFlowchart", () => {
    it("draws every step in the flowchart look, coloured by kind", () => {
        const { page, notes } = stepsToFlowchart(blankPage(), ORDER, "light");
        expect(notes).toEqual([]);
        const byText = new Map(page.nodes.map(n => [n.text, n]));
        const decision = byText.get("In stock?")!;
        const start = byText.get("Start")!;
        const step = byText.get("Receive order")!;
        expect(decision.shape).toBe("decision");
        expect(start.shape).toBe("terminator");
        expect(step.style.fill).toBe(flowchartLook.boxLook("process", "light").style.fill);
        expect(decision.style.fill).toBe(flowchartLook.boxLook("decision", "light").style.fill);
        for (const n of page.nodes) {
            expect(n.textStyle.bold).toBe(false);
            expect(n.textStyle.size).toBe(15);
            expect(n.style.stroke).toBe("none");
        }
        const labels = page.edges.map(e => e.labels[0]?.text).filter(Boolean);
        expect(labels).toEqual(expect.arrayContaining(["Yes", "No"]));
    });

    it("runs top to bottom", () => {
        const { page } = stepsToFlowchart(blankPage(), "One\nTwo\nThree", "light");
        const ys = ["One", "Two", "Three"].map(t => page.nodes.find(n => n.text === t)!.y);
        expect(ys[0]).toBeLessThan(ys[1]!);
        expect(ys[1]).toBeLessThan(ys[2]!);
    });

    it("keeps a box's id when its step is rewritten around it", () => {
        const first = stepsToFlowchart(blankPage(), "One\nTwo\nThree", "light");
        const twoId = first.page.nodes.find(n => n.text === "Two")!.id;
        const again = stepsToFlowchart(first.page, "Zero\nOne\nTwo\nThree", "light");
        expect(again.page.nodes.find(n => n.text === "Two")!.id).toBe(twoId);
        expect(again.page.nodes).toHaveLength(4);
    });

    it("reports what it could not use and applies the rest", () => {
        const { page, notes } = stepsToFlowchart(blankPage(), "One\n-> Nowhere", "light");
        expect(notes.length).toBeGreaterThan(0);
        expect(page.nodes.some(n => n.text === "One")).toBe(true);
    });
});

describe("flowchartToSteps", () => {
    it("writes a drawn chart back as the same steps", () => {
        const { page } = stepsToFlowchart(blankPage(), ORDER, "light");
        const { text, ids } = flowchartToSteps(page);
        const parsed = parseSteps(text);
        // Every step comes back; the order of a decision's branches follows the
        // page and is pinned where it matters (the agent tools' tests).
        expect([...parsed.steps.map(s => s.label)].sort()).toEqual(
            [...parseSteps(ORDER).steps.map(s => s.label)].sort()
        );
        expect(text).toMatch(/Yes: /);
        expect(text).toMatch(/No: /);
        expect(ids.every(id => id !== null)).toBe(true);
    });

    it("reads a chart it never wrote in the order it flows, Yes before No", () => {
        const { page } = stepsToFlowchart(blankPage(), ORDER, "light");
        expect(flowchartToSteps(page).text).toBe(ORDER);
        // The boxes' order on the page does not matter — the arrows' does.
        const shuffled = { ...page, nodes: [...page.nodes].reverse() };
        expect(flowchartToSteps(shuffled).text).toBe(ORDER);
    });

    it("keeps the order the branches' arrows were made", () => {
        const text = ["Paid?", "  No: Send a reminder", "  Yes: Ship it", "End"].join("\n");
        const { page } = stepsToFlowchart(blankPage(), text, "light");
        expect(flowchartToSteps(page).text).toBe(text);
    });
});

describe("the flowchart look", () => {
    it("turns a question into an amber decision and back", () => {
        const { page } = stepsToFlowchart(blankPage(), "Check stock", "light");
        const box = page.nodes[0]!;
        const patch = flowchartLook.afterText!(box, "In stock?", "light")!;
        expect(patch.shape).toBe("decision");
        expect(patch.style?.fill).toBe(flowchartLook.boxLook("decision", "light").style.fill);
        expect(patch.w).toBe(KINDS.decision!.size.w);
    });

    it("adds a plain step after a pill, a question or a note", () => {
        const { page } = stepsToFlowchart(blankPage(), "Start\nIn stock?", "light");
        for (const n of page.nodes) expect(flowchartLook.nextShape!(n)).toBe("process");
    });
});

describe("flowLayout", () => {
    it("starts a blank flowchart on auto and every template on manual", () => {
        expect(buildTemplate("blank", "Flow", "light").settings.flowLayout).toBe("auto");
        expect(buildTemplate("flowchart", "Flow", "light").settings.flowLayout).toBe("manual");
    });

    it("reads a document saved before the setting existed as manual", () => {
        const old = buildTemplate("blank", "Flow", "light");
        const settings: Partial<typeof old.settings> = { ...old.settings };
        delete settings.flowLayout;
        expect(parseDoc({ ...old, settings }).settings.flowLayout).toBe("manual");
        expect(parseDoc(old).settings.flowLayout).toBe("auto");
    });
});
