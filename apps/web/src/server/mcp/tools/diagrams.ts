/**
 * Diagram tools for assistants connected over MCP — the same four Ask has
 * (`~/server/chat-diagram-tools`), over the same service
 * (`~/server/mindmap/agent`), so Claude or ChatGPT drawing in LaunchStack
 * follows the editor's rules:
 *
 * - `list_diagrams` / `read_diagram` see only the drafts the person may open
 *   (a draft follows its folder; an Unfiled one is its creator's alone);
 * - `create_diagram` makes a draft in the person's Private section unless
 *   they name a folder they can add to — a private draft widens nothing, so
 *   unlike `add_document` it does not stop to ask where it goes;
 * - `edit_diagram` takes edit access to the draft and never writes over a
 *   save it did not see; the version before is kept in its history.
 *
 * The assistant's model writes the diagram (an outline or a Mermaid
 * flowchart); nothing here calls a model.
 */
import { z } from "zod";

import { MAX_EDITS } from "~/app/employer/documents/_mindmap/model/agent-edits";
import { DIAGRAM_TYPES } from "~/app/employer/documents/_mindmap/model/generate";
import {
    CreateDiagramArgs,
    DIAGRAM_EDIT_JSON_SCHEMA,
    EditDiagramArgs,
    toDiagramEdits,
} from "~/server/chat-diagram-tools";
import { UNFILED_FOLDER, isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
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
    diagramUrl,
    editDiagram,
    findDiagrams,
    loadDiagram,
    parseDiagramId,
} from "~/server/mindmap/agent";

import { MCP_SCOPE_WRITE } from "../config";
import { defineTool } from "../protocol";
import { READ_ONLY_ANNOTATIONS, READ_REQUIREMENT, countArgument } from "./shared";

/** New diagrams and edits per credential: generous for a working session, a cap for a runaway loop. */
const DIAGRAM_WRITE_RATE_LIMIT = { maxRequests: 120, windowMs: 15 * 60 * 1000 };

const DIAGRAM_ID_SCHEMA = {
    type: "string",
    maxLength: 32,
    description: "The diagram's id from list_diagrams or create_diagram, e.g. m12.",
} as const;

function notFound(raw: unknown): string {
    return `No diagram "${String(raw)}" was found among the diagrams you can open in this workspace. Use an id from list_diagrams.`;
}

// ---------------------------------------------------------------------------
// list_diagrams
// ---------------------------------------------------------------------------

export const listDiagramsTool = defineTool({
    name: "list_diagrams",
    title: "List LaunchStack diagrams",
    description:
        "List the person's diagrams in LaunchStack (mind maps, flowcharts, org charts): with query, those whose title or labels match; without, the ones opened most recently, newest first — the first is usually the one they have open. " +
        "Returns ids (m12) for read_diagram and edit_diagram, and a url to open each.",
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                maxLength: 200,
                description: "Words from the title or labels.",
            },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 15 },
        },
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            diagrams: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        folder: { type: "string" },
                        shapes: { type: "integer" },
                        updatedAt: { type: "string" },
                        openedAt: { type: "string" },
                        openedMostRecently: { type: "boolean" },
                        url: { type: "string" },
                    },
                    required: ["id", "title", "folder", "shapes", "updatedAt", "url"],
                },
            },
        },
        required: ["diagrams"],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    requires: READ_REQUIREMENT,
    args: z.object({
        query: z.string().trim().max(200).optional(),
        limit: countArgument(1, 50, 15),
    }),
    async run({ query, limit }, { principal, origin }) {
        const found = await findDiagrams(principal.ctx, { query, limit });
        const diagrams = found.map(d => ({
            id: `m${d.id}`,
            title: d.title,
            folder: isUnfiledFolder(d.folder) ? "Private" : d.folder,
            shapes: d.nodeCount,
            updatedAt: d.updatedAt,
            openedAt: d.openedAt ?? undefined,
            openedMostRecently: d.openedLast || undefined,
            url: diagramUrl(origin, d.id),
        }));
        const text =
            diagrams.length === 0
                ? query
                    ? `No diagram matches "${query}".`
                    : "No diagrams in this workspace yet."
                : diagrams
                      .map(
                          d =>
                              `${d.id} "${d.title}" — ${d.shapes} shapes, ${d.folder}${d.openedMostRecently ? " (opened most recently)" : ""} — ${d.url}`
                      )
                      .join("\n");
        return { ok: true, text, structured: { diagrams } };
    },
});

// ---------------------------------------------------------------------------
// read_diagram
// ---------------------------------------------------------------------------

export const readDiagramTool = defineTool({
    name: "read_diagram",
    title: "Read a LaunchStack diagram",
    description:
        "Read one diagram as text: a mind map as its outline of topics, a flowchart as its shapes and arrows, every shape with its id (n_…) for edit_diagram.",
    inputSchema: {
        type: "object",
        properties: { diagram: DIAGRAM_ID_SCHEMA },
        required: ["diagram"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            id: { type: "string" },
            title: { type: "string" },
            kind: { type: "string" },
            canEdit: { type: "boolean" },
            url: { type: "string" },
        },
        required: ["id", "title", "kind", "canEdit", "url"],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    requires: READ_REQUIREMENT,
    args: z.object({ diagram: z.union([z.string().trim().max(32), z.number()]) }),
    async run({ diagram }, { principal, origin }) {
        const id = parseDiagramId(diagram);
        const loaded = id === null ? null : await loadDiagram(principal.ctx, id);
        if (!loaded) return { ok: false, message: notFound(diagram) };
        return {
            ok: true,
            text: `${diagramText(loaded)}\nOpen it: ${diagramUrl(origin, loaded.row.id)}`,
            structured: {
                id: `m${loaded.row.id}`,
                title: loaded.row.title,
                kind: diagramKind(loaded.doc),
                canEdit: loaded.canEdit,
                url: diagramUrl(origin, loaded.row.id),
            },
        };
    },
});

// ---------------------------------------------------------------------------
// create_diagram
// ---------------------------------------------------------------------------

export const createDiagramTool = defineTool({
    name: "create_diagram",
    title: "Create a LaunchStack diagram",
    description:
        "Draw a new diagram in the person's LaunchStack workspace, as a Mindmap they can open, edit, present, share and cite. " +
        "type mindmap, org_chart or tree: send outline — the centre on the first line, then one topic per line, each indented two spaces under its parent, as '- ' bullets. " +
        "type flowchart: send mermaid — a Mermaid flowchart ('flowchart TD' or 'flowchart LR'), decisions as {...} with labelled branches, subgraph blocks for phases or teams. " +
        "It goes in the person's Private section (only they can see it) unless they name a folder. Returns its id and a url to open it.",
    inputSchema: {
        type: "object",
        properties: {
            title: { type: "string", maxLength: 200 },
            type: { type: "string", enum: [...DIAGRAM_TYPES] },
            outline: { type: "string", maxLength: 40_000 },
            mermaid: { type: "string", maxLength: 40_000 },
            folder: {
                type: "string",
                maxLength: 256,
                description: "Only when the person names a folder: its path, like 'Product/Plans'.",
            },
        },
        required: ["title", "type"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            id: { type: "string" },
            title: { type: "string" },
            kind: { type: "string" },
            shapes: { type: "integer" },
            folder: { type: "string" },
            url: { type: "string" },
        },
        required: ["id", "title", "kind", "shapes", "folder", "url"],
    },
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    },
    requires: { scope: MCP_SCOPE_WRITE, permission: "documents.upload" },
    rateLimit: DIAGRAM_WRITE_RATE_LIMIT,
    args: CreateDiagramArgs,
    async run({ title, type, outline, mermaid, folder }, { principal, origin }) {
        const path = normalizeFolderPath(folder);
        try {
            const { row, doc } = await createDiagram(principal.ctx, {
                spec: { title, type, outline, mermaid },
                folder: isUnfiledFolder(path) || /^private$/i.test(path) ? UNFILED_FOLDER : path,
                // No browser to read a theme from: the app's default lighting.
                mode: "dark",
            });
            const url = diagramUrl(origin, row.id);
            return {
                ok: true,
                text: `Created the ${diagramKind(doc)} "${row.title}" (m${row.id}), ${diagramPlace(normalizeFolderPath(row.folder))}. Open it: ${url}`,
                structured: {
                    id: `m${row.id}`,
                    title: row.title,
                    kind: diagramKind(doc),
                    shapes: doc.pages[0]?.nodes.length ?? 0,
                    folder: isUnfiledFolder(row.folder)
                        ? "Private"
                        : normalizeFolderPath(row.folder),
                    url,
                },
            };
        } catch (error) {
            if (error instanceof DiagramSpecError) return { ok: false, message: error.message };
            if (error instanceof DraftFolderError) {
                return {
                    ok: false,
                    message:
                        error.reason === "denied"
                            ? `${error.message} Create it without a folder (their Private section), or ask which folder to use.`
                            : error.message,
                };
            }
            throw error;
        }
    },
});

// ---------------------------------------------------------------------------
// edit_diagram
// ---------------------------------------------------------------------------

export const editDiagramTool = defineTool({
    name: "edit_diagram",
    title: "Edit a LaunchStack diagram",
    description:
        "Change an existing diagram with small operations naming the ids read_diagram shows: add, rename, remove, move, connect, disconnect, arrange. " +
        "All operations apply together or none do; the version before is kept in the diagram's history. Returns what changed and the diagram as it now is.",
    inputSchema: {
        type: "object",
        properties: {
            diagram: DIAGRAM_ID_SCHEMA,
            edits: {
                type: "array",
                items: DIAGRAM_EDIT_JSON_SCHEMA,
                minItems: 1,
                maxItems: MAX_EDITS,
            },
        },
        required: ["diagram", "edits"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            id: { type: "string" },
            title: { type: "string" },
            revision: { type: "integer" },
            applied: { type: "array", items: { type: "string" } },
            added: { type: "array", items: { type: "string" } },
            url: { type: "string" },
        },
        required: ["id", "title", "revision", "applied", "added", "url"],
    },
    // Not destructive: the version before every edit is kept in the
    // diagram's history, so nothing an edit removes is lost.
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    },
    requires: { scope: MCP_SCOPE_WRITE, permission: "documents.edit" },
    rateLimit: DIAGRAM_WRITE_RATE_LIMIT,
    args: EditDiagramArgs,
    async run({ diagram, edits }, { principal, origin }) {
        const id = parseDiagramId(diagram);
        if (id === null) return { ok: false, message: notFound(diagram) };
        try {
            const result = await editDiagram(principal.ctx, id, toDiagramEdits(edits));
            const url = diagramUrl(origin, id);
            return {
                ok: true,
                text: [
                    ...result.applied,
                    "",
                    diagramText({ row: result.row, doc: result.doc, canEdit: true }),
                    `Open it: ${url}`,
                ].join("\n"),
                structured: {
                    id: `m${id}`,
                    title: result.row.title,
                    revision: result.row.revision,
                    applied: result.applied,
                    added: result.added,
                    url,
                },
            };
        } catch (error) {
            if (error instanceof DiagramEditError)
                return { ok: false, message: `${error.message} Nothing was changed.` };
            if (error instanceof DiagramNotFound) return { ok: false, message: notFound(diagram) };
            if (error instanceof DiagramEditDenied || error instanceof DiagramBusy) {
                return { ok: false, message: error.message };
            }
            throw error;
        }
    },
});
