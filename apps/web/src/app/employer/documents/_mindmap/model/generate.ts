/**
 * Diagrams from text a model wrote.
 *
 * The AI side of the editor — Ask's `create_diagram`, the MCP tool of the
 * same name, "Generate with AI" in the gallery and "Expand with AI" on a
 * topic — never asks a model for coordinates or colours. It asks for what
 * models write well: an indented outline for anything shaped like a tree
 * (mindmaps, org charts, breakdowns) and Mermaid for flowcharts. This module
 * turns either into an ordinary document, built from the same factories,
 * painted by the same theme code and placed by the same layouts as a map
 * someone drew, so what comes back opens, edits, presents and publishes like
 * one.
 *
 * Pure: no React, no DOM, no server. Text measurement falls back to a
 * per-character estimate where there is no canvas (`text.ts`).
 */

import { createDoc, createEdge, createNode, createPage, defaultTextStyle } from "./factory";
import { normalizeOrigin, runAutoLayout } from "./template-helpers";
import { mermaidToDoc } from "./mermaid";
import { defaultThemeFor, type ThemeMode } from "./palette";
import { layoutText } from "./text";
import { applyThemeToDoc, topicType } from "./theme";
import type {
    AutoLayoutSetting,
    DiagramEdge,
    DiagramNode,
    DiagramPage,
    MindmapDoc,
    ShapeId,
    TextStyle,
} from "./types";

/** What kind of picture a spec asks for. */
export const DIAGRAM_TYPES = ["mindmap", "org_chart", "tree", "flowchart"] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

export function isDiagramType(value: unknown): value is DiagramType {
    return typeof value === "string" && (DIAGRAM_TYPES as readonly string[]).includes(value);
}

/** Bounds on what one generated diagram may hold. */
export const DIAGRAM_LIMITS = {
    nodes: 250,
    depth: 8,
    labelChars: 160,
    sourceChars: 40_000,
} as const;

export interface DiagramSpec {
    title: string;
    type: DiagramType;
    /** For mindmap, org_chart and tree: one topic per line, children indented. */
    outline?: string;
    /** For flowchart: a Mermaid `flowchart`. */
    mermaid?: string;
}

export interface BuildOptions {
    /** The paper to draw on: the creator's app theme, stored with the map. */
    mode?: ThemeMode;
    /** A theme id from `palette.ts`; the default for `mode` when absent. */
    themeId?: string;
    /** The first page's name, in the reader's language. */
    pageName?: string;
}

/** Thrown for a spec that cannot make a diagram; the message is written for a model. */
export class DiagramSpecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DiagramSpecError";
    }
}

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

export interface OutlineNode {
    text: string;
    children: OutlineNode[];
}

/**
 * An indented outline as a forest. Bullets (`-`, `*`, `+`, `1.`) and
 * Markdown headings both nest (`#` is the top, `##` under it); tabs, two and
 * four spaces all work, judged by the smallest indent present. A jump of
 * more than one level hangs from the deepest topic so far rather than
 * dangling. Mermaid's own `mindmap` syntax reads the same way, its shape
 * brackets dropped.
 */
const BULLET = /^([-*+•]|\d+[.)])\s+/;

export function parseOutline(text: string): OutlineNode[] {
    const lines = text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(l => l.replace(/\t/g, "    "))
        .filter(l => l.trim() !== "" && !/^\s*```/.test(l));
    if (lines.length > 0 && /^\s*mindmap\s*$/i.test(lines[0]!)) lines.shift();

    const indents = lines.map(l => /^(\s*)/.exec(l)?.[1]?.length ?? 0).filter(w => w > 0);
    const unit = indents.length > 0 ? Math.min(...indents) : 2;
    const baseIndent = Math.min(...lines.map(l => /^(\s*)/.exec(l)?.[1]?.length ?? 0), Infinity);

    const roots: OutlineNode[] = [];
    const stack: OutlineNode[] = [];
    /** Bullets under a heading hang from it: their depth starts one below it. */
    let headingBase = 0;
    /**
     * A plain line — no bullet — that bullets at its own indent hang from:
     * "Title" followed by "- Branch" lines is a title and its branches, not
     * a row of siblings. Models write outlines this way all the time.
     */
    let plainBase: { indent: number; depth: number; bulletIndent?: number } | null = null;
    for (const raw of lines) {
        const indent =
            (/^(\s*)/.exec(raw)?.[1]?.length ?? 0) - (Number.isFinite(baseIndent) ? baseIndent : 0);
        let content = raw.trim();
        if (content.startsWith("::icon(")) continue;
        const heading = /^(#{1,6})\s+(.*)$/.exec(content);
        let depth: number;
        const bullet = !heading && BULLET.test(content);
        if (heading) {
            depth = heading[1]!.length - 1;
            content = heading[2]!;
            headingBase = depth + 1;
            plainBase = null;
        } else if (bullet && plainBase && indent >= plainBase.indent) {
            // Bullets count their levels from the first one under the line,
            // whether they start at its indent or one step in.
            plainBase.bulletIndent ??= indent;
            const below = Math.max(indent - plainBase.bulletIndent, 0);
            depth = plainBase.depth + 1 + Math.round(below / unit);
            content = content.replace(BULLET, "");
        } else {
            depth = headingBase + Math.round(Math.max(indent, 0) / unit);
            content = content.replace(BULLET, "");
        }
        const label = cleanTopic(content);
        if (!label) continue;
        depth = Math.min(depth, stack.length, DIAGRAM_LIMITS.depth);
        if (!heading && !bullet) plainBase = { indent, depth };
        const node: OutlineNode = { text: label, children: [] };
        if (depth === 0) roots.push(node);
        else stack[depth - 1]!.children.push(node);
        stack[depth] = node;
        stack.length = depth + 1;
    }
    return roots;
}

/** A topic's words: markup and Mermaid shape brackets dropped, length capped. */
function cleanTopic(raw: string): string {
    let text = raw.trim();
    // Mermaid mindmap: `root((Centre))`, `id[Box]`, `(Rounded)`, `{{Hex}}`.
    const bracketed =
        /^[\p{L}\p{N}_-]*\s*(\(\(|\(\[|\[\[|\{\{|\(|\[|\{|\)\))\s*(.*?)\s*(\)\)|\]\)|\]\]|\}\}|\)|\]|\}|\(\()$/u.exec(
            text
        );
    if (bracketed?.[2]) text = bracketed[2];
    text = text
        .replace(/^\[[ xX]\]\s+/, "") // task-list box
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/^"(.*)"$/, "$1")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > DIAGRAM_LIMITS.labelChars
        ? `${text.slice(0, DIAGRAM_LIMITS.labelChars - 1).trimEnd()}…`
        : text;
}

function countOutline(nodes: readonly OutlineNode[]): number {
    return nodes.reduce((n, node) => n + 1 + countOutline(node.children), 0);
}

/** Widest a topic's label runs before it wraps. */
const TOPIC_TEXT_WIDTH = [220, 200, 190, 180] as const;

/** A topic's box for its label: never below the size Tab gives a topic at that depth. */
export function topicSize(
    shape: ShapeId,
    depth: number,
    text: string,
    style: TextStyle
): { w: number; h: number } {
    const base =
        depth === 0 ? { w: 200, h: 76 } : depth === 1 ? { w: 170, h: 56 } : { w: 150, h: 48 };
    const laid = layoutText(text, style, TOPIC_TEXT_WIDTH[Math.min(depth, 3)]!);
    const padX = shape === "mind-leaf" ? 16 : 36;
    const padY = shape === "mind-leaf" ? 18 : 24;
    return {
        w: Math.max(base.w, Math.ceil(laid.width + padX)),
        h: Math.max(base.h, Math.ceil(laid.height + padY)),
    };
}

const LAYOUT_FOR: Record<Exclude<DiagramType, "flowchart">, AutoLayoutSetting> = {
    mindmap: { kind: "mindmap" },
    org_chart: { kind: "org", direction: "down" },
    tree: { kind: "tree", direction: "right" },
};

/**
 * A topic tree as a page of topics: a centre, main branches, subtopics. A
 * forest with more than one top line gets `title` as its centre, so the map
 * still has one. In a mindmap, the fourth level down is drawn as an
 * underlined leaf, as the editor draws a topic added there; an org chart or
 * a tree keeps boxes all the way down, which read better in rows.
 */
export function outlineToPage(
    roots: readonly OutlineNode[],
    type: Exclude<DiagramType, "flowchart">,
    title: string,
    pageName = "Page 1"
): DiagramPage {
    const centre = cleanTopic(title) || "Untitled";
    // Wrapping a forest in its title: a childless top line that only
    // repeats the title is the title, not a branch of it.
    const branches =
        roots.length === 1
            ? roots
            : roots.filter(
                  r => r.children.length > 0 || r.text.toLowerCase() !== centre.toLowerCase()
              );
    const top: OutlineNode =
        branches.length === 1 ? branches[0]! : { text: centre, children: [...branches] };

    const nodes: DiagramNode[] = [];
    const edges: DiagramEdge[] = [];
    const visit = (outline: OutlineNode, depth: number, parent: DiagramNode | null) => {
        if (nodes.length >= DIAGRAM_LIMITS.nodes) return;
        const shape: ShapeId =
            depth === 0
                ? "mind-root"
                : type === "mindmap" && depth >= 3
                  ? "mind-leaf"
                  : "mind-branch";
        const leaf = shape === "mind-leaf";
        const textStyle = defaultTextStyle({
            ...topicType(depth),
            align: leaf ? "left" : "center",
            valign: leaf ? "bottom" : "middle",
        });
        const size = topicSize(shape, depth, outline.text, textStyle);
        const node = createNode({
            shape,
            x: 0,
            y: 0,
            w: size.w,
            h: size.h,
            text: outline.text,
            textStyle,
            data: { depth },
            ...(depth === 0 ? { style: { shadow: true, radius: 22 } } : {}),
        });
        nodes.push(node);
        if (parent) {
            edges.push(
                createEdge({
                    from: { nodeId: parent.id, port: "auto" },
                    to: { nodeId: node.id, port: "auto" },
                    kind: type === "mindmap" ? "curved" : "elbow",
                    endArrow: "none",
                })
            );
        }
        for (const child of outline.children) visit(child, depth + 1, node);
    };
    visit(top, 0, null);
    return { ...createPage(pageName), nodes, edges };
}

// ---------------------------------------------------------------------------
// Specs → documents
// ---------------------------------------------------------------------------

/**
 * Build the document a spec describes, lit for `mode` and laid out for its
 * type. Throws {@link DiagramSpecError} when there is nothing to draw.
 */
export function buildDiagram(spec: DiagramSpec, options: BuildOptions = {}): MindmapDoc {
    const mode = options.mode ?? "light";
    const themeId = options.themeId ?? defaultThemeFor(mode);
    const pageName = options.pageName ?? "Page 1";
    const title = cleanTopic(spec.title) || "Untitled diagram";

    if (spec.type === "flowchart") {
        const source = (spec.mermaid ?? "").trim();
        if (!source)
            throw new DiagramSpecError("A flowchart needs `mermaid`: a Mermaid flowchart.");
        if (source.length > DIAGRAM_LIMITS.sourceChars) {
            throw new DiagramSpecError(
                `The Mermaid source is too long (over ${DIAGRAM_LIMITS.sourceChars} characters).`
            );
        }
        const raw = mermaidToDoc(source, title, pageName);
        const count = raw.pages[0]?.nodes.length ?? 0;
        if (count === 0) {
            throw new DiagramSpecError(
                "The Mermaid source had no nodes I could read. Write a flowchart such as:\nflowchart TD\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Ship]"
            );
        }
        if (count > DIAGRAM_LIMITS.nodes) {
            throw new DiagramSpecError(
                `That flowchart has ${count} nodes; keep it to ${DIAGRAM_LIMITS.nodes} or fewer.`
            );
        }
        // Painted like any board in this theme, so the Theme picker repaints
        // it the same way later. Its frames are paper frames, which the theme
        // keeps as paper (`applyThemeToPage`).
        const themed = applyThemeToDoc(raw, themeId);
        return normalizeOrigin({ ...themed, title });
    }

    const source = (spec.outline ?? "").trim();
    if (!source)
        throw new DiagramSpecError(
            `A ${spec.type} needs \`outline\`: one topic per line, children indented.`
        );
    if (source.length > DIAGRAM_LIMITS.sourceChars) {
        throw new DiagramSpecError(
            `The outline is too long (over ${DIAGRAM_LIMITS.sourceChars} characters).`
        );
    }
    const roots = parseOutline(source);
    const count = countOutline(roots);
    if (count === 0) throw new DiagramSpecError("The outline had no topics I could read.");
    if (count > DIAGRAM_LIMITS.nodes) {
        throw new DiagramSpecError(
            `That outline has ${count} topics; keep it to ${DIAGRAM_LIMITS.nodes} or fewer.`
        );
    }

    const page = outlineToPage(roots, spec.type, title, pageName);
    const layout = LAYOUT_FOR[spec.type];
    const base = createDoc(title, [page]);
    const doc: MindmapDoc = {
        ...base,
        settings: {
            ...base.settings,
            kind: "mindmap",
            autoLayout: layout,
            defaultEdgeKind: spec.type === "mindmap" ? "curved" : "elbow",
        },
    };
    const themed = applyThemeToDoc(doc, themeId);
    const placed = runAutoLayout(
        themed,
        layout.kind,
        layout.direction ? { direction: layout.direction } : {}
    );
    return normalizeOrigin(placed);
}

/** The outline a model would write for a page of topics — what `read_diagram` shows and edits extend. */
export function outlineText(roots: readonly OutlineNode[], indent = 0): string {
    return roots
        .map(
            r =>
                `${"  ".repeat(indent)}- ${r.text}${r.children.length ? `\n${outlineText(r.children, indent + 1)}` : ""}`
        )
        .join("\n");
}
