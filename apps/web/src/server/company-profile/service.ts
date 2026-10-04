/**
 * Company profile service: what the profile routes do. Reads are scoped to
 * the viewer's documents; builds read every document in the workspace (the
 * profile is workspace-wide state). Builds and source re-reads run after the
 * response, the way proposals runs do, and the screen polls while the row
 * says "building".
 */
import { after } from "next/server";

import {
    applyFactEdit,
    catchUpAndAssemble,
    createEmptyMetadata,
    diffMetadata,
    getProfileRow,
    listSourceRows,
    listWorkspaceDocuments,
    rebuildProfile,
    recordOverride,
    refreshForDocument,
    finishBuild,
    saveProfileLocked,
    setBuildStatus,
    startBuildIfIdle,
    type FactEdit,
    type ProfileBuildPorts,
    type SourceOverride,
} from "@launchstack/pipelines/company-metadata";
import { getCompanyIdentity } from "@launchstack/tools/company-context";

import { scopeAllows } from "~/lib/authz/scope";
import type { CompanyProfileDto } from "~/lib/company-profile/dto";
import { generateStructured } from "~/lib/llm";
import type { WorkspaceContext } from "~/lib/require-workspace-context";

import { isBuilding, toCompanyProfileDto } from "./adapter";

export class CompanyProfileError extends Error {
    readonly code = "company_profile";
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "CompanyProfileError";
    }
}

/** The model the builder calls: the small extraction route, as the old extractor did. */
export function createProfilePorts(): ProfileBuildPorts {
    return {
        generate: input => generateStructured({ ...input, capability: "smallExtraction" }),
        modelId: "smallExtraction",
    };
}

type Ctx = Pick<WorkspaceContext, "companyId" | "authUserId" | "can" | "documentScope">;

export async function loadCompanyProfile(ctx: Ctx): Promise<CompanyProfileDto> {
    const [row, sources, documents, scope, identity] = await Promise.all([
        getProfileRow(ctx.companyId),
        listSourceRows(ctx.companyId),
        listWorkspaceDocuments(ctx.companyId),
        ctx.documentScope(),
        getCompanyIdentity({ companyId: Number(ctx.companyId) }),
    ]);
    return toCompanyProfileDto({
        row,
        sources,
        documents,
        name: identity.data.name,
        canEdit: ctx.can("settings.manage"),
        canSee: doc => scopeAllows(scope, { id: doc.id, category: doc.folder }),
        now: new Date(),
    });
}

/** Start a rebuild unless one is already running; returns the profile as "building". */
export async function startRebuild(ctx: Ctx): Promise<CompanyProfileDto> {
    const row = await getProfileRow(ctx.companyId);
    if (!isBuilding(row, new Date())) {
        await setBuildStatus(ctx.companyId, "building");
        const companyId = ctx.companyId;
        const changedBy = ctx.authUserId;
        after(async () => {
            try {
                await rebuildProfile(companyId, createProfilePorts(), { changedBy });
            } catch (error) {
                console.error("[company-profile] rebuild failed:", error);
            }
        });
    }
    return loadCompanyProfile(ctx);
}

export async function editFact(ctx: Ctx, edit: FactEdit): Promise<CompanyProfileDto> {
    if (!ctx.can("settings.manage"))
        throw new CompanyProfileError("Only workspace admins can edit the company profile", 403);
    let failure = null as string | null;
    await saveProfileLocked(
        ctx.companyId,
        current => {
            const metadata = structuredClone(current ?? createEmptyMetadata(String(ctx.companyId)));
            const outcome = applyFactEdit(metadata, edit);
            if (!outcome.ok) {
                // Nothing is written for a refused edit.
                failure = outcome.error;
                return null;
            }
            metadata.updated_at = new Date().toISOString();
            return { metadata, diff: diffMetadata(current, metadata) };
        },
        // An edit is not a build: "built …" keeps meaning when the sources were last read.
        { changedBy: ctx.authUserId, changeType: "manual_override", built: false }
    );
    if (failure) throw new CompanyProfileError(failure, 400);
    // Reassemble after the response: a reset brings the sources' value back, and
    // any edit changes the facts the summary was written from.
    await reassembleAfterResponse(ctx.companyId, ctx.authUserId);
    return loadCompanyProfile(ctx);
}

/**
 * Run `work` after the response. When no build is running, the profile says
 * "building" until it ends; during a Rebuild the status is left to the
 * Rebuild, so this never marks it done early.
 */
async function buildAfterResponse(
    companyId: bigint,
    label: string,
    work: () => Promise<unknown>
): Promise<void> {
    const token = await startBuildIfIdle(companyId);
    after(async () => {
        try {
            await work();
            if (token) await finishBuild(companyId, token, "idle");
        } catch (error) {
            console.error(`[company-profile] ${label} failed:`, error);
            if (token)
                await finishBuild(
                    companyId,
                    token,
                    "failed",
                    error instanceof Error ? error.message.slice(0, 500) : `${label} failed`
                );
        }
    });
}

/** Reassemble after the response, reading only what is stale. */
export async function reassembleAfterResponse(companyId: bigint, changedBy: string): Promise<void> {
    await buildAfterResponse(companyId, "reassembly", () =>
        catchUpAndAssemble(companyId, createProfilePorts(), { changedBy })
    );
}

/** Record a person's decision about one source, then re-read it and reassemble after the response. */
export async function setSourceOverride(
    ctx: Ctx,
    documentId: number,
    override: SourceOverride | null
): Promise<CompanyProfileDto> {
    if (!ctx.can("settings.manage"))
        throw new CompanyProfileError("Only workspace admins can decide which sources count", 403);
    const scope = await ctx.documentScope();
    const documents = await listWorkspaceDocuments(ctx.companyId);
    const doc = documents.find(d => d.id === documentId);
    if (!doc || !scopeAllows(scope, { id: doc.id, category: doc.folder }))
        throw new CompanyProfileError("Source not found", 404);
    await recordOverride(ctx.companyId, documentId, override, ctx.authUserId);
    const companyId = ctx.companyId;
    await buildAfterResponse(companyId, "source refresh", () =>
        refreshForDocument(companyId, documentId, createProfilePorts())
    );
    return loadCompanyProfile(ctx);
}

/**
 * Documents left the workspace: their source rows went with them (cascade),
 * so reassemble and their facts go too. After the response; nothing to do
 * for a workspace that never built a profile.
 */
export function reassembleAfterDelete(companyId: bigint, changedBy: string): void {
    after(async () => {
        try {
            const row = await getProfileRow(companyId);
            if (!row?.builtAt) return;
            await catchUpAndAssemble(companyId, createProfilePorts(), { changedBy });
        } catch (error) {
            console.error("[company-profile] reassembly after delete failed:", error);
        }
    });
}
