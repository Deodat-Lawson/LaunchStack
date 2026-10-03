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
    assembleProfile,
    createEmptyMetadata,
    diffMetadata,
    getProfileRow,
    listSourceRows,
    listWorkspaceDocuments,
    rebuildProfile,
    recordOverride,
    refreshForDocument,
    saveProfileLocked,
    setBuildStatus,
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
                failure = outcome.error;
                return {
                    metadata: current ?? metadata,
                    diff: { added: [], updated: [], deprecated: [] },
                };
            }
            metadata.updated_at = new Date().toISOString();
            return { metadata, diff: diffMetadata(current, metadata) };
        },
        { changedBy: ctx.authUserId, changeType: "manual_override" }
    );
    if (failure) throw new CompanyProfileError(failure, 400);
    // The sources' value was overwritten in place by the edit; reassembling brings it back.
    if (edit.reset) await reassembleAfterResponse(ctx.companyId, ctx.authUserId);
    return loadCompanyProfile(ctx);
}

/** Reassemble from the source rows after the response (no source is re-read). */
async function reassembleAfterResponse(companyId: bigint, changedBy: string): Promise<void> {
    await setBuildStatus(companyId, "building");
    after(async () => {
        try {
            await assembleProfile(companyId, createProfilePorts(), { changedBy });
            await setBuildStatus(companyId, "idle");
        } catch (error) {
            console.error("[company-profile] reassembly failed:", error);
            await setBuildStatus(
                companyId,
                "failed",
                error instanceof Error ? error.message.slice(0, 500) : "Reassembly failed"
            );
        }
    });
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
    await setBuildStatus(ctx.companyId, "building");
    const companyId = ctx.companyId;
    after(async () => {
        try {
            await refreshForDocument(companyId, documentId, createProfilePorts());
            await setBuildStatus(companyId, "idle");
        } catch (error) {
            console.error("[company-profile] source refresh failed:", error);
            await setBuildStatus(
                companyId,
                "failed",
                error instanceof Error ? error.message.slice(0, 500) : "Reading the source failed"
            );
        }
    });
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
            await assembleProfile(companyId, createProfilePorts(), { changedBy });
        } catch (error) {
            console.error("[company-profile] reassembly after delete failed:", error);
        }
    });
}
