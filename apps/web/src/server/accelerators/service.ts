import {
    AcceleratorError,
    hashValue,
    type EditSuggestionRequest,
    type HomeResponse,
    type ProgramView,
    type RunView,
} from "@launchstack/pipelines/accelerators";
import {
    getAcceleratorApplication,
    getCatalogueProgram,
    listAcceleratorApplications,
    listCatalogue,
    listCompanyMatches,
} from "@launchstack/pipelines/accelerators/db";
import { PROPOSAL_CREDITS, selectedText, type RunRecord } from "@launchstack/pipelines/proposals";
import { findLiveRun, getRun, loadOrgProfile } from "@launchstack/pipelines/proposals/db";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { startProposalRun } from "~/server/proposals/executor";

export const ACCELERATOR_COSTS = {
    match: PROPOSAL_CREDITS.programs,
    draft: PROPOSAL_CREDITS.accel_draft,
    edit: PROPOSAL_CREDITS.accel_edit,
};

export function toAcceleratorRunView(run: RunRecord): RunView {
    return {
        id: run.id,
        kind: run.kind,
        status: run.status,
        steps: run.steps,
        summary: run.summary,
        result: run.result,
        error: run.error,
        creditsUsed: run.creditsUsed,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}

export async function loadAccelerators(member: WorkspaceContext): Promise<HomeResponse> {
    const [catalogue, matches, applications, profile] = await Promise.all([
        listCatalogue(),
        listCompanyMatches(member.companyId),
        listAcceleratorApplications(member.companyId),
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
        applications,
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

export async function matchPrograms(member: WorkspaceContext): Promise<RunView> {
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

export async function draftAcceleratorField(
    member: WorkspaceContext,
    applicationId: string,
    sectionId: string,
    expectedRevision: number
): Promise<RunView> {
    const application = await getAcceleratorApplication(member.companyId, applicationId);
    if (!application)
        throw new AcceleratorError("Application not found", 404, "application_not_found");
    const section = application.sections.find(candidate => candidate.id === sectionId);
    if (!section) throw new AcceleratorError("Field not found", 404, "section_not_found");
    if (section.revision !== expectedRevision || section.draft) {
        throw new AcceleratorError(
            "Only an unchanged empty Field can be drafted",
            409,
            "answer_conflict"
        );
    }
    if (section.field.fieldType !== "long_text" && section.field.fieldType !== "short_text") {
        throw new AcceleratorError("This Field is not prose", 400, "prose_required");
    }
    const profile = await loadOrgProfile(member.companyId, await member.documentScope());
    if (!profile || (!profile.facts.length && !profile.summary.trim())) {
        throw new AcceleratorError("Build the company profile first", 409, "profile_required");
    }
    if (!(await getCatalogueProgram(application.programId))) {
        throw new AcceleratorError("Program not found", 404, "program_not_found");
    }
    await assertNoLiveRun(member.companyId);
    return toAcceleratorRunView(
        await startProposalRun({
            companyId: member.companyId,
            userId: member.authUserId,
            kind: "accel_draft",
            input: { applicationId, acceleratorDraft: { sectionId, expectedRevision } },
            sectionLabels: [section.field.question],
        })
    );
}

/** Start a metered run that proposes a replacement for a selection; it saves no answer. */
export async function suggestAcceleratorEdit(
    member: WorkspaceContext,
    applicationId: string,
    sectionId: string,
    request: EditSuggestionRequest
): Promise<RunView> {
    const application = await getAcceleratorApplication(member.companyId, applicationId);
    if (!application)
        throw new AcceleratorError("Application not found", 404, "application_not_found");
    const section = application.sections.find(candidate => candidate.id === sectionId);
    if (!section) throw new AcceleratorError("Field not found", 404, "section_not_found");
    if (section.revision !== request.expectedRevision) {
        throw new AcceleratorError(
            "The answer changed; select the text again",
            409,
            "answer_conflict"
        );
    }
    if (section.field.fieldType !== "long_text" && section.field.fieldType !== "short_text") {
        throw new AcceleratorError("This Field is not prose", 400, "prose_required");
    }
    selectedText(section.draft ?? "", request.start, request.end);
    if (!(await getCatalogueProgram(application.programId))) {
        throw new AcceleratorError("Program not found", 404, "program_not_found");
    }
    await assertNoLiveRun(member.companyId);
    return toAcceleratorRunView(
        await startProposalRun({
            companyId: member.companyId,
            userId: member.authUserId,
            kind: "accel_edit",
            input: {
                applicationId,
                acceleratorEdit: {
                    sectionId,
                    expectedRevision: request.expectedRevision,
                    start: request.start,
                    end: request.end,
                    instruction: request.instruction,
                },
            },
            sectionLabels: [section.field.question],
        })
    );
}

export async function loadAcceleratorRun(member: WorkspaceContext, id: string): Promise<RunView> {
    const run = await getRun(id, member.companyId, { includeAccelerators: true });
    if (
        !run ||
        (run.kind !== "programs" && run.kind !== "accel_draft" && run.kind !== "accel_edit")
    ) {
        throw new AcceleratorError("Run not found", 404, "run_not_found");
    }
    return toAcceleratorRunView(run);
}
