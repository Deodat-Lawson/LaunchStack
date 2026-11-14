import {
    AcceleratorError,
    hashValue,
    programFit,
    type ProgramView,
} from "@launchstack/pipelines/accelerators";
import { listCatalogue, listCompanyMatches } from "@launchstack/pipelines/accelerators/db";
import { PROPOSAL_CREDITS, type RunRecord } from "@launchstack/pipelines/proposals";
import { findLiveRun, getRun, loadOrgProfile } from "@launchstack/pipelines/proposals/db";

import type { AcceleratorRunView, AcceleratorsHome } from "~/app/employer/tools/accelerators/api";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { startProposalRun } from "~/server/proposals/executor";
import { runCopy } from "~/server/proposals/copy";

import { loadProgramDetails } from "./details";
import { validateProgramIds } from "./run";

/** Scoring is priced per Program scored; the button's estimate is count × this rate. */
export const ACCELERATOR_COSTS = {
    matchPerProgram: PROPOSAL_CREDITS.programs,
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

export async function loadAccelerators(member: WorkspaceContext): Promise<AcceleratorsHome> {
    const [catalogue, matches, profile, details] = await Promise.all([
        listCatalogue(),
        listCompanyMatches(member.companyId),
        loadOrgProfile(member.companyId, await member.documentScope()),
        loadProgramDetails(),
    ]);
    const profileHash = profile ? hashValue(profile) : null;
    // No ranking here: the homepage sorts and filters, and fit is one field among many.
    const programs = catalogue.map(
        ({ program, contentHash }): ProgramView => ({
            program,
            contentHash,
            ...programFit(matches[program.id] ?? null, { profileHash, programHash: contentHash }),
        })
    );
    return {
        programs,
        profileReady:
            profile !== null && (profile.facts.length > 0 || profile.summary.trim().length > 0),
        canEdit: member.can("documents.edit"),
        costs: ACCELERATOR_COSTS,
        details,
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

/**
 * Starts scoring the chosen Programs. Pre-checks consider only those Programs. Unless
 * `rescore` is set, Programs whose saved result is current (same profile, Program and
 * rubric) are left out, so the run sends, and charges for, only what would change.
 * The run re-validates its Programs, since the catalogue may change before it executes.
 */
export async function matchPrograms(
    member: WorkspaceContext,
    programIds: unknown,
    rescore = false
): Promise<AcceleratorRunView> {
    const profile = await loadOrgProfile(member.companyId, await member.documentScope());
    if (!profile || (!profile.facts.length && !profile.summary.trim())) {
        throw new AcceleratorError("Build the company profile first", 409, "profile_required");
    }
    const catalogue = await listCatalogue();
    if (!catalogue.length) {
        throw new AcceleratorError("Import Programs before matching", 409, "catalogue_empty");
    }
    await assertNoLiveRun(member.companyId);
    const chosen = validateProgramIds(
        programIds,
        new Set(catalogue.map(({ program }) => program.id))
    );
    let ids = chosen;
    if (!rescore) {
        const matches = await listCompanyMatches(member.companyId);
        const programHashes = new Map(
            catalogue.map(({ program, contentHash }) => [program.id, contentHash])
        );
        const profileHash = hashValue(profile);
        ids = chosen.filter(
            id =>
                programFit(matches[id] ?? null, {
                    profileHash,
                    programHash: programHashes.get(id)!,
                }).freshness.status !== "current"
        );
        if (!ids.length) {
            throw new AcceleratorError(
                "Every chosen Program already has a current result",
                409,
                "all_current"
            );
        }
    }
    return toAcceleratorRunView(
        await startProposalRun({
            companyId: member.companyId,
            userId: member.authUserId,
            kind: "programs",
            input: { programs: { programIds: ids } },
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
