import {
    AcceleratorError,
    hashValue,
    type HomeResponse,
    type ProgramView,
} from "@launchstack/pipelines/accelerators";
import { listCatalogue, listCompanyMatches } from "@launchstack/pipelines/accelerators/db";
import { PROPOSAL_CREDITS, type RunRecord } from "@launchstack/pipelines/proposals";
import { findLiveRun, getRun, loadOrgProfile } from "@launchstack/pipelines/proposals/db";

import type { AcceleratorRunView } from "~/app/employer/tools/accelerators/api";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { startProposalRun } from "~/server/proposals/executor";
import { runCopy } from "~/server/proposals/copy";

export const ACCELERATOR_COSTS = {
    match: PROPOSAL_CREDITS.programs,
};

export function toAcceleratorRunView(run: RunRecord): AcceleratorRunView {
    if (run.kind !== "programs") {
        throw new AcceleratorError("Run not found", 404, "run_not_found");
    }
    return {
        id: run.id,
        kind: run.kind,
        status: run.status,
        steps: run.steps,
        summary: run.summary,
        error: run.error,
        errorCopy: runCopy({ headline: null, error: run.error }).errorCopy,
        creditsUsed: run.creditsUsed,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}

export async function loadAccelerators(member: WorkspaceContext): Promise<HomeResponse> {
    const [catalogue, matches, profile] = await Promise.all([
        listCatalogue(),
        listCompanyMatches(member.companyId),
        loadOrgProfile(member.companyId, await member.documentScope()),
    ]);
    const profileHash = profile ? hashValue(profile) : null;
    const programs = catalogue
        .map(({ program, contentHash }): ProgramView => {
            const fit = matches[program.id] ?? null;
            return {
                program,
                contentHash,
                fit,
                fitStale:
                    fit !== null &&
                    (fit.profileHash !== profileHash || fit.programHash !== contentHash),
            };
        })
        .sort((a, b) => {
            const scoreA = a.fitStale ? -1 : (a.fit?.assessment.score ?? -1);
            const scoreB = b.fitStale ? -1 : (b.fit?.assessment.score ?? -1);
            return scoreB - scoreA || a.program.name.localeCompare(b.program.name);
        });
    return {
        programs,
        profileReady:
            profile !== null && (profile.facts.length > 0 || profile.summary.trim().length > 0),
        canEdit: member.can("documents.edit"),
        costs: ACCELERATOR_COSTS,
    };
}

export async function loadAcceleratorProgram(
    member: WorkspaceContext,
    id: string
): Promise<ProgramView> {
    const home = await loadAccelerators(member);
    const program = home.programs.find(view => view.program.id === id);
    if (!program) throw new AcceleratorError("Program not found", 404, "program_not_found");
    return program;
}

async function assertNoLiveRun(companyId: bigint): Promise<void> {
    if (await findLiveRun(companyId, { includeAccelerators: true })) {
        throw new AcceleratorError("A company run is already in progress", 409, "run_in_progress");
    }
}

export async function matchPrograms(member: WorkspaceContext): Promise<AcceleratorRunView> {
    const profile = await loadOrgProfile(member.companyId, await member.documentScope());
    if (!profile || (!profile.facts.length && !profile.summary.trim())) {
        throw new AcceleratorError("Build the company profile first", 409, "profile_required");
    }
    if (!(await listCatalogue()).length) {
        throw new AcceleratorError("Import Programs before matching", 409, "catalogue_empty");
    }
    await assertNoLiveRun(member.companyId);
    return toAcceleratorRunView(
        await startProposalRun({
            companyId: member.companyId,
            userId: member.authUserId,
            kind: "programs",
            input: {},
        })
    );
}

export async function loadAcceleratorRun(
    member: WorkspaceContext,
    id: string
): Promise<AcceleratorRunView> {
    const run = await getRun(id, member.companyId, { includeAccelerators: true });
    if (!run || run.kind !== "programs") {
        throw new AcceleratorError("Run not found", 404, "run_not_found");
    }
    return toAcceleratorRunView(run);
}
