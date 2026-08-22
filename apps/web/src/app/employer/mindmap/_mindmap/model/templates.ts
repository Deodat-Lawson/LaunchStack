/**
 * Starter documents.
 *
 * Every template is built from the same factories the editor uses, so a
 * template can never contain a shape or style the UI cannot round-trip. They
 * are plain functions rather than stored JSON so they pick up palette changes
 * automatically.
 *
 * The *list* lives in `template-meta.ts`; this module attaches a builder to
 * each entry. Surfaces that only offer the choice (the gallery, the "Add a
 * source" panel) import the metadata and never pull the shape library in.
 */

import { createDoc, createEdge, createNode, createPage } from "./factory";
import { runAutoLayout } from "./template-helpers";
import { branchSwatch, STICKY_COLORS, SWATCH_BY_ID } from "./palette";
import { TEMPLATE_META, type TemplateMeta } from "./template-meta";
import type { DiagramEdge, DiagramNode, MindmapDoc, ShapeId } from "./types";

export {
    TEMPLATE_CATEGORIES,
    TEMPLATE_META,
    TEMPLATE_META_BY_ID,
    type TemplateCategory,
    type TemplateMeta,
} from "./template-meta";

export interface TemplateDef extends TemplateMeta {
    build: (title?: string) => MindmapDoc;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

interface Built {
    nodes: DiagramNode[];
    edges: DiagramEdge[];
}

function connect(
    from: DiagramNode,
    to: DiagramNode,
    opts: {
        label?: string;
        kind?: DiagramEdge["kind"];
        stroke?: string;
        width?: number;
        arrow?: DiagramEdge["endArrow"];
        dashed?: boolean;
    } = {}
): DiagramEdge {
    return createEdge({
        from: { nodeId: from.id, port: "auto" },
        to: { nodeId: to.id, port: "auto" },
        kind: opts.kind ?? "elbow",
        label: opts.label,
        endArrow: opts.arrow ?? "arrow",
        style: {
            ...(opts.stroke ? { stroke: opts.stroke } : {}),
            ...(opts.width ? { strokeWidth: opts.width } : {}),
            ...(opts.dashed ? { strokeStyle: "dashed" as const } : {}),
        },
    });
}

function branchNode(depth: number, x: number, y: number, text: string): DiagramNode {
    const sw = branchSwatch(depth);
    const shape: ShapeId = depth === 0 ? "mind-root" : "mind-branch";
    return createNode({
        shape,
        x,
        y,
        w: depth === 0 ? 210 : depth === 1 ? 170 : 150,
        h: depth === 0 ? 78 : depth === 1 ? 56 : 48,
        text,
        style:
            depth === 0
                ? { fill: sw.stroke, stroke: "none", strokeWidth: 0, shadow: true }
                : { fill: sw.fill, stroke: sw.stroke },
        textStyle: {
            color: depth === 0 ? "oklch(0.99 0.002 285)" : sw.ink,
            size: depth === 0 ? 18 : depth === 1 ? 15 : 13.5,
            bold: depth <= 1,
        },
        data: { depth },
    });
}

function finish(title: string, built: Built, pageName = "Page 1"): MindmapDoc {
    const page = createPage(pageName);
    return createDoc(title, [{ ...page, nodes: built.nodes, edges: built.edges }]);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function blank(title = "Untitled mindmap"): MindmapDoc {
    return createDoc(title);
}

function mindmap(title = "New mindmap"): MindmapDoc {
    const root = branchNode(0, 0, 0, "Central idea");
    const branches = ["First branch", "Second branch", "Third branch", "Fourth branch"].map(text =>
        branchNode(1, 0, 0, text)
    );
    const leaves = branches.flatMap((b, i) =>
        [1, 2].map(k => branchNode(2, 0, 0, `Detail ${i + 1}.${k}`))
    );

    const nodes = [root, ...branches, ...leaves];
    const edges: DiagramEdge[] = [];
    branches.forEach((b, i) => {
        edges.push(
            connect(root, b, {
                kind: "curved",
                arrow: "none",
                stroke: branchSwatch(i + 1).stroke,
                width: 2.6,
            })
        );
        for (let k = 0; k < 2; k++) {
            const leaf = leaves[i * 2 + k]!;
            edges.push(
                connect(b, leaf, {
                    kind: "curved",
                    arrow: "none",
                    stroke: branchSwatch(i + 1).stroke,
                    width: 1.6,
                })
            );
        }
    });

    return runAutoLayout(finish(title, { nodes, edges }), "mindmap");
}

function brainstorm(title = "Brainstorm"): MindmapDoc {
    const nodes: DiagramNode[] = [];
    const prompt = createNode({
        shape: "mind-root",
        x: 0,
        y: -140,
        w: 320,
        h: 80,
        text: "What are we solving?",
        style: { fill: SWATCH_BY_ID.violet!.stroke, stroke: "none", strokeWidth: 0, shadow: true },
        textStyle: { color: "oklch(0.99 0.002 285)", size: 19, bold: true },
    });
    nodes.push(prompt);

    const columns = ["Ideas", "Questions", "Risks", "Next steps"];
    columns.forEach((label, col) => {
        nodes.push(
            createNode({
                shape: "text",
                x: col * 220,
                y: 0,
                w: 190,
                h: 32,
                text: label,
                textStyle: { size: 15, bold: true, align: "left", valign: "middle" },
            })
        );
        for (let row = 0; row < 3; row++) {
            nodes.push(
                createNode({
                    shape: "sticky",
                    x: col * 220,
                    y: 46 + row * 170,
                    w: 190,
                    h: 150,
                    text: "",
                    style: { fill: STICKY_COLORS[col % STICKY_COLORS.length]! },
                })
            );
        }
    });

    return finish(title, { nodes, edges: [] });
}

function flowchart(title = "Flowchart"): MindmapDoc {
    const start = createNode({ shape: "terminator", x: 0, y: 0, text: "Start" });
    const step1 = createNode({ shape: "process", x: -10, y: 130, text: "Do the thing" });
    const decision = createNode({ shape: "decision", x: -10, y: 270, text: "Looks right?" });
    const yes = createNode({ shape: "process", x: -220, y: 430, text: "Ship it" });
    const no = createNode({ shape: "process", x: 210, y: 430, text: "Fix and retry" });
    const end = createNode({ shape: "terminator", x: -10, y: 570, text: "End" });

    const nodes = [start, step1, decision, yes, no, end];
    const edges = [
        connect(start, step1),
        connect(step1, decision),
        connect(decision, yes, { label: "Yes" }),
        connect(decision, no, { label: "No" }),
        connect(yes, end),
        connect(no, step1, { kind: "elbow", label: "retry" }),
    ];
    return finish(title, { nodes, edges });
}

function orgChart(title = "Org chart"): MindmapDoc {
    const person = (x: number, y: number, name: string, role: string, swatch: string) =>
        createNode({
            shape: "rounded-rectangle",
            x,
            y,
            w: 190,
            h: 76,
            text: `${name}\n${role}`,
            style: {
                fill: SWATCH_BY_ID[swatch]!.fill,
                stroke: SWATCH_BY_ID[swatch]!.stroke,
                radius: 10,
            },
            textStyle: { color: SWATCH_BY_ID[swatch]!.ink, size: 13.5 },
        });

    const ceo = person(0, 0, "Name", "Chief Executive", "violet");
    const reports = [
        person(0, 0, "Name", "Engineering", "blue"),
        person(0, 0, "Name", "Product", "teal"),
        person(0, 0, "Name", "Go-to-market", "amber"),
    ];
    const ics = reports.flatMap((r, i) => [
        person(0, 0, "Name", `Team ${i + 1}A`, "slate"),
        person(0, 0, "Name", `Team ${i + 1}B`, "slate"),
    ]);

    const nodes = [ceo, ...reports, ...ics];
    const edges: DiagramEdge[] = [];
    reports.forEach((r, i) => {
        edges.push(connect(ceo, r, { arrow: "none", kind: "elbow" }));
        edges.push(connect(r, ics[i * 2]!, { arrow: "none", kind: "elbow" }));
        edges.push(connect(r, ics[i * 2 + 1]!, { arrow: "none", kind: "elbow" }));
    });

    return runAutoLayout(finish(title, { nodes, edges }), "org");
}

function swimlane(title = "Swimlane process"): MindmapDoc {
    const lanes = ["Customer", "Support", "Engineering"];
    const nodes: DiagramNode[] = [];
    const laneH = 190;

    lanes.forEach((label, i) => {
        nodes.push(
            createNode({
                shape: "swimlane-h",
                x: 0,
                y: i * laneH,
                w: 980,
                h: laneH,
                text: label,
                style: { fill: i % 2 === 0 ? "oklch(0.99 0.003 280)" : "oklch(0.975 0.004 280)" },
            })
        );
    });

    const steps: [number, number, string, ShapeId][] = [
        [0, 0, "Reports issue", "terminator"],
        [1, 1, "Triages ticket", "process"],
        [2, 2, "Reproduces bug", "process"],
        [2, 3, "Ships fix", "process"],
        [0, 4, "Confirms fixed", "terminator"],
    ];
    const stepNodes = steps.map(([lane, col, text, shape]) =>
        createNode({
            shape,
            x: 40 + col * 185,
            y: lane * laneH + 58,
            w: 160,
            h: 72,
            text,
        })
    );
    nodes.push(...stepNodes);

    const edges = stepNodes.slice(0, -1).map((s, i) => connect(s, stepNodes[i + 1]!));
    return finish(title, { nodes, edges });
}

function erd(title = "Entity relationship"): MindmapDoc {
    const entity = (x: number, y: number, name: string, fields: string[]) =>
        createNode({
            shape: "erd-entity",
            x,
            y,
            w: 220,
            h: 46 + fields.length * 22,
            text: `${name}\n${fields.join("\n")}`,
            textStyle: { align: "left", valign: "top", size: 13 },
        });

    const users = entity(0, 0, "users", ["id  PK", "email", "created_at"]);
    const orders = entity(340, 0, "orders", ["id  PK", "user_id  FK", "total", "status"]);
    const items = entity(340, 240, "order_items", ["id  PK", "order_id  FK", "sku", "qty"]);

    const nodes = [users, orders, items];
    const edges = [
        createEdge({
            from: { nodeId: users.id, port: "e" },
            to: { nodeId: orders.id, port: "w" },
            kind: "elbow",
            startArrow: "crowfoot-one",
            endArrow: "crowfoot-many",
            label: "places",
        }),
        createEdge({
            from: { nodeId: orders.id, port: "s" },
            to: { nodeId: items.id, port: "n" },
            kind: "elbow",
            startArrow: "crowfoot-one",
            endArrow: "crowfoot-many",
            label: "contains",
        }),
    ];
    return finish(title, { nodes, edges });
}

function architecture(title = "System architecture"): MindmapDoc {
    const box = (x: number, y: number, text: string, shape: ShapeId, swatch: string) =>
        createNode({
            shape,
            x,
            y,
            w: 180,
            h: 84,
            text,
            style: {
                fill: SWATCH_BY_ID[swatch]!.fill,
                stroke: SWATCH_BY_ID[swatch]!.stroke,
            },
            textStyle: { color: SWATCH_BY_ID[swatch]!.ink, size: 13.5 },
        });

    const client = box(0, 0, "Web client", "rounded-rectangle", "blue");
    const api = box(260, 0, "API", "uml-component", "violet");
    const worker = box(260, 160, "Worker", "uml-component", "indigo");
    const db = box(540, 0, "Postgres", "database", "teal");
    const queue = box(540, 160, "Queue", "cylinder", "amber");
    const store = box(540, 320, "Object storage", "cylinder", "green");

    const nodes = [client, api, worker, db, queue, store];
    const edges = [
        connect(client, api, { label: "HTTPS" }),
        connect(api, db, { label: "SQL" }),
        connect(api, queue, { label: "enqueue" }),
        connect(queue, worker, { label: "consume" }),
        connect(worker, db, { label: "SQL" }),
        connect(worker, store, { label: "artifacts" }),
    ];
    return finish(title, { nodes, edges });
}

function userFlow(title = "User flow"): MindmapDoc {
    const screen = (x: number, y: number, text: string) =>
        createNode({
            shape: "rounded-rectangle",
            x,
            y,
            w: 170,
            h: 110,
            text,
            style: { fill: "oklch(1 0 0)", stroke: SWATCH_BY_ID.slate!.stroke, radius: 10 },
            textStyle: { valign: "middle", size: 13.5 },
        });

    const landing = screen(0, 0, "Landing");
    const signup = screen(240, 0, "Sign up");
    const onboarding = screen(480, 0, "Onboarding");
    const workspace = screen(720, 0, "Workspace");
    const decision = createNode({
        shape: "decision",
        x: 236,
        y: 190,
        w: 180,
        h: 110,
        text: "Has account?",
    });
    const signin = screen(480, 190, "Sign in");

    const nodes = [landing, signup, onboarding, workspace, decision, signin];
    const edges = [
        connect(landing, decision),
        connect(decision, signup, { label: "No" }),
        connect(decision, signin, { label: "Yes" }),
        connect(signup, onboarding),
        connect(onboarding, workspace),
        connect(signin, workspace),
    ];
    return finish(title, { nodes, edges });
}

function swot(title = "SWOT analysis"): MindmapDoc {
    const quadrants: [string, string, number, number][] = [
        ["Strengths", "green", 0, 0],
        ["Weaknesses", "red", 420, 0],
        ["Opportunities", "blue", 0, 320],
        ["Threats", "amber", 420, 320],
    ];
    const nodes = quadrants.flatMap(([label, swatch, x, y]) => {
        const sw = SWATCH_BY_ID[swatch]!;
        return [
            createNode({
                shape: "frame",
                x,
                y,
                w: 400,
                h: 300,
                text: label,
                style: { fill: sw.fill, stroke: sw.stroke, radius: 12 },
                textStyle: { color: sw.ink, size: 14, bold: true, align: "left" },
            }),
            createNode({
                shape: "text",
                x: x + 24,
                y: y + 40,
                w: 350,
                h: 120,
                text: "• \n• \n• ",
                textStyle: { align: "left", valign: "top", size: 14, color: sw.ink },
            }),
        ];
    });
    return finish(title, { nodes, edges: [] });
}

function kanban(title = "Kanban board"): MindmapDoc {
    const columns = ["Backlog", "In progress", "Review", "Done"];
    const nodes: DiagramNode[] = [];
    columns.forEach((label, i) => {
        nodes.push(
            createNode({
                shape: "swimlane-v",
                x: i * 260,
                y: 0,
                w: 240,
                h: 560,
                text: label,
                style: { fill: "oklch(0.985 0.004 280)", stroke: "oklch(0.86 0.008 280)" },
            })
        );
        for (let k = 0; k < 2; k++) {
            nodes.push(
                createNode({
                    shape: "rounded-rectangle",
                    x: i * 260 + 16,
                    y: 56 + k * 104,
                    w: 208,
                    h: 88,
                    text: "",
                    style: { fill: "oklch(1 0 0)", stroke: "oklch(0.88 0.008 280)", shadow: true },
                    textStyle: { align: "left", valign: "top", size: 13.5 },
                })
            );
        }
    });
    return finish(title, { nodes, edges: [] });
}

function timeline(title = "Timeline"): MindmapDoc {
    const nodes: DiagramNode[] = [];
    const spine = createNode({
        shape: "line",
        x: 0,
        y: 240,
        w: 1000,
        h: 2,
        style: { stroke: "oklch(0.72 0.012 280)", strokeWidth: 2 },
    });
    nodes.push(spine);
    const stops = ["Kickoff", "Alpha", "Beta", "Launch", "Review"];
    stops.forEach((label, i) => {
        const x = 60 + i * 220;
        const above = i % 2 === 0;
        nodes.push(
            createNode({
                shape: "connector-dot",
                x: x - 9,
                y: 232,
                w: 18,
                h: 18,
                style: { fill: branchSwatch(i + 1).stroke, stroke: "none", strokeWidth: 0 },
            })
        );
        nodes.push(
            createNode({
                shape: "rounded-rectangle",
                x: x - 85,
                y: above ? 120 : 300,
                w: 170,
                h: 76,
                text: label,
                style: {
                    fill: branchSwatch(i + 1).fill,
                    stroke: branchSwatch(i + 1).stroke,
                    radius: 10,
                },
                textStyle: { color: branchSwatch(i + 1).ink, size: 14, bold: true },
            })
        );
    });
    return finish(title, { nodes, edges: [] });
}

function customerJourney(title = "Customer journey"): MindmapDoc {
    const stages = ["Awareness", "Consideration", "Decision", "Onboarding", "Advocacy"];
    const rows = ["Actions", "Touchpoints", "Feelings", "Opportunities"];
    const nodes: DiagramNode[] = [];

    stages.forEach((stage, i) => {
        nodes.push(
            createNode({
                shape: "chevron",
                x: i * 210,
                y: 0,
                w: 230,
                h: 70,
                text: stage,
                style: {
                    fill: branchSwatch(i + 1).fill,
                    stroke: branchSwatch(i + 1).stroke,
                },
                textStyle: { color: branchSwatch(i + 1).ink, size: 14, bold: true },
            })
        );
    });

    rows.forEach((row, r) => {
        nodes.push(
            createNode({
                shape: "text",
                x: -150,
                y: 110 + r * 130,
                w: 140,
                h: 40,
                text: row,
                textStyle: { align: "right", valign: "middle", size: 13, bold: true },
            })
        );
        stages.forEach((_, i) => {
            nodes.push(
                createNode({
                    shape: "rectangle",
                    x: i * 210,
                    y: 100 + r * 130,
                    w: 200,
                    h: 110,
                    text: "",
                    style: {
                        fill: "oklch(1 0 0)",
                        stroke: "oklch(0.89 0.006 280)",
                        strokeWidth: 1,
                    },
                    textStyle: { align: "left", valign: "top", size: 13 },
                })
            );
        });
    });

    return finish(title, { nodes, edges: [] });
}

function fishbone(title = "Cause and effect"): MindmapDoc {
    const problem = createNode({
        shape: "rounded-rectangle",
        x: 900,
        y: 210,
        w: 200,
        h: 80,
        text: "Problem",
        style: { fill: SWATCH_BY_ID.red!.fill, stroke: SWATCH_BY_ID.red!.stroke, radius: 10 },
        textStyle: { color: SWATCH_BY_ID.red!.ink, size: 15, bold: true },
    });
    const spine = createNode({
        shape: "line",
        x: 60,
        y: 249,
        w: 830,
        h: 2,
        style: { stroke: "oklch(0.55 0.02 280)", strokeWidth: 2.5 },
    });

    const causes = ["People", "Process", "Tools", "Data", "Environment", "Measurement"];
    const nodes: DiagramNode[] = [problem, spine];
    const edges: DiagramEdge[] = [];
    causes.forEach((label, i) => {
        const above = i % 2 === 0;
        const x = 120 + Math.floor(i / 2) * 250;
        const node = createNode({
            shape: "mind-branch",
            x,
            y: above ? 90 : 380,
            w: 180,
            h: 54,
            text: label,
            style: {
                fill: branchSwatch(i + 1).fill,
                stroke: branchSwatch(i + 1).stroke,
            },
            textStyle: { color: branchSwatch(i + 1).ink, size: 14, bold: true },
        });
        nodes.push(node);
        edges.push(
            createEdge({
                from: { nodeId: node.id, port: above ? "s" : "n" },
                to: { nodeId: spine.id, port: "c" },
                kind: "straight",
                endArrow: "none",
                style: { stroke: branchSwatch(i + 1).stroke, strokeWidth: 1.8 },
            })
        );
    });
    return finish(title, { nodes, edges });
}

function conceptMap(title = "Concept map"): MindmapDoc {
    const concept = (x: number, y: number, text: string, depth: number) =>
        createNode({
            shape: "ellipse",
            x,
            y,
            w: 180,
            h: 96,
            text,
            style: {
                fill: branchSwatch(depth).fill,
                stroke: branchSwatch(depth).stroke,
            },
            textStyle: { color: branchSwatch(depth).ink, size: 14 },
        });

    const core = concept(400, 0, "Core concept", 0);
    const a = concept(120, 200, "Concept A", 1);
    const b = concept(680, 200, "Concept B", 2);
    const c = concept(400, 400, "Concept C", 3);

    const nodes = [core, a, b, c];
    const edges = [
        connect(core, a, { label: "leads to", kind: "curved" }),
        connect(core, b, { label: "requires", kind: "curved" }),
        connect(a, c, { label: "supports", kind: "curved" }),
        connect(b, c, { label: "constrains", kind: "curved" }),
    ];
    return finish(title, { nodes, edges });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Builder per template id. Splitting the functions from the metadata means a
 * new template is a one-line addition in each place, and the test below fails
 * loudly if one list gains an entry the other lacks.
 */
const BUILDERS: Record<string, (title?: string) => MindmapDoc> = {
    blank,
    mindmap,
    brainstorm,
    "concept-map": conceptMap,
    flowchart,
    "user-flow": userFlow,
    swimlane,
    fishbone,
    "org-chart": orgChart,
    kanban,
    timeline,
    swot,
    "customer-journey": customerJourney,
    architecture,
    erd,
};

export const TEMPLATES: readonly TemplateDef[] = TEMPLATE_META.map(meta => ({
    ...meta,
    build: BUILDERS[meta.id] ?? blank,
}));

export const TEMPLATE_BY_ID: Record<string, TemplateDef> = Object.fromEntries(
    TEMPLATES.map(t => [t.id, t])
);

/** Ids in the metadata list that have no builder — asserted empty by the tests. */
export function templatesMissingBuilders(): string[] {
    return TEMPLATE_META.filter(meta => !(meta.id in BUILDERS)).map(meta => meta.id);
}

/** Builder ids with no metadata entry, which would be unreachable from the UI. */
export function buildersMissingMetadata(): string[] {
    const known = new Set(TEMPLATE_META.map(meta => meta.id));
    return Object.keys(BUILDERS).filter(id => !known.has(id));
}

export function buildTemplate(id: string, title?: string): MindmapDoc {
    const t = TEMPLATE_BY_ID[id] ?? TEMPLATE_BY_ID.blank!;
    return t.build(title);
}
