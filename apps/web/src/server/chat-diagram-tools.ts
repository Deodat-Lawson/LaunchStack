/**
 * Ask's diagram tools — the chat drawing in the Mindmap editor, the way
 * `create_document` (chat-document-tools.ts) writes into the workspace.
 *
 * Asked to "map out our onboarding flow", the chat used to answer with a
 * bulleted list or a Mermaid block to copy somewhere else. With these it
 * draws the diagram as a Mindmap draft — an ordinary one the person can
 * open, edit, present, share and make citable — and can change one that
 * exists ("add a risks branch to the launch map"):
 *
 * - `find_diagrams` — the person's diagrams by title or label, or the ones
 *   opened most recently (the first is usually the one on screen);
 * - `read_diagram` — one diagram as text, every shape with its id;
 * - `create_diagram` — a new draft from an outline (mind maps, org charts,
 *   trees) or a Mermaid flowchart;
 * - `edit_diagram` — small operations on ids from `read_diagram`.
 *
 * The model writes text; `~/server/mindmap/agent` turns it into a document
 * with the editor's own factories, theme and layouts, and keeps every rule
 * the editor keeps: a draft follows its folder (ADR-014), an Unfiled one is
 * the person's alone, editing takes edit access, and an edit never writes
 * over a save it did not see.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import {
    DIAGRAM_EDIT_OPS,
    FLOW_SHAPES,
    MAX_EDITS,
    type DiagramEdit,
} from "~/app/employer/documents/_mindmap/model/agent-edits";
import { DIAGRAM_TYPES } from "~/app/employer/documents/_mindmap/model/generate";
import type { ThemeMode } from "~/app/employer/documents/_mindmap/model/palette";
import type { Locale } from "~/i18n/locales";
import { translatorFor } from "~/i18n/translate";
import type { ChatCreatedDiagram, ChatCreatedSource } from "~/lib/chat-turns";
import {
    UNFILED_FOLDER,
    isUnfiledFolder,
    normalizeFolderPath,
    validateFolderPath,
} from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import {
    DiagramBusy,
    DiagramEditDenied,
    DiagramEditError,
    DiagramNotFound,
    DiagramSpecError,
    DraftFolderError,
    createDiagram,
    diagramKind,
    diagramPlace,
    diagramText,
    editDiagram,
    findDiagrams,
    loadDiagram,
    parseDiagramId,
    touched,
} from "~/server/mindmap/agent";

import type { ChatTool } from "./chat-tool-loop";

/** Diagrams one answer may create. */
const MAX_CREATES = 3;
/** `edit_diagram` calls one answer may make. */
const MAX_EDIT_CALLS = 6;

export interface DiagramToolSession {
    tools: ChatTool[];
    /** Every diagram the answer created or changed, in order, once each. */
    touched: ChatCreatedSource[];
    /** True when the session offers create and edit, not only find and read. */
    writes: boolean;
}

export interface DiagramToolOptions {
    locale?: Locale;
    /** The lighting a new diagram is drawn in: the person's app theme. */
    mode: ThemeMode;
    /** May create diagrams (`documents.upload`, and the agent may write). */
    canCreate: boolean;
    /** May change diagrams they have edit access to (`documents.edit`, and the agent may write). */
    canEdit: boolean;
}

/** Arguments a model sends as `null` mean "not given". */
function withoutNulls(args: unknown): unknown {
    if (!args || typeof args !== "object" || Array.isArray(args)) return args;
    return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null));
}

function invalid(error: z.ZodError): Error {
    return new Error(
        `Invalid arguments: ${error.issues.map(i => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`
    );
}

/** "Private" is the rail section an unfiled draft sits in, not a folder to create. */
function folderFrom(raw: string | undefined): string {
    const path = normalizeFolderPath(raw);
    if (isUnfiledFolder(path) || /^private( space| section)?$/i.test(path)) return UNFILED_FOLDER;
    const problem = validateFolderPath(path);
    if (problem) throw new Error(`Invalid folder: ${problem}`);
    return path;
}

const FindArgs = z.object({ query: z.string().trim().max(200).optional() });
const ReadArgs = z.object({ diagram: z.union([z.string(), z.number()]) });
const CreateArgs = z.object({
    title: z.string().trim().min(1, "must not be empty").max(200),
    type: z.enum(DIAGRAM_TYPES),
    outline: z.string().max(40_000).optional(),
    mermaid: z.string().max(40_000).optional(),
    folder: z.string().trim().max(256).optional(),
});
const EditSchema = z
    .object({
        op: z.enum(DIAGRAM_EDIT_OPS),
        under: z.string().max(200).optional(),
        text: z.string().max(8_000).optional(),
        after: z.string().max(200).optional(),
        shape: z.enum(FLOW_SHAPES).optional(),
        label: z.string().max(200).optional(),
        ref: z.string().max(60).optional(),
        node: z.string().max(200).optional(),
        keep_children: z.boolean().optional(),
        from: z.string().max(200).optional(),
        to: z.string().max(200).optional(),
    })
    .passthrough();
/**
 * One edit as a model sent it, tidied: small models fill the fields they do
 * not use with "" or null, and leave `op` off an item whose meaning is plain
 * (words to add). Blank means absent; text with no op is an add.
 */
function normaliseEdit(raw: unknown): unknown {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (value === null) continue;
        if (typeof value === "string" && value.trim() === "") continue;
        out[key] = value;
    }
    if (out.op === undefined && typeof out.text === "string") {
        out.op = typeof out.node === "string" ? "rename" : "add";
    }
    return out;
}

/** `edits` as a list, also when a model sent it as JSON text or a single object. */
function editList(raw: unknown): unknown {
    if (typeof raw === "string") {
        try {
            return editList(JSON.parse(raw) as unknown);
        } catch {
            return raw;
        }
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return [raw];
    return raw;
}

const EditArgs = z.object({
    diagram: z.union([z.string(), z.number()]),
    edits: z.preprocess(
        editList,
        z.array(z.preprocess(normaliseEdit, EditSchema)).min(1).max(MAX_EDITS)
    ),
});

/** JSON Schema for one edit, shared with the MCP tool. */
export const DIAGRAM_EDIT_JSON_SCHEMA: Record<string, unknown> = {
    type: "object",
    properties: {
        op: {
            type: "string",
            enum: [...DIAGRAM_EDIT_OPS],
            description:
                "add: a new topic (or, on a flowchart, a box) under `under`; rename: new `text` for `node`; remove: delete `node` (a topic goes with its subtopics unless keep_children); move: re-file topic `node` under topic `under`; connect / disconnect: an arrow `from` → `to`; arrange: tidy the whole page.",
        },
        under: {
            type: "string",
            description: "add, move: the id of the topic or shape it goes under.",
        },
        text: {
            type: "string",
            description:
                "add: its label — on a mind map, an indented outline adds a whole branch (first line the topic, '  - ' lines its subtopics); rename: the new label.",
        },
        after: {
            type: "string",
            description: "add, move: place it right after this sibling's id.",
        },
        shape: {
            type: "string",
            enum: [...FLOW_SHAPES],
            description:
                "add on a flowchart: process (default), decision, terminator (start/end), data, database, document, or sticky (a note).",
        },
        label: {
            type: "string",
            description: "add on a flowchart, connect: the arrow's label, e.g. yes.",
        },
        ref: {
            type: "string",
            description:
                "add: a name later edits in this call can use for the new shape, e.g. new1.",
        },
        node: { type: "string", description: "rename, remove, move: the id of the shape." },
        keep_children: {
            type: "boolean",
            description:
                "remove: keep what hangs off it — subtopics move up a level; on a flowchart, the steps before and after are joined.",
        },
        from: { type: "string", description: "connect, disconnect: the arrow's start id." },
        to: { type: "string", description: "connect, disconnect: the arrow's end id." },
    },
    required: ["op"],
    additionalProperties: false,
};

/** The parsed edits as the model layer takes them. */
export function toDiagramEdits(edits: ReadonlyArray<z.infer<typeof EditSchema>>): DiagramEdit[] {
    // "Add A and B under X" often names X only on the first add.
    let lastUnder: string | undefined;
    return edits.map(e => {
        switch (e.op) {
            case "add":
                lastUnder = e.under ?? lastUnder;
                return {
                    op: "add",
                    under: e.under ?? lastUnder,
                    text: e.text ?? "",
                    after: e.after,
                    shape: e.shape,
                    label: e.label,
                    ref: e.ref,
                };
            case "rename":
                return { op: "rename", node: e.node ?? "", text: e.text ?? "" };
            case "remove":
                return { op: "remove", node: e.node ?? "", keep_children: e.keep_children };
            case "move":
                return { op: "move", node: e.node ?? "", under: e.under ?? "", after: e.after };
            case "connect":
                return { op: "connect", from: e.from ?? "", to: e.to ?? "", label: e.label };
            case "disconnect":
                return { op: "disconnect", from: e.from ?? "", to: e.to ?? "" };
            default:
                return { op: "arrange" };
        }
    });
}

export const EditDiagramArgs = EditArgs;
export const CreateDiagramArgs = CreateArgs;

/** What a model is told about a found diagram. */
export function foundLine(d: Awaited<ReturnType<typeof findDiagrams>>[number]): string {
    const place = isUnfiledFolder(d.folder) ? "Private" : `folder "${d.folder}"`;
    const opened = d.openedAt ? `, opened ${d.openedAt.slice(0, 16).replace("T", " ")} UTC` : "";
    return `- m${d.id} "${d.title}" — ${d.nodeCount} shapes, ${place}, updated ${d.updatedAt.slice(0, 10)}${opened}${d.openedLast ? " (opened most recently)" : ""}`;
}

export function createDiagramTools(
    ctx: WorkspaceContext,
    options: DiagramToolOptions
): DiagramToolSession {
    const status = translatorFor(options.locale ?? "en", "chat.server.toolStatus");
    const touchedList: ChatCreatedSource[] = [];
    const byContent = new Map<string, ChatCreatedDiagram>();
    let creates = 0;
    let edits = 0;

    const remember = (item: ChatCreatedDiagram) => {
        const at = touchedList.findIndex(
            t => t.kind === "diagram" && t.mindmapId === item.mindmapId
        );
        if (at >= 0) {
            const prior = touchedList[at] as ChatCreatedDiagram;
            // Made in this answer and then changed: still "made".
            touchedList[at] = { ...item, edited: prior.edited === true && item.edited === true };
        } else touchedList.push(item);
    };

    const find: ChatTool = {
        name: "find_diagrams",
        description:
            "Find the person's diagrams (mind maps, flowcharts, org charts) in this workspace by words in their title or labels. " +
            "With no query, lists the ones opened most recently, newest first: when the person says 'this diagram' or 'my map', the one marked opened most recently is usually the one they have open. " +
            "Returns ids like m12 for read_diagram and edit_diagram.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "Words from the diagram's title or labels. Leave out to list recent ones.",
                },
            },
            additionalProperties: false,
        },
        describe: () => status("findingDiagrams"),
        run: async args => {
            const parsed = FindArgs.safeParse(withoutNulls(args) ?? {});
            if (!parsed.success) throw invalid(parsed.error);
            const found = await findDiagrams(ctx, { query: parsed.data.query, limit: 15 });
            if (found.length === 0) {
                return parsed.data.query
                    ? `No diagram the person can open matches "${parsed.data.query}". Try other words, or find_diagrams with no query for the recent ones.`
                    : "The person has no diagrams in this workspace yet.";
            }
            return [
                `${found.length} diagram${found.length === 1 ? "" : "s"}:`,
                ...found.map(foundLine),
            ].join("\n");
        },
    };

    const read: ChatTool = {
        name: "read_diagram",
        description:
            "Read one diagram as text: a mind map as its outline of topics, a flowchart as its shapes and arrows, every shape with its id (n_…). " +
            "Read a diagram before editing it, and to answer questions about what it shows.",
        parameters: {
            type: "object",
            properties: { diagram: { type: "string", description: "Its id, e.g. m12." } },
            required: ["diagram"],
            additionalProperties: false,
        },
        describe: () => status("readingDiagram"),
        run: async args => {
            const parsed = ReadArgs.safeParse(withoutNulls(args));
            if (!parsed.success) throw invalid(parsed.error);
            const id = parseDiagramId(parsed.data.diagram);
            const loaded = id === null ? null : await loadDiagram(ctx, id);
            if (!loaded) {
                return `No diagram "${String(parsed.data.diagram)}" that the person can open. Use an id from find_diagrams.`;
            }
            return diagramText(loaded);
        },
    };

    const tools: ChatTool[] = [find, read];

    if (options.canCreate) {
        tools.push({
            name: "create_diagram",
            description:
                "Draw a new diagram in this workspace, as a Mindmap the person can open, edit, present, share and cite. " +
                "Call it when the person asks for a diagram, mind map, flowchart, org chart, tree, process map or visual, or to draw, map out or visualise something — never on your own initiative. " +
                "type mindmap, org_chart or tree: send outline — the centre on the first line, then one topic per line, each indented two spaces under its parent, as '- ' bullets. " +
                "type flowchart: send mermaid — a Mermaid flowchart ('flowchart TD' or 'flowchart LR'). " +
                "Leave folder out to put it in the person's Private section. " +
                `At most ${MAX_CREATES} diagrams per answer.`,
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "The diagram's name, e.g. Q3 launch plan.",
                    },
                    type: {
                        type: "string",
                        enum: [...DIAGRAM_TYPES],
                        description: "mindmap, org_chart, tree or flowchart.",
                    },
                    outline: {
                        type: "string",
                        description:
                            "For mindmap, org_chart and tree. Example:\n- Q3 launch\n  - Product\n    - Beta with design partners\n  - Marketing\n    - Launch post",
                    },
                    mermaid: {
                        type: "string",
                        description:
                            "For flowchart. Example:\nflowchart TD\n  A([Order placed]) --> B{Paid?}\n  B -->|yes| C[Pack]\n  B -->|no| D[Send reminder]\n  subgraph Warehouse\n    C --> E[Ship]\n  end",
                    },
                    folder: {
                        type: "string",
                        description:
                            "Only when the person names a folder: its path. Leave out for their Private section.",
                    },
                },
                required: ["title", "type"],
                additionalProperties: false,
            },
            describe: args => {
                const title = (args as { title?: unknown } | null)?.title;
                return typeof title === "string" && title.trim()
                    ? status("drawingDiagramTitled", { title: title.trim().slice(0, 80) })
                    : status("drawingDiagram");
            },
            run: async args => {
                const parsed = CreateArgs.safeParse(withoutNulls(args));
                if (!parsed.success) throw invalid(parsed.error);
                const { title, type, outline, mermaid } = parsed.data;
                const folder = folderFrom(parsed.data.folder);
                const key = createHash("sha256")
                    .update([folder, title, type, outline ?? "", mermaid ?? ""].join("\u0000"))
                    .digest("hex");
                const earlier = byContent.get(key);
                if (earlier) {
                    return `"${earlier.title}" (m${earlier.mindmapId}) was already created. Do not create it again.`;
                }
                if (creates >= MAX_CREATES)
                    throw new Error("The diagram budget for this answer is used up. Answer now.");
                try {
                    const { row, doc } = await createDiagram(ctx, {
                        spec: { title, type, outline, mermaid },
                        folder,
                        mode: options.mode,
                        pageName: translatorFor(options.locale ?? "en", "mindmap.pages")(
                            "numbered",
                            { number: 1 }
                        ),
                    });
                    creates += 1;
                    const item = { kind: "diagram" as const, ...touched(row) };
                    remember(item);
                    byContent.set(key, item);
                    const shapes = doc.pages[0]?.nodes.length ?? 0;
                    return (
                        `Created the ${diagramKind(doc)} "${row.title}" (m${row.id}) with ${shapes} shapes, ${diagramPlace(item.folder)}. ` +
                        "The chat shows it under your answer with a preview and a button to open it in the editor."
                    );
                } catch (error) {
                    if (error instanceof DiagramSpecError) throw new Error(error.message);
                    if (error instanceof DraftFolderError) {
                        throw new Error(
                            error.reason === "denied"
                                ? `${error.message} Create it without a folder (their Private section), or ask them which folder to use.`
                                : error.message
                        );
                    }
                    throw error;
                }
            },
        });
    }

    if (options.canEdit) {
        tools.push({
            name: "edit_diagram",
            description:
                "Change an existing diagram with small operations on the ids (n_…) read_diagram shows: add, rename, remove, move, connect, disconnect, arrange. " +
                "Call it when the person asks to change, extend or tidy a diagram. All operations apply together or none do. " +
                "The result lists what changed and the diagram as it now is, with the ids of anything new.",
            parameters: {
                type: "object",
                properties: {
                    diagram: { type: "string", description: "Its id, e.g. m12." },
                    edits: { type: "array", items: DIAGRAM_EDIT_JSON_SCHEMA, maxItems: MAX_EDITS },
                },
                required: ["diagram", "edits"],
                additionalProperties: false,
            },
            describe: () => status("editingDiagram"),
            run: async args => {
                const parsed = EditArgs.safeParse(withoutNulls(args));
                if (!parsed.success) throw invalid(parsed.error);
                const id = parseDiagramId(parsed.data.diagram);
                if (id === null)
                    throw new Error(
                        `"${String(parsed.data.diagram)}" is not a diagram id. Use one like m12 from find_diagrams.`
                    );
                if (edits >= MAX_EDIT_CALLS)
                    throw new Error("The edit budget for this answer is used up. Answer now.");
                try {
                    const result = await editDiagram(ctx, id, toDiagramEdits(parsed.data.edits));
                    edits += 1;
                    remember({ kind: "diagram", ...touched(result.row), edited: true });
                    const loaded = { row: result.row, doc: result.doc, canEdit: true };
                    return [
                        "Done. The open editor (if any) picks the change up within seconds, and the version before it is kept in the diagram's history.",
                        ...result.applied,
                        "",
                        diagramText(loaded),
                    ].join("\n");
                } catch (error) {
                    if (error instanceof DiagramEditError)
                        throw new Error(`${error.message} Nothing was changed.`);
                    if (error instanceof DiagramNotFound)
                        throw new Error(`${error.message} Use an id from find_diagrams.`);
                    if (error instanceof DiagramEditDenied) {
                        throw new Error(
                            `${error.message} Tell them; someone with edit access to its folder can change it.`
                        );
                    }
                    if (error instanceof DiagramBusy) throw new Error(error.message);
                    throw error;
                }
            },
        });
    }

    return { tools, touched: touchedList, writes: options.canCreate || options.canEdit };
}

// --- what the model is told -------------------------------------------------

/** The system-prompt section that goes with the diagram tools. */
export function diagramToolsPrompt(session: Pick<DiagramToolSession, "tools">): string {
    const names = new Set(session.tools.map(t => t.name));
    const lines = ["## Diagrams"];
    lines.push(
        "This workspace has a diagram editor (Mindmap). Diagrams in it are mind maps, org charts, trees and flowcharts the person can open, edit, present and share."
    );
    if (names.has("create_diagram")) {
        lines.push(
            "When the person asks for a diagram, mind map, flowchart, org chart, process map or any visual — or to draw, map out or visualise something — create it with `create_diagram` rather than writing a list, ASCII art or a Mermaid block in the chat (unless they ask for Mermaid or code text itself). Never create one on your own initiative.",
            "Pick the type from the shape of the content: a topic broken into parts is a mindmap; reporting lines are an org_chart; a breakdown read left to right is a tree; steps, decisions and hand-offs are a flowchart.",
            "Outlines: the centre on the first line, one topic per line, children indented two spaces as '- ' bullets; labels short (two to six words), three to seven branches, no more than four levels. Flowcharts: Mermaid `flowchart TD` (or LR for wide, shallow flows); starts and ends as ([...]), decisions as {...} with every branch labelled (-->|yes|), stores as [(...)], and `subgraph Name ... end` for phases, teams or systems.",
            "When the diagram is about their company, product, customers or plans, look through their sources first and draw what they say; mark anything that comes from no source as an assumption in its label (e.g. 'Pricing (assumption)')."
        );
    }
    lines.push(
        "To answer about or change an existing diagram, call `find_diagrams` (with no query it lists the ones opened most recently; the first is usually the one on screen when they say 'this'), then `read_diagram`." +
            (names.has("edit_diagram")
                ? " Change it with `edit_diagram`, naming shapes by the ids (n_…) read_diagram shows; prefer small edits to drawing it again, and say which diagram you changed."
                : " You cannot change diagrams for this person here; describe the change for them to make.")
    );
    if (names.has("create_diagram") || names.has("edit_diagram")) {
        lines.push(
            "Only after the tool confirms, answer in a few short lines: what you drew or changed and where it is, which sources it rests on, and the one or two things most worth checking. Do not repeat the diagram as a list. If a call fails, say what failed and that nothing was saved; never claim a diagram was made or changed when the tool did not confirm it."
        );
    }
    return lines.join("\n");
}
