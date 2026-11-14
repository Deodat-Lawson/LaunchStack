/**
 * Making a mindmap draft — the one path for every creator: the gallery
 * (`POST /api/mindmaps`), Ask's `create_diagram`, the MCP tool of the same
 * name, and "Generate with AI".
 *
 * A draft in a folder takes edit access to that folder, as adding a file
 * does, and a folder path that does not exist yet comes into being private
 * to its creator. A draft with no folder (Unfiled) is the creator's alone
 * until they share it (ADR-014, `./access`).
 */

import { trimmedOr } from "~/app/employer/documents/_mindmap/model/strings";
import { db } from "~/server/db";
import { mindmaps, type Mindmap } from "~/server/db/schema";
import { isUnfiledFolder, normalizeFolderPath, validateFolderPath } from "~/lib/folders/path";
import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { canEditFolderPath } from "~/server/workspace/item-access";
import { claimFolderPathForDraft } from "~/server/workspace/ownership";

import { summariseDoc } from "./repository";

export interface CreateDraftInput {
    title?: string | null;
    description?: string | null;
    templateId?: string | null;
    /** A folder path; empty or Unfiled is the creator's Private section. */
    folder?: string | null;
    /** The document; absent for the editor's blank-map path, which fills it on first save. */
    doc?: unknown;
}

/** Why a draft could not be made where it was asked for. */
export class DraftFolderError extends Error {
    constructor(
        readonly reason: "invalid" | "denied",
        readonly folder: string,
        /** For "invalid": the path problem, in English. */
        readonly problem?: string
    ) {
        super(
            reason === "denied"
                ? `The person cannot add to the folder "${folder}".`
                : `"${folder}" is not a valid folder path: ${problem ?? "invalid"}.`
        );
        this.name = "DraftFolderError";
    }
}

/** An empty document, for a create that carries none. */
function blankDoc(title: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        title,
        pages: [],
        activePageId: "",
        comments: [],
        settings: {},
    };
}

/**
 * Insert a draft for `ctx`'s person. Throws {@link DraftFolderError} for a
 * folder they cannot add to or a path that is not one; callers word it (a
 * route can check the path first, to word it in the request's language).
 */
export async function createMindmapDraft(
    ctx: WorkspaceContext,
    input: CreateDraftInput
): Promise<Mindmap> {
    const title = trimmedOr(input.title, "Untitled mindmap");
    const doc = input.doc ?? blankDoc(title);
    const stats = summariseDoc(doc);

    const folder = normalizeFolderPath(input.folder ?? undefined);
    if (!isUnfiledFolder(folder)) {
        const problem = validateFolderPath(folder);
        if (problem) throw new DraftFolderError("invalid", folder, problem);
        if (!(await canEditFolderPath(ctx, folder))) throw new DraftFolderError("denied", folder);
    }

    const row = await db.transaction(async tx => {
        await claimFolderPathForDraft(tx, ctx, folder);
        const [inserted] = await tx
            .insert(mindmaps)
            .values({
                companyId: ctx.companyId,
                createdByUserId: ctx.authUserId,
                updatedByUserId: ctx.authUserId,
                title,
                description: input.description ?? null,
                templateId: input.templateId ?? null,
                folder,
                doc,
                docVersion:
                    typeof (doc as { schemaVersion?: unknown }).schemaVersion === "number"
                        ? (doc as { schemaVersion: number }).schemaVersion
                        : 1,
                revision: 1,
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                searchText: stats.searchText,
                openedAt: new Date(),
            })
            .returning();
        return inserted;
    });
    if (!row) throw new Error("The mindmap row was not created.");
    return row;
}
