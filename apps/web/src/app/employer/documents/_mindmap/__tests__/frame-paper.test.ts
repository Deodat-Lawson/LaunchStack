import { createNode, createDoc, createPage } from "../model/factory";
import { FRAME_PAPER, SWATCH_BY_ID } from "../model/palette";
import { applyThemeToDoc } from "../model/theme";

/**
 * A frame left as plain paper — a phase or a lane around steps, as a frame
 * placed from the palette is — stays plain paper when the board is relit or
 * rethemed. A frame someone coloured (a SWOT quadrant) takes the theme's
 * colours, as before.
 */

function boardWith(...frames: ReturnType<typeof createNode>[]) {
    return createDoc("Frames", [{ ...createPage("Page 1"), nodes: frames }]);
}

describe("paper frames", () => {
    test("stay paper in the other lighting, in that lighting's tone", () => {
        const paper = createNode({ shape: "frame", x: 0, y: 0, mode: "light" });
        expect(paper.style.fill).toBe(FRAME_PAPER.light.fill);
        const dark = applyThemeToDoc(boardWith(paper), "midnight").pages[0]!.nodes[0]!;
        expect(dark.style.fill).toBe(FRAME_PAPER.dark.fill);
        expect(dark.style.stroke).toBe(FRAME_PAPER.dark.stroke);
        const back = applyThemeToDoc(boardWith(dark), "default").pages[0]!.nodes[0]!;
        expect(back.style.fill).toBe(FRAME_PAPER.light.fill);
    });

    test("a coloured frame still takes the theme's colours", () => {
        const green = SWATCH_BY_ID.green!;
        const quadrant = createNode({
            shape: "frame",
            x: 0,
            y: 0,
            style: { fill: green.fill, stroke: green.stroke },
        });
        const dark = applyThemeToDoc(boardWith(quadrant), "midnight").pages[0]!.nodes[0]!;
        expect(dark.style.fill).not.toBe(FRAME_PAPER.dark.fill);
        expect(dark.style.fill).not.toBe(green.fill);
    });
});
