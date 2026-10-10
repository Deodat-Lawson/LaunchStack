import { createDoc, createEdge, createNode, createPage } from "../model/factory";
import {
    contrastRatio,
    DARK_SWATCHES,
    isDarkSurface,
    readableInkOn,
    relativeLuminance,
    stickyColors,
    swatchFor,
    SWATCHES,
    THEMES,
    themeMode,
} from "../model/palette";
import { buildTemplate } from "../model/templates";
import { applyThemeToDoc, topicPaint, topicPlaces } from "../model/theme";
import type { MindmapDoc } from "../model/types";

/**
 * The theme system's contract.
 *
 * These are the assertions that stop a board from becoming unreadable again.
 * The contrast ones are properties over the whole palette rather than spot
 * checks, so adding a swatch or a theme cannot quietly ship something nobody
 * can read — which is exactly how the dark boards went wrong the first time.
 */

/**
 * WCAG AA: 4.5:1 for body text, 3:1 for large text (≥24px, or ≥18.66px bold)
 * and for the outlines and lines that carry meaning (1.4.11). Every topic
 * label is under the large threshold — the central topic is 18px bold — so
 * every label is held to 4.5:1.
 */
const AA_BODY = 4.5;
const AA_LARGE = 3;
const NON_TEXT = 3;

/** Perceptual distance (OKLab ΔE) between two `oklch()` colours. */
function deltaE(a: string, b: string): number {
    const lab = (css: string) => {
        const [, l, c, h] = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(css)!;
        const rad = (Number(h) * Math.PI) / 180;
        return [Number(l), Number(c) * Math.cos(rad), Number(c) * Math.sin(rad)];
    };
    const [l1, a1, b1] = lab(a);
    const [l2, a2, b2] = lab(b);
    return Math.hypot(l1! - l2!, a1! - a2!, b1! - b2!);
}

describe("relativeLuminance", () => {
    it("agrees with the WCAG anchors", () => {
        expect(relativeLuminance("oklch(1 0 0)")).toBeCloseTo(1, 2);
        expect(relativeLuminance("oklch(0 0 0)")).toBeCloseTo(0, 2);
        expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 3);
        expect(relativeLuminance("#000000")).toBeCloseTo(0, 3);
    });

    it("puts white against black at the full 21:1", () => {
        expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    });

    it("returns null rather than guessing at a notation it cannot read", () => {
        expect(relativeLuminance("rebeccapurple")).toBeNull();
        expect(relativeLuminance("")).toBeNull();
    });
});

describe("isDarkSurface", () => {
    it("reads the lightness out of an oklch paper", () => {
        expect(isDarkSurface("oklch(0.19 0.018 285)")).toBe(true);
        expect(isDarkSurface("oklch(0.992 0.003 80)")).toBe(false);
    });

    it("handles hex, which is the other notation a document can hold", () => {
        expect(isDarkSurface("#111111")).toBe(true);
        expect(isDarkSurface("#ffffff")).toBe(false);
    });

    it("treats an unreadable value as light, the safe guess for a canvas", () => {
        expect(isDarkSurface("papayawhip")).toBe(false);
    });
});

describe("swatch contrast", () => {
    it.each([
        ["light", SWATCHES],
        ["dark", DARK_SWATCHES],
    ] as const)("%s swatches keep their ink readable on their own fill", (_mode, set) => {
        for (const sw of set) {
            expect({ id: sw.id, ratio: +contrastRatio(sw.ink, sw.fill).toFixed(2) }).toEqual({
                id: sw.id,
                ratio: expect.any(Number),
            });
            expect(contrastRatio(sw.ink, sw.fill)).toBeGreaterThanOrEqual(AA_BODY);
        }
    });

    it("picks whichever ink actually wins on a saturated fill", () => {
        // The root topic's fill is the swatch's stroke. On a dark board that is
        // a bright tone where near-white loses and near-black wins; on a light
        // board it is a mid tone where the opposite holds.
        for (const mode of ["light", "dark"] as const) {
            for (const sw of mode === "dark" ? DARK_SWATCHES : SWATCHES) {
                expect(contrastRatio(readableInkOn(sw.stroke), sw.stroke)).toBeGreaterThanOrEqual(
                    AA_LARGE
                );
            }
        }
    });
});

describe("document themes", () => {
    it("offers a light and a dark board", () => {
        expect(THEMES.some(t => t.mode === "light")).toBe(true);
        expect(THEMES.some(t => t.mode === "dark")).toBe(true);
    });

    it("names a paper whose lightness matches the mode it claims", () => {
        for (const theme of THEMES) {
            expect({ id: theme.id, dark: isDarkSurface(theme.background) }).toEqual({
                id: theme.id,
                dark: theme.mode === "dark",
            });
        }
    });

    it("keeps the theme's own ink readable on its paper", () => {
        for (const theme of THEMES) {
            expect(contrastRatio(theme.ink, theme.background)).toBeGreaterThanOrEqual(AA_BODY);
        }
    });

    it("keeps every cycled node colour readable on the theme's paper", () => {
        for (const theme of THEMES) {
            for (const id of theme.cycle) {
                const sw = swatchFor(id, theme.mode);
                // A node has to be distinguishable from the paper it sits on,
                // or the board is a field of invisible boxes.
                expect(contrastRatio(sw.stroke, theme.background)).toBeGreaterThanOrEqual(AA_LARGE);
            }
        }
    });

    it("keeps sticky ink readable on every sticky colour", () => {
        for (const mode of ["light", "dark"] as const) {
            for (const color of stickyColors(mode)) {
                const ink = readableInkOn(color);
                expect(contrastRatio(ink, color)).toBeGreaterThanOrEqual(AA_BODY);
            }
        }
    });

    it("resolves an unknown palette id to light rather than throwing", () => {
        expect(themeMode("no-such-theme")).toBe("light");
        expect(themeMode(null)).toBe("light");
    });
});

// ---------------------------------------------------------------------------
// applyThemeToDoc
// ---------------------------------------------------------------------------

function sampleDoc(): MindmapDoc {
    const root = createNode({ shape: "mind-root", x: 0, y: 0, text: "Root" });
    const branch = createNode({ shape: "mind-branch", x: 300, y: 0, text: "Branch" });
    const detail = createNode({ shape: "mind-branch", x: 600, y: 0, text: "Detail" });
    const caption = createNode({ shape: "text", x: 0, y: 300, text: "A caption" });
    const sticky = createNode({ shape: "sticky", x: 300, y: 300, text: "A note" });

    return createDoc("Test", [
        {
            ...createPage(),
            nodes: [root, branch, detail, caption, sticky],
            edges: [
                createEdge({
                    from: { nodeId: root.id, port: "auto" },
                    to: { nodeId: branch.id, port: "auto" },
                }),
                createEdge({
                    from: { nodeId: branch.id, port: "auto" },
                    to: { nodeId: detail.id, port: "auto" },
                }),
            ],
        },
    ]);
}

describe("applyThemeToDoc", () => {
    it.each(THEMES.map(t => [t.id, t.name] as const))(
        "leaves every label readable after switching to %s",
        themeId => {
            const doc = applyThemeToDoc(sampleDoc(), themeId);
            const page = doc.pages[0]!;
            for (const nd of page.nodes) {
                // An unfilled shape is read against the paper it sits on.
                const behind = nd.style.fill === "none" ? page.background.color : nd.style.fill;
                expect({
                    shape: nd.shape,
                    readable: contrastRatio(nd.textStyle.color, behind) >= AA_BODY,
                }).toEqual({ shape: nd.shape, readable: true });
            }
        }
    );

    it("recolours the ink of unfilled shapes, not just the ones with a surface", () => {
        // The bug this pins: a caption keeps `fill: none`, so it used to be
        // skipped entirely and kept near-black ink on a near-black board.
        const doc = applyThemeToDoc(sampleDoc(), "midnight");
        const caption = doc.pages[0]!.nodes.find(n => n.shape === "text")!;
        expect(caption.style.fill).toBe("none");
        expect(
            contrastRatio(caption.textStyle.color, doc.pages[0]!.background.color)
        ).toBeGreaterThan(AA_BODY);
    });

    it("shows depth by weight: root, branch and detail are three different surfaces", () => {
        const doc = applyThemeToDoc(sampleDoc(), "default");
        const page = doc.pages[0]!;
        const byText = (t: string) => page.nodes.find(n => n.text === t)!;
        const fills = [byText("Root"), byText("Branch"), byText("Detail")].map(n => n.style.fill);
        expect(new Set(fills).size).toBe(3);
        // …while the branch and its detail share one hue: colour is the branch.
        expect(byText("Detail").style.stroke).toBe(byText("Branch").style.stroke);
    });

    it("repaints every page, not only the active one", () => {
        const base = sampleDoc();
        const second = {
            ...createPage("Page 2"),
            nodes: [createNode({ shape: "mind-branch", x: 0, y: 0 })],
        };
        const doc = applyThemeToDoc({ ...base, pages: [...base.pages, second] }, "ember");
        for (const page of doc.pages) {
            expect(page.background.color).toBe(THEMES.find(t => t.id === "ember")!.background);
        }
    });

    it("records the theme it applied", () => {
        expect(applyThemeToDoc(sampleDoc(), "abyss").settings.paletteId).toBe("abyss");
    });

    it("leaves the document alone for an unknown theme", () => {
        const doc = sampleDoc();
        expect(applyThemeToDoc(doc, "chartreuse")).toBe(doc);
    });
});

// ---------------------------------------------------------------------------
// Colour by branch, depth by weight
// ---------------------------------------------------------------------------

describe("the central topic", () => {
    it.each(THEMES.map(t => [t.id] as const))("is legible and stands off the paper in %s", id => {
        const theme = THEMES.find(t => t.id === id)!;
        const root = topicPaint(theme, "mind-root", 0, theme.cycle[0]!);
        // The label clears body-text AA on the solid fill…
        expect(contrastRatio(root.ink, root.style.fill)).toBeGreaterThanOrEqual(AA_BODY);
        // …and the fill, which is the root's only edge, clears 3:1 on the paper.
        expect(contrastRatio(root.style.fill, theme.background)).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it("wears a hue no branch can take, in every theme", () => {
        for (const theme of THEMES) expect(theme.cycle).not.toContain(theme.root);
    });
});

describe("branch hues", () => {
    it("keep every depth readable and every outline and connector visible", () => {
        for (const theme of THEMES) {
            for (const hue of theme.cycle) {
                for (const depth of [1, 2, 3]) {
                    for (const shape of ["mind-branch", "mind-leaf"] as const) {
                        const p = topicPaint(theme, shape, depth, hue);
                        const behind = p.style.fill === "none" ? theme.background : p.style.fill;
                        const where = `${theme.id}/${hue}/${shape}@${depth}`;
                        expect({ where, ok: contrastRatio(p.ink, behind) >= AA_BODY }).toEqual({
                            where,
                            ok: true,
                        });
                        expect({
                            where,
                            ok: contrastRatio(p.style.stroke, theme.background) >= NON_TEXT,
                        }).toEqual({ where, ok: true });
                        expect({
                            where,
                            ok: contrastRatio(p.edge.stroke, theme.background) >= NON_TEXT,
                        }).toEqual({ where, ok: true });
                    }
                }
            }
        }
    });

    it("put neighbouring branches far enough apart to tell at a glance", () => {
        // 0.1 in OKLab is several times the just-noticeable difference; the
        // ordering alternates warm and cool so lightness differs as well as hue.
        for (const theme of THEMES) {
            if (theme.cycle.length < 2) continue;
            theme.cycle.forEach((hue, i) => {
                const next = theme.cycle[(i + 1) % theme.cycle.length]!;
                const d = deltaE(
                    swatchFor(hue, theme.mode).stroke,
                    swatchFor(next, theme.mode).stroke
                );
                expect({ pair: `${theme.id}:${hue}/${next}`, far: d >= 0.1 }).toEqual({
                    pair: `${theme.id}:${hue}/${next}`,
                    far: true,
                });
            });
        }
    });

    it("thin the connectors from the centre outward", () => {
        const theme = THEMES[0]!;
        const widths = [1, 2, 3].map(
            d => topicPaint(theme, "mind-branch", d, "blue").edge.strokeWidth
        );
        expect(widths).toEqual([...widths].sort((a, b) => b - a));
        expect(widths[0]).toBeGreaterThan(widths[2]!);
    });
});

describe("a fresh mindmap", () => {
    it.each([
        ["light", "default"],
        ["dark", "midnight"],
    ] as const)("gives each main branch its own hue on a %s board", (mode, themeId) => {
        const doc = buildTemplate("mindmap", "Map", mode);
        expect(doc.settings.paletteId).toBe(themeId);
        const page = doc.pages[0]!;
        const places = topicPlaces(page);
        const main = page.nodes.filter(n => places.get(n.id)?.depth === 1);
        expect(main).toHaveLength(4);
        expect(new Set(main.map(n => n.style.stroke)).size).toBe(4);

        for (const nd of page.nodes) {
            const place = places.get(nd.id)!;
            if (place.depth < 2) continue;
            const branch = page.nodes.find(n => n.id === place.branchId)!;
            // A detail wears its branch's hue, and so does the line into it.
            expect(nd.style.stroke).toBe(branch.style.stroke);
            const into = page.edges.find(e => e.to.nodeId === nd.id)!;
            expect(into.style.stroke).toBe(branch.style.stroke);
        }
    });
});
