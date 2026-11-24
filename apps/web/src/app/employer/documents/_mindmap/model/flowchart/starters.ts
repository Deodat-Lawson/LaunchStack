/**
 * A template's starter boxes and arrows, in the look a box or an arrow added
 * to the same board gets.
 *
 * Templates are drawn by hand in `model/templates.ts`, outlined and in
 * assorted sizes and weights, and the theme pass then hands their boxes the
 * theme's colour cycle — so the Flowchart template opened as six different
 * colours, and the first step anyone added next to them looked like it came
 * from another tool (2026-11-23). On a document worked as a flowchart or a
 * board, every starter box now wears `flowchartLook` exactly as a new one
 * does: coloured by its kind, no outline, its own lines in the deeper tone of
 * its colour, 15px regular type; every arrow is in the board's soft ink.
 *
 * What stays a template's own:
 * - where things are, and how a box's words are aligned (an entity's field
 *   list, a card's top-left) — that is layout, not look;
 * - a colour that marks a *stage*: a timeline's milestones and a customer
 *   journey's columns take the colour of their stage (`stageShape`);
 * - a sticky note's colour, which marks its column on a brainstorm board;
 * - frames (a SWOT quadrant's colour is its meaning), text marks, and shapes
 *   drawn in lines (a timeline's spine, a fishbone's bones);
 * - an arrow's ends and route (an ERD's crow's feet, an org chart's plain
 *   lines). Lanes and Kanban columns are paper (`LANE_PAPER`), so the steps
 *   in them are what reads.
 */

import { nodeCenter } from "../geometry";
import { branchSwatch, LANE_PAPER, neutralsFor, type ThemeMode } from "../palette";
import { shapeDef } from "../shapes";
import type { DiagramEdge, DiagramNode, DiagramPage, MindmapDoc, ShapeId } from "../types";
import { dressBox, drawnInLines, flowchartLook } from "./look";

export interface StarterOptions {
    /**
     * The shape that marks a template's stages, left to right — a journey's
     * chevrons, a timeline's milestones. Each box takes the colour of the
     * stage it stands under. Without it, every box is coloured by its kind.
     */
    stageShape?: ShapeId;
}

const LANES: ReadonlySet<ShapeId> = new Set<ShapeId>(["swimlane-h", "swimlane-v"]);

/** Every page of a template's document, its starters in the flowchart look. */
export function dressStarters(
    doc: MindmapDoc,
    mode: ThemeMode,
    opts: StarterOptions = {}
): MindmapDoc {
    return { ...doc, pages: doc.pages.map(page => dressPage(page, mode, opts)) };
}

function dressPage(page: DiagramPage, mode: ThemeMode, opts: StarterOptions): DiagramPage {
    const stageOf = stageFinder(page, opts.stageShape);
    const edge = flowchartLook.edgeLook(mode);
    return {
        ...page,
        nodes: page.nodes.map(nd => dressNode(nd, mode, stageOf(nd))),
        edges: page.edges.map(
            (e): DiagramEdge => ({
                ...e,
                style: {
                    ...e.style,
                    stroke: edge.style.stroke ?? e.style.stroke,
                    strokeWidth: edge.style.strokeWidth ?? e.style.strokeWidth,
                },
                textStyle: { ...e.textStyle, ...edge.text },
            })
        ),
    };
}

function dressNode(nd: DiagramNode, mode: ThemeMode, stage: number | null): DiagramNode {
    if (LANES.has(nd.shape)) {
        return {
            ...nd,
            style: { ...nd.style, ...LANE_PAPER[mode] },
            textStyle: { ...nd.textStyle, color: neutralsFor(mode).ink },
        };
    }
    if (shapeDef(nd.shape).container || nd.shape === "text" || drawnInLines(nd.shape)) {
        return nd;
    }
    const dressed = dressBox(flowchartLook, nd, mode, { keepSize: true });
    // Layout, not look: an entity's fields and a card's notes stay where the
    // template set them.
    const textStyle = {
        ...dressed.textStyle,
        align: nd.textStyle.align,
        valign: nd.textStyle.valign,
    };
    if (nd.shape === "sticky") {
        return { ...dressed, style: { ...dressed.style, fill: nd.style.fill }, textStyle };
    }
    if (stage === null) return { ...dressed, textStyle };
    const sw = branchSwatch(stage + 1, mode);
    // A dot on a timeline is the stage's colour itself; a box, its tint.
    const style =
        nd.shape === "connector-dot"
            ? { ...dressed.style, fill: sw.stroke, stroke: sw.stroke }
            : { ...dressed.style, fill: sw.fill, stroke: sw.stroke };
    return { ...dressed, style, textStyle: { ...textStyle, color: sw.ink } };
}

/**
 * Which stage a box stands under: the marker (`stageShape`) whose centre is
 * nearest its own, left to right. Null on a template without stages.
 */
function stageFinder(
    page: DiagramPage,
    stageShape: ShapeId | undefined
): (nd: DiagramNode) => number | null {
    if (!stageShape) return () => null;
    const centres = page.nodes
        .filter(nd => nd.shape === stageShape)
        .map(nd => nodeCenter(nd).x)
        .sort((a, b) => a - b);
    if (centres.length === 0) return () => null;
    return nd => {
        const x = nodeCenter(nd).x;
        let best = 0;
        for (let i = 1; i < centres.length; i++) {
            if (Math.abs(centres[i]! - x) < Math.abs(centres[best]! - x)) best = i;
        }
        return best;
    };
}
