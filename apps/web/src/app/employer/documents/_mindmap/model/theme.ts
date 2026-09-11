import { graphIndex, nodeById } from "./doc";
import {
    neutralsFor,
    readableInkOn,
    stickyColors,
    stickyInk,
    swatchFor,
    THEME_BY_ID,
} from "./palette";
import type { DiagramPage, MindmapDoc } from "./types";

/**
 * Repainting a document in a named theme.
 *
 * Pure, and separate from `commands.ts`, because two callers need it: the
 * Theme picker (through the store, so it lands in history as one step) and
 * template seeding (before a store exists at all). Keeping it here also keeps
 * it unit-testable without React.
 */

/**
 * Depth of every shape that sits in a topic tree, walking up incoming edges.
 * Absent from the map means "not a topic" — a flowchart box, a loose sticky.
 */
function topicDepths(page: DiagramPage): Map<string, number> {
    const idx = graphIndex(page);
    const depths = new Map<string, number>();
    const isTopic = (id: string) => nodeById(page, id)?.shape.startsWith("mind-") === true;

    for (const nd of page.nodes) {
        if (!nd.shape.startsWith("mind-")) continue;
        let level = 0;
        let cur = nd.id;
        const seen = new Set<string>([cur]);
        while (level < 64) {
            const parent = (idx.in.get(cur) ?? []).find(p => isTopic(p) && !seen.has(p));
            if (!parent) break;
            seen.add(parent);
            cur = parent;
            level += 1;
        }
        depths.set(nd.id, level);
    }
    return depths;
}

/** Repaint one page: paper, every shape, every connector. */
export function applyThemeToPage(page: DiagramPage, themeId: string): DiagramPage {
    const theme = THEME_BY_ID[themeId];
    if (!theme) return page;
    const mode = theme.mode;
    const n = neutralsFor(mode);
    const stickies = stickyColors(mode);

    const depth = topicDepths(page);
    let cycleIndex = 0;
    const nodes = page.nodes.map(nd => {
        // A group is a bracket around other shapes and an image is its own
        // picture; neither has a surface to paint.
        if (nd.shape === "group" || nd.shape === "image") return nd;

        // Shapes with no fill are read straight off the paper — a caption, a
        // pen stroke, a rule, a subtopic's underline. They take the theme's
        // ink rather than a swatch. This is the case that made a dark board
        // unreadable: their ink used to be skipped and stayed near-black.
        if (nd.style.fill === "none") {
            return {
                ...nd,
                style: {
                    ...nd.style,
                    stroke: nd.style.stroke === "none" ? "none" : n.hairline,
                },
                textStyle: { ...nd.textStyle, color: n.ink },
            };
        }

        if (nd.shape === "sticky") {
            const pick = stickies[cycleIndex % stickies.length]!;
            cycleIndex += 1;
            return {
                ...nd,
                style: { ...nd.style, fill: pick },
                textStyle: { ...nd.textStyle, color: stickyInk(mode) },
            };
        }

        // A mindmap is coloured by *depth*, not by document order: a branch
        // and its details belong together, and cycling the palette down the
        // node array instead turns a tidy map into confetti. Anything not in
        // the topic tree — a flowchart's boxes — keeps the running cycle.
        const level = depth.get(nd.id);
        const key =
            level === undefined
                ? theme.cycle[cycleIndex++ % theme.cycle.length]!
                : theme.cycle[level % theme.cycle.length]!;
        const sw = swatchFor(key, mode);
        // A root topic is filled with the swatch's *stroke* — the saturated
        // tone — so it reads as the anchor of the map.
        const isRoot = nd.shape === "mind-root";
        const fill = isRoot ? sw.stroke : sw.fill;
        return {
            ...nd,
            style: { ...nd.style, fill, stroke: isRoot ? "none" : sw.stroke },
            // The root's ink is measured against the fill it actually got,
            // which differs per theme — Ocean's root is blue, Ember's is
            // orange, and near-white is only right on some of them.
            textStyle: { ...nd.textStyle, color: isRoot ? readableInkOn(fill) : sw.ink },
        };
    });

    const edges = page.edges.map(e => ({
        ...e,
        style: { ...e.style, stroke: theme.edgeStroke },
        textStyle: { ...e.textStyle, color: n.inkSoft },
    }));

    return { ...page, nodes, edges, background: { ...page.background, color: theme.background } };
}

/**
 * Repaint the whole document. Every page, not just the active one — a theme is
 * a property of the document, and leaving page 2 on the old palette is not a
 * choice anyone makes on purpose; it stays invisible until they switch pages.
 */
export function applyThemeToDoc(doc: MindmapDoc, themeId: string): MindmapDoc {
    if (!THEME_BY_ID[themeId]) return doc;
    return {
        ...doc,
        pages: doc.pages.map(page => applyThemeToPage(page, themeId)),
        settings: { ...doc.settings, paletteId: themeId },
    };
}
