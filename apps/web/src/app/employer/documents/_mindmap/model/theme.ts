import { graphIndex, nodeById } from "./doc";
import {
    type DocTheme,
    neutralsFor,
    readableInkOn,
    stickyColors,
    stickyInk,
    swatchFor,
    swatchIdOf,
    THEME_BY_ID,
    themeFor,
} from "./palette";
import type {
    DiagramEdge,
    DiagramNode,
    DiagramPage,
    EdgeStyle,
    MindmapDoc,
    NodeStyle,
    TextStyle,
} from "./types";

/**
 * Painting a document — and every topic in it — in a named theme.
 *
 * Pure, and separate from `commands.ts`, because several callers need it: the
 * Theme picker (through the store, so it lands in history as one step),
 * template seeding (before a store exists at all), and every command that
 * adds or moves a topic. One function, `topicPaint`, decides what a topic
 * looks like from three facts — its depth, its branch, and the theme — so a
 * topic made with Tab, dragged out of a port, or repainted by the picker
 * cannot come out looking different.
 */

// ---------------------------------------------------------------------------
// Where a topic sits
// ---------------------------------------------------------------------------

const isTopic = (nd: DiagramNode | undefined): boolean => nd?.shape.startsWith("mind-") === true;

export interface TopicPlace {
    /** 0 for a central topic, 1 for a main branch, and so on outward. */
    depth: number;
    /** The main branch (depth 1) this topic hangs from; itself at depth 1; null at a root. */
    branchId: string | null;
    /** The main branch's position among its root's branches, in the order they were made. */
    branchIndex: number;
}

/**
 * The topic tree of a page: every topic's depth and main branch.
 *
 * Walked down from each root (a topic with no topic above it) through the
 * edges in document order — the order the layout lays branches out in, so
 * "the third branch" means the same thing to colour and to position. A
 * topic reachable twice keeps its first parent, as in the layout. Topics
 * outside the map — not topics at all — are absent.
 */
export function topicPlaces(page: DiagramPage): Map<string, TopicPlace> {
    const idx = graphIndex(page);
    const places = new Map<string, TopicPlace>();
    const topicParents = (id: string) =>
        (idx.in.get(id) ?? []).filter(p => p !== id && isTopic(nodeById(page, p)));

    const walk = (rootId: string) => {
        places.set(rootId, { depth: 0, branchId: null, branchIndex: 0 });
        let branchCount = 0;
        const queue: string[] = [rootId];
        while (queue.length) {
            const id = queue.shift()!;
            const here = places.get(id)!;
            for (const childId of idx.out.get(id) ?? []) {
                if (places.has(childId) || !isTopic(nodeById(page, childId))) continue;
                const depth = here.depth + 1;
                const place: TopicPlace =
                    depth === 1
                        ? { depth, branchId: childId, branchIndex: branchCount++ }
                        : { depth, branchId: here.branchId, branchIndex: here.branchIndex };
                places.set(childId, place);
                queue.push(childId);
            }
        }
    };

    for (const nd of page.nodes) {
        if (isTopic(nd) && topicParents(nd.id).length === 0) walk(nd.id);
    }
    // A loop with no way in has no root; its first member stands in for one
    // so every topic still gets a place.
    for (const nd of page.nodes) {
        if (isTopic(nd) && !places.has(nd.id)) walk(nd.id);
    }
    return places;
}

// ---------------------------------------------------------------------------
// What a topic looks like
// ---------------------------------------------------------------------------

export interface TopicPaint {
    style: Pick<NodeStyle, "fill" | "stroke" | "strokeWidth">;
    ink: string;
    /** The connector that leads *into* this topic. */
    edge: Pick<EdgeStyle, "stroke" | "strokeWidth">;
}

/**
 * The hierarchy ladder. Emphasis falls off from the centre outward — the
 * mind-map convention since Buzan (lines "thicker… becoming thinner as they
 * radiate out") and XMind's "colour intensity … from Center Topic to Main
 * Topic, gradually decreasing" — and it falls off in *weight*, so depth reads
 * without colour (WCAG 1.4.1):
 *
 * - **central topic** — solid fill in the theme's own hue, no outline, ink
 *   measured against it (`readableInkOn`), so it is legible whatever the hue;
 * - **main branch** — a tint of its branch hue with a 2px outline in the full
 *   hue and branch-coloured ink: the strongest *coloured* mark;
 * - **subtopic** — the paper itself with a 1.5px outline in the branch hue
 *   and the theme's neutral ink, so detail recedes and stops competing;
 * - **leaf (underline)** — no surface at all, a branch-coloured rule.
 *
 * Connectors take the branch hue and thin with depth: 3 → 2 → 1.5px.
 */
export function topicPaint(
    theme: DocTheme,
    shape: DiagramNode["shape"],
    depth: number,
    branchHue: string
): TopicPaint {
    const sw = swatchFor(branchHue, theme.mode);
    if (shape === "mind-root") {
        const fill = swatchFor(theme.root, theme.mode).stroke;
        return {
            style: { fill, stroke: "none", strokeWidth: 0 },
            ink: readableInkOn(fill),
            edge: { stroke: sw.stroke, strokeWidth: 3 },
        };
    }
    // A topic with nothing above it — dropped with the Topic tool, say — is
    // drawn as a main branch: it is the start of one, not a second centre.
    const level = Math.max(depth, 1);
    const edgeWidth = level === 1 ? 3 : level === 2 ? 2 : 1.5;
    if (shape === "mind-leaf") {
        return {
            style: { fill: "none", stroke: sw.stroke, strokeWidth: 1.5 },
            ink: theme.ink,
            edge: { stroke: sw.stroke, strokeWidth: edgeWidth },
        };
    }
    if (level === 1) {
        return {
            style: { fill: sw.fill, stroke: sw.stroke, strokeWidth: 2 },
            ink: sw.ink,
            edge: { stroke: sw.stroke, strokeWidth: edgeWidth },
        };
    }
    return {
        style: { fill: theme.background, stroke: sw.stroke, strokeWidth: 1.5 },
        ink: theme.ink,
        edge: { stroke: sw.stroke, strokeWidth: edgeWidth },
    };
}

/**
 * Type sizes for a topic made fresh at this depth. Not applied on repaint:
 * a theme is colour, and someone who enlarged a label keeps it.
 */
export function topicType(depth: number): Pick<TextStyle, "size" | "bold"> {
    if (depth <= 0) return { size: 18, bold: true };
    if (depth === 1) return { size: 15, bold: true };
    return { size: 13.5, bold: false };
}

/** The hue a main branch gets from the theme: the next one round the cycle. */
export function branchHueAt(theme: DocTheme, branchIndex: number): string {
    return theme.cycle[branchIndex % theme.cycle.length] ?? theme.root;
}

/**
 * The hue a topic should take when it is added or moved.
 *
 * This is the difference between adding to a map and repainting it. A new
 * subtopic matches its branch *as it is* — if someone recoloured that branch
 * red, the new detail is red too. A new main branch takes a hue none of its
 * siblings wear. (A theme switch, `applyThemeToPage`, is the opposite: a
 * request to replace every colour, so hues come from branch position there.)
 */
function hueFor(
    page: DiagramPage,
    theme: DocTheme,
    id: string,
    place: TopicPlace | undefined,
    fresh: boolean
): string {
    if (place?.branchId == null) return branchHueAt(theme, 0);
    if (place.depth === 1) return mainBranchHue(page, theme, id, fresh);
    const stroke = nodeById(page, place.branchId)?.style.stroke;
    return (stroke ? swatchIdOf(stroke) : null) ?? branchHueAt(theme, place.branchIndex);
}

/**
 * A main branch keeps a theme hue it already wears if no sibling shares it;
 * otherwise it takes the first theme hue none of its siblings wear, so adding
 * a branch never repeats a neighbour's colour while there are hues left. Once
 * the cycle is used up, it falls back to its position.
 */
function mainBranchHue(
    page: DiagramPage,
    theme: DocTheme,
    branchId: string,
    fresh: boolean
): string {
    const idx = graphIndex(page);
    const parent = (idx.in.get(branchId) ?? []).find(p => isTopic(nodeById(page, p)));
    const siblings = parent ? (idx.out.get(parent) ?? []) : [];
    const used = new Set(
        siblings
            .filter(id => id !== branchId)
            .map(id => swatchIdOf(nodeById(page, id)?.style.stroke ?? ""))
            .filter((hue): hue is string => hue !== null)
    );
    const own = swatchIdOf(nodeById(page, branchId)?.style.stroke ?? "");
    // A topic made a moment ago wears the factory's placeholder hue, not a
    // choice — keeping it would start a Forest map on blue. Only a topic that
    // already belonged somewhere keeps what it wore.
    if (!fresh && own && theme.cycle.includes(own) && !used.has(own)) return own;
    const free = theme.cycle.find(hue => !used.has(hue));
    if (free) return free;
    return branchHueAt(theme, Math.max(siblings.indexOf(branchId), 0));
}

function paintTopicNode(
    nd: DiagramNode,
    theme: DocTheme,
    place: TopicPlace | undefined,
    hue: string
): DiagramNode {
    const paint = topicPaint(theme, nd.shape, place?.depth ?? 0, hue);
    return {
        ...nd,
        style: { ...nd.style, ...paint.style },
        textStyle: { ...nd.textStyle, color: paint.ink },
    };
}

/** Every topic under `ids` (inclusive), following the tree downward. */
function withDescendants(page: DiagramPage, ids: readonly string[]): Set<string> {
    const idx = graphIndex(page);
    const out = new Set<string>();
    const stack = [...ids];
    while (stack.length) {
        const id = stack.pop()!;
        if (out.has(id) || !isTopic(nodeById(page, id))) continue;
        out.add(id);
        for (const child of idx.out.get(id) ?? []) stack.push(child);
    }
    return out;
}

/**
 * Paint these topics — and everything below them — for where they now sit:
 * a new subtopic, an outdented branch, a topic dragged out of a port. Their
 * connectors are repainted with them. Hues follow the branch as it is (see
 * `hueFor`), so this never undoes a deliberate recolour elsewhere.
 */
export function paintTopics(
    page: DiagramPage,
    ids: readonly string[],
    paletteId: string | null | undefined,
    opts: { retype?: boolean; fresh?: boolean } = {}
): DiagramPage {
    const theme = themeFor(paletteId, undefined);
    const painting = withDescendants(page, ids);
    if (painting.size === 0) return page;
    const places = topicPlaces(page);

    // Main branches first: their subtopics read the hue off them.
    const order = [...painting].sort(
        (a, b) => (places.get(a)?.depth ?? 0) - (places.get(b)?.depth ?? 0)
    );
    let next = page;
    for (const id of order) {
        const nd = nodeById(next, id);
        if (!nd) continue;
        const place = places.get(id);
        const hue = hueFor(next, theme, id, place, opts.fresh === true);
        const paint = topicPaint(theme, nd.shape, place?.depth ?? 0, hue);
        const coloured = paintTopicNode(nd, theme, place, hue);
        // A topic that moved level takes that level's type as well: an
        // outdented detail is a main branch now, so it gets 15px bold too.
        // Only a topic with a place in a tree, or a centre: one floating free
        // (double-clicked onto the canvas) keeps the size it was made with
        // rather than the centre's, which depth 0 would otherwise give it.
        const placed = nd.shape === "mind-root" || (place?.depth ?? 0) >= 1;
        const painted =
            opts.retype && placed && nd.shape !== "mind-leaf"
                ? {
                      ...coloured,
                      textStyle: { ...coloured.textStyle, ...topicType(place?.depth ?? 0) },
                  }
                : coloured;
        next = {
            ...next,
            nodes: next.nodes.map(n => (n.id === id ? painted : n)),
            edges: next.edges.map(e =>
                e.to.nodeId === id && isTopic(nodeById(next, e.from.nodeId ?? ""))
                    ? { ...e, style: { ...e.style, ...paint.edge } }
                    : e
            ),
        };
    }
    return next;
}

/**
 * Recolour one topic and its subtree in a chosen swatch, keeping each
 * topic's weight for its depth. Picking a colour for a main branch therefore
 * recolours the whole branch — its details and its connectors — instead of
 * leaving one odd box in the middle of an otherwise consistent limb.
 */
export function recolourTopics(
    page: DiagramPage,
    ids: readonly string[],
    swatchId: string,
    paletteId: string | null | undefined
): DiagramPage {
    const theme = themeFor(paletteId, undefined);
    const places = topicPlaces(page);
    // A centre is recoloured alone. Its "subtree" is the whole map, and
    // pouring one hue over every branch would erase what colour means here.
    const centres = ids.filter(id => places.get(id)?.depth === 0);
    const painting = new Set([
        ...centres,
        ...withDescendants(
            page,
            ids.filter(id => !centres.includes(id))
        ),
    ]);
    const nodes = page.nodes.map(nd => {
        if (!painting.has(nd.id)) return nd;
        if (nd.shape === "mind-root") {
            // The centre is filled with the hue itself, so its ink must be
            // measured again rather than borrowed from a swatch.
            const fill = swatchFor(swatchId, theme.mode).stroke;
            return {
                ...nd,
                style: { ...nd.style, fill, stroke: "none", strokeWidth: 0 },
                textStyle: { ...nd.textStyle, color: readableInkOn(fill) },
            };
        }
        return paintTopicNode(nd, theme, places.get(nd.id), swatchId);
    });
    const edges = page.edges.map(e => {
        const to = e.to.nodeId;
        if (!to || !painting.has(to) || nodeById(page, to)?.shape === "mind-root") return e;
        if (!isTopic(nodeById(page, e.from.nodeId ?? ""))) return e;
        const paint = topicPaint(theme, "mind-branch", places.get(to)?.depth ?? 1, swatchId);
        return { ...e, style: { ...e.style, ...paint.edge } };
    });
    return { ...page, nodes, edges };
}

// ---------------------------------------------------------------------------
// Whole-page repaint
// ---------------------------------------------------------------------------

/** Repaint one page: paper, every shape, every connector. */
export function applyThemeToPage(page: DiagramPage, themeId: string): DiagramPage {
    const theme = THEME_BY_ID[themeId];
    if (!theme) return page;
    const mode = theme.mode;
    const n = neutralsFor(mode);
    const stickies = stickyColors(mode);

    const places = topicPlaces(page);
    const hueOf = (id: string) => {
        const place = places.get(id);
        return place && place.branchId !== null
            ? branchHueAt(theme, place.branchIndex)
            : branchHueAt(theme, 0);
    };

    let cycleIndex = 0;
    const nodes = page.nodes.map(nd => {
        // A group is a bracket around other shapes and an image is its own
        // picture; neither has a surface to paint.
        if (nd.shape === "group" || nd.shape === "image") return nd;

        // A topic is coloured by its *branch*: a main branch and all its
        // details share a hue, so colour groups what belongs together and a
        // tidy map does not turn into confetti.
        if (isTopic(nd)) {
            return paintTopicNode(nd, theme, places.get(nd.id), hueOf(nd.id));
        }

        // Shapes with no fill are read straight off the paper — a caption, a
        // pen stroke, a rule. They take the theme's ink rather than a swatch.
        // This is the case that made a dark board unreadable: their ink used
        // to be skipped and stayed near-black.
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

        // Anything else — a flowchart's boxes — keeps the running cycle.
        const sw = swatchFor(theme.cycle[cycleIndex++ % theme.cycle.length]!, mode);
        return {
            ...nd,
            style: { ...nd.style, fill: sw.fill, stroke: sw.stroke },
            textStyle: { ...nd.textStyle, color: sw.ink },
        };
    });

    const byId = new Map(page.nodes.map(nd => [nd.id, nd]));
    const edges = page.edges.map((e): DiagramEdge => {
        const from = byId.get(e.from.nodeId ?? "");
        const to = byId.get(e.to.nodeId ?? "");
        const textStyle = { ...e.textStyle, color: n.inkSoft };
        if (to && isTopic(from) && isTopic(to) && to.shape !== "mind-root") {
            const paint = topicPaint(theme, to.shape, places.get(to.id)?.depth ?? 1, hueOf(to.id));
            return { ...e, style: { ...e.style, ...paint.edge }, textStyle };
        }
        return { ...e, style: { ...e.style, stroke: theme.edgeStroke }, textStyle };
    });

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
