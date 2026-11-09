import { z } from "zod";

import {
    AcceleratorError,
    CreateTrackerTaskSchema,
    SaveTrackerOpportunitySchema,
    UpdateTrackerOpportunitySchema,
    UpdateTrackerTaskSchema,
    assertTrackerCycleChange,
} from "@launchstack/pipelines/accelerators";
import { getCatalogueProgram } from "@launchstack/pipelines/accelerators/db";
import {
    createTrackerTask,
    deleteTrackerOpportunity,
    deleteTrackerTask,
    getTrackerOpportunity,
    listTrackerOpportunities,
    saveTrackerOpportunity,
    updateTrackerOpportunity,
    updateTrackerTask,
} from "@launchstack/pipelines/accelerators/tracker-db";

import type { WorkspaceContext } from "~/lib/require-workspace-context";
import { assertAcceleratorAccess } from "~/server/accelerators/access";

const trackerId = z.string().uuid();

export async function trackerRequestBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        throw new AcceleratorError("Expected a JSON request body", 400, "invalid_input");
    }
}

async function cycleDeadline(programId: string, cycleId: string | null): Promise<string | null> {
    const record = await getCatalogueProgram(programId);
    if (!record) throw new AcceleratorError("Program not found", 404, "program_not_found");
    if (cycleId === null) return null;
    const cycle = record.program.cycles.find(candidate => candidate.id === cycleId);
    if (!cycle)
        throw new AcceleratorError("Cycle must belong to this Program", 400, "invalid_cycle");
    // A date-only deadline has no established time or timezone; do not invent a timestamp.
    return cycle.deadlineAt;
}

export async function loadTracker(member: WorkspaceContext) {
    await assertAcceleratorAccess(member);
    return listTrackerOpportunities(member.companyId);
}

export async function loadTrackerOpportunity(member: WorkspaceContext, id: string) {
    await assertAcceleratorAccess(member);
    const opportunity = await getTrackerOpportunity(member.companyId, trackerId.parse(id));
    if (!opportunity) throw new AcceleratorError("Opportunity not found", 404, "tracker_not_found");
    return opportunity;
}

export async function saveOpportunity(member: WorkspaceContext, body: unknown) {
    await assertAcceleratorAccess(member, "documents.edit");
    const input = SaveTrackerOpportunitySchema.parse(body);
    const deadline = await cycleDeadline(input.programId, input.cycleId ?? null);
    return saveTrackerOpportunity(member.companyId, input, deadline);
}

export async function editOpportunity(member: WorkspaceContext, id: string, body: unknown) {
    await assertAcceleratorAccess(member, "documents.edit");
    const input = UpdateTrackerOpportunitySchema.parse(body);
    const existing = await loadTrackerOpportunity(member, id);
    let deadline: string | null = null;
    if (input.cycleId !== undefined) {
        assertTrackerCycleChange(existing.cycleId, input.cycleId);
        deadline = await cycleDeadline(existing.programId, input.cycleId);
    }
    return updateTrackerOpportunity(member.companyId, existing.id, input, deadline);
}

export async function removeOpportunity(member: WorkspaceContext, id: string) {
    await assertAcceleratorAccess(member, "documents.edit");
    await deleteTrackerOpportunity(member.companyId, trackerId.parse(id));
}

export async function addTrackerTask(
    member: WorkspaceContext,
    opportunityId: string,
    body: unknown
) {
    await assertAcceleratorAccess(member, "documents.edit");
    return createTrackerTask(
        member.companyId,
        trackerId.parse(opportunityId),
        CreateTrackerTaskSchema.parse(body)
    );
}

export async function editTrackerTask(
    member: WorkspaceContext,
    opportunityId: string,
    taskId: string,
    body: unknown
) {
    await assertAcceleratorAccess(member, "documents.edit");
    return updateTrackerTask(
        member.companyId,
        trackerId.parse(opportunityId),
        trackerId.parse(taskId),
        UpdateTrackerTaskSchema.parse(body)
    );
}

export async function removeTrackerTask(
    member: WorkspaceContext,
    opportunityId: string,
    taskId: string
) {
    await assertAcceleratorAccess(member, "documents.edit");
    await deleteTrackerTask(
        member.companyId,
        trackerId.parse(opportunityId),
        trackerId.parse(taskId)
    );
}
