import { insertShape } from "../model/commands";
import { activePage, nodeById, worksAsFlow } from "../model/doc";
import { tidyAll } from "../model/flowchart/arrange";
import { drawnInLines, flowchartLook, kindColours } from "../model/flowchart/look";
import { branchSwatch, LANE_PAPER } from "../model/palette";
import { shapeDef } from "../model/shapes";
import { EditorStore } from "../model/store";
import { buildTemplate, TEMPLATES } from "../model/templates";
import type { DiagramNode } from "../model/types";

/**
 * A template's starter boxes and arrows look exactly like the ones someone
 * adds to it. Until 2026-11-23 every template kept its hand-drawn outlines,
 * mixed sizes and bold, and the theme handed its boxes a rainbow of colours —
 * the Flowchart template's six boxes were six colours — so the first box
 * added beside them looked like it came from another tool.
 */

const MODES = ["light", "dark"] as const;
const FLOW_TEMPLATES = TEMPLATES.filter(t => worksAsFlow(buildTemplate(t.id, "T").settings.kind));
const STAGED = new Set(["timeline", "customer-journey"]);

/** A box someone could add: not a frame, a lane, a caption, a rule or a sticky note. */
const isBox = (nd: DiagramNode) =>
    !shapeDef(nd.shape).container &&
    nd.shape !== "text" &&
    nd.shape !== "sticky" &&
    !drawnInLines(nd.shape);

describe("which templates are dressed", () => {
    it("every flowchart and board template, and neither mindmap", () => {
        expect(FLOW_TEMPLATES.map(t => t.id).sort()).toEqual(
            [
                "architecture",
                "blank",
                "brainstorm",
                "customer-journey",
                "erd",
                "fishbone",
                "flowchart",
                "kanban",
                "org-chart",
                "swimlane",
                "swot",
                "timeline",
                "user-flow",
            ].sort()
        );
    });

    it("leaves a mindmap's topics painted by their branch", () => {
        const root = activePage(buildTemplate("mindmap", "M")).nodes.find(
            n => n.shape === "mind-root"
        )!;
        expect(root.style.fill).not.toBe(kindColours("mind-root", "light").fill);
        expect(root.textStyle.bold).toBe(true);
    });
});

describe.each(MODES)("starter boxes on a %s board", mode => {
    it.each(FLOW_TEMPLATES.map(t => t.id))("%s: every box looks like one added to it", id => {
        const doc = buildTemplate(id, "T", mode);
        const store = new EditorStore(doc);
        for (const nd of activePage(doc).nodes.filter(isBox)) {
            const where = `${id}/${nd.shape}/${nd.text.split("\n")[0]}`;
            const addedId = insertShape(store, nd.shape, { x: 9000, y: 9000 });
            const added = nodeById(activePage(store.getState().doc), addedId)!;
            // The look: no outline, a shadow, 15px regular type.
            expect([where, nd.style.strokeWidth, nd.style.shadow]).toEqual([where, 0, true]);
            expect([where, nd.textStyle.size, nd.textStyle.bold]).toEqual([where, 15, false]);
            if (STAGED.has(id)) {
                // Coloured by the stage it stands under, in the look's tones.
                const stage = [1, 2, 3, 4, 5].map(i => branchSwatch(i, mode));
                const sw = stage.find(s => s.fill === nd.style.fill || s.stroke === nd.style.fill);
                expect([where, sw !== undefined]).toEqual([where, true]);
                continue;
            }
            // Coloured by its kind, exactly as the same shape is when added.
            expect([where, nd.style.fill, nd.style.stroke, nd.textStyle.color]).toEqual([
                where,
                added.style.fill,
                added.style.stroke,
                added.textStyle.color,
            ]);
        }
    });

    it.each(FLOW_TEMPLATES.map(t => t.id))("%s: every arrow is in the board's soft ink", id => {
        const edge = flowchartLook.edgeLook(mode);
        for (const e of activePage(buildTemplate(id, "T", mode)).edges) {
            expect([id, e.style.stroke, e.style.strokeWidth]).toEqual([
                id,
                edge.style.stroke,
                edge.style.strokeWidth,
            ]);
            expect(e.textStyle.size).toBe(12);
        }
    });

    it.each(["swimlane", "kanban"])("%s: lanes and columns are paper, as a placed lane is", id => {
        const lanes = activePage(buildTemplate(id, "T", mode)).nodes.filter(n =>
            n.shape.startsWith("swimlane")
        );
        expect(lanes.length).toBeGreaterThan(0);
        for (const lane of lanes) expect(lane.style).toMatchObject(LANE_PAPER[mode]);
    });
});

describe("charts that arrange themselves start arranged", () => {
    it.each(["flowchart", "user-flow"])("%s opens laid out top to bottom", id => {
        const page = activePage(buildTemplate(id, "T"));
        const at = (p: typeof page) => p.nodes.map(n => [n.id, n.x, n.y]);
        // Arranging it again moves nothing: the first step added will not
        // shuffle every sample box.
        expect(at(tidyAll(page))).toEqual(at(page));
        const first = page.nodes.find(n => n.text === (id === "flowchart" ? "Start" : "Landing"))!;
        for (const n of page.nodes) expect(n.y).toBeGreaterThanOrEqual(first.y);
    });
});
