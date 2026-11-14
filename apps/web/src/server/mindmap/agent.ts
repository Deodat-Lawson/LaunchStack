/**
 * Diagrams as an AI tool: find, read, create and edit Mindmap drafts on a
 * person's behalf. Ask's tools (`~/server/chat-diagram-tools`) and the MCP
 * tools (`~/server/mcp/tools/diagrams`) are thin wrappers over this, so both
 * follow the rules a person in the editor follows:
 *
 * - **Reading** sees only the drafts the person may open (ADR-014: a draft
 *   follows its folder; an Unfiled one is its creator's alone).
 * - **Creating** goes through `createMindmapDraft`, the gallery's path: no
 *   folder means the person's Private section; a folder takes edit access.
 * - **Editing** takes edit access to the draft. It reads the saved document,
 *   applies the edits through the editor's commands (`agent-edits.ts`) and
 *   writes only if nobody saved in between (a compare-and-set on
 *   `revision`), trying once more on a fresh read if someone did. An open
 *   editor learns of the new revision from its presence heartbeat within
 *   seconds and reloads it. The document as it was is kept in its version
 *   history, so an AI edit can always be taken back.
 */

import { and, eq } from "drizzle-orm";

import { parseThemeChoice } from "@launchstack/design-tokens/theme";
import {
    AI_EDIT_SNAPSHOT_LABEL,
    describeDiagram,
    pageStyle,
    runDiagramEdits,
    type DiagramEdit,
} from "~/app/employer/documents/_mindmap/model/agent-edits";
import { activePage } from "~/app/employer/documents/_mindmap/model/doc";
import { buildDiagram, type DiagramSpec } from "~/app/employer/documents/_mindmap/model/generate";
import type { ThemeMode } from "~/app/employer/documents/_mindmap/model/palette";
import { parseDoc } from "~/app/employer/documents/_mindmap/model/serialize";
import { nonEmpty } from "~/app/employer/documents/_mindmap/model/strings";
import type { MindmapDoc } from "~/app/employer/documents/_mindmap/model/types";
import { isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { mindmaps, type Mindmap } from "~/server/db/schema";

import { canEditDraftAt, draftAccess, draftReader } from "./access";
import { createMindmapDraft } from "./create";
import {
    getMindmap,
    listMindmaps,
    summariseDoc,
    writeRevision,
    type MindmapSummary,
} from "./repository";

export { DiagramEditError } from "~/app/employer/documents/_mindmap/model/agent-edits";
export { DiagramSpecError } from "~/app/employer/documents/_mindmap/model/generate";
export { DraftFolderError } from "./create";

/** A diagram an AI made or changed, for the chat to show and open. */
export interface DiagramTouched {
    mindmapId: number;
    title: string;
    /** Its folder path; Unfiled is the person's Private section. */
    folder: string;
}

/** The app's own link to a diagram: opens its preview tab for anyone who can see it. */
export function diagramUrl(origin: string, mindmapId: number): string {
    return `${origin}/employer/documents?source=m${mindmapId}`;
}

/** A diagram id as tools accept it: `m12`, `12`, or `[m12]`. */
export function parseDiagramId(raw: unknown): number | null {
    if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
    if (typeof raw !== "string") return null;
    const match = /^\[?\s*m?(\d{1,15})\s*\]?$/i.exec(raw.trim());
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The lighting a new diagram is drawn in: the creator's app theme, from the
 * `ls-theme` cookie when the request has one. The app opens dark unless
 * someone chose light (`appearance.theme` defaults to dark), so dark is the
 * default here too. A read-only preview re-lights a board for whoever reads
 * it, so this only decides what the editor opens on.
 */
export function creatorThemeMode(cookieHeader: string | null | undefined): ThemeMode {
    const choice = cookieHeader ? parseThemeChoice(cookieHeader) : null;
    return choice?.theme === "light" ? "light" : "dark";
}

export function touched(row: Pick<Mindmap, "id" | "title" | "folder">): DiagramTouched {
    return { mindmapId: row.id, title: row.title, folder: normalizeFolderPath(row.folder) };
}

/** What kind of picture a document is, in a model's words. */
export function diagramKind(doc: MindmapDoc): string {
    const page = activePage(doc);
    if (pageStyle(page) === "topics") {
        const layout = doc.settings.autoLayout?.kind;
        return layout === "org" ? "org chart" : layout === "tree" ? "tree" : "mind map";
    }
    return doc.settings.kind === "board" ? "board" : "flowchart";
}

/** Where a diagram is, said to a model. */
export function diagramPlace(folder: string): string {
    return isUnfiledFolder(folder)
        ? "in the person's Private section (only they can open it until they share it)"
        : `in the folder "${folder}", with that folder's sharing`;
}

// ---------------------------------------------------------------------------
// Find + read
// ---------------------------------------------------------------------------

export interface FoundDiagram extends MindmapSummary {
    /** True for the one opened most recently — usually the one on screen. */
    openedLast: boolean;
}

/**
 * The person's diagrams matching `query` (title or any label), or — with no
 * query — the ones opened most recently, first.
 */
export async function findDiagrams(
    ctx: WorkspaceContext,
    options: { query?: string; limit?: number } = {}
): Promise<FoundDiagram[]> {
    const reader = await draftReader(ctx);
    const limit = Math.min(Math.max(options.limit ?? 15, 1), 50);
    const query = nonEmpty(options.query);
    const rows = await listMindmaps(reader, {
        scope: "active",
        search: nonEmpty(query),
        limit: query ? limit : 200,
    });
    const opened = (row: MindmapSummary) => (row.openedAt ? Date.parse(row.openedAt) : 0);
    const ordered = query ? rows : [...rows].sort((a, b) => opened(b) - opened(a));
    const newest = Math.max(0, ...rows.map(opened));
    return ordered.slice(0, limit).map(row => ({
        ...row,
        openedLast: newest > 0 && opened(row) === newest,
    }));
}

export interface LoadedDiagram {
    row: Mindmap;
    doc: MindmapDoc;
    canEdit: boolean;
}

/** One diagram the person may open, parsed; null when it does not exist or they may not (the two read alike). */
export async function loadDiagram(
    ctx: WorkspaceContext,
    mindmapId: number
): Promise<LoadedDiagram | null> {
    const row = await getMindmap(mindmapId, await draftReader(ctx));
    if (!row || row.deletedAt) return null;
    const access = await draftAccess(ctx, row);
    return { row, doc: parseDoc(row.doc, row.title), canEdit: canEditDraftAt(access.level) };
}

/** A diagram as a model reads it: what it is, where, and every shape with its id. */
export function diagramText(loaded: LoadedDiagram): string {
    const { row, doc } = loaded;
    return [
        `Diagram "${row.title}" (m${row.id}): a ${diagramKind(doc)}, ${diagramPlace(normalizeFolderPath(row.folder))}.`,
        loaded.canEdit
            ? "You can change it with edit_diagram, naming shapes by their ids (the n_… after each label)."
            : "The person can view this diagram but not change it.",
        describeDiagram(doc),
        ...(loaded.canEdit
            ? [
                  "Nothing is changed until edit_diagram confirms it; never say a change was made before then.",
              ]
            : []),
    ].join("\n");
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateDiagramInput {
    spec: DiagramSpec;
    folder?: string | null;
    mode: ThemeMode;
    /** The first page's name, in the person's language. */
    pageName?: string;
}

/** Build and save a new draft. Throws `DiagramSpecError` or `DraftFolderError`. */
export async function createDiagram(
    ctx: WorkspaceContext,
    input: CreateDiagramInput
): Promise<{ row: Mindmap; doc: MindmapDoc }> {
    const doc = buildDiagram(input.spec, { mode: input.mode, pageName: input.pageName });
    const row = await createMindmapDraft(ctx, { title: doc.title, folder: input.folder, doc });
    return { row, doc };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/** The diagram is not there, or the person may not open it. */
export class DiagramNotFound extends Error {
    constructor(readonly mindmapId: number) {
        super(`No diagram m${mindmapId} that the person can open.`);
        this.name = "DiagramNotFound";
    }
}

/** The person may open the diagram but not change it. */
export class DiagramEditDenied extends Error {
    constructor(readonly mindmapId: number) {
        super(`The person can view diagram m${mindmapId} but not change it.`);
        this.name = "DiagramEditDenied";
    }
}

/** Someone kept saving over the edit; it was not applied. */
export class DiagramBusy extends Error {
    constructor(readonly mindmapId: number) {
        super(
            `Diagram m${mindmapId} changed while the edit was being saved. Read it again and retry.`
        );
        this.name = "DiagramBusy";
    }
}

export interface EditDiagramResult {
    row: Mindmap;
    doc: MindmapDoc;
    applied: string[];
    added: string[];
}

/**
 * Apply `edits` to the saved diagram and save the result as the next
 * revision, keeping the diagram as it was in its version history.
 */
export async function editDiagram(
    ctx: WorkspaceContext,
    mindmapId: number,
    edits: readonly DiagramEdit[]
): Promise<EditDiagramResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const loaded = await loadDiagram(ctx, mindmapId);
        if (!loaded) throw new DiagramNotFound(mindmapId);
        if (!loaded.canEdit) throw new DiagramEditDenied(mindmapId);
        const current = loaded.row;

        // Throws DiagramEditError with a message for the model; nothing saved.
        const result = runDiagramEdits(loaded.doc, edits);
        const stats = summariseDoc(result.doc);
        const [row] = await db
            .update(mindmaps)
            .set({
                doc: result.doc,
                docVersion: result.doc.schemaVersion,
                revision: current.revision + 1,
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                searchText: stats.searchText,
                updatedByUserId: ctx.authUserId,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(mindmaps.id, mindmapId),
                    eq(mindmaps.companyId, ctx.companyId),
                    eq(mindmaps.revision, current.revision)
                )
            )
            .returning();
        if (!row) continue; // Saved over in between: read again and redo.

        // Post-commit and non-fatal, like the editor's ⌘S snapshot.
        try {
            await writeRevision({
                mindmapId,
                revision: current.revision,
                doc: current.doc,
                authorUserId: current.updatedByUserId ?? current.createdByUserId,
                label: AI_EDIT_SNAPSHOT_LABEL,
                nodeCount: current.nodeCount,
            });
        } catch (error) {
            console.error("[mindmap-agent] could not keep the pre-edit version:", error);
        }
        return { row, doc: result.doc, applied: result.applied, added: result.added };
    }
    throw new DiagramBusy(mindmapId);
}
