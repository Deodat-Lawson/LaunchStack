import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { buildFounderWeeklyReviewActorId, parseFounderWeeklyReviewEvidenceSnapshot, parseFounderWeeklyReviewPayload, } from "./contracts.js";
import { FounderWeeklyReviewConflictError, FounderWeeklyReviewForbiddenError, FounderWeeklyReviewInvalidPayloadError, FounderWeeklyReviewInvalidTransitionError, FounderWeeklyReviewNotFoundError, } from "./errors.js";
import { FounderWeeklyReviewRepository } from "./repository.js";
const ALLOWED_WORKSPACE_ROLES = new Set(["owner", "admin", "editor"]);
function assertWorkspaceMutationRole(role) {
    if (!ALLOWED_WORKSPACE_ROLES.has(role)) {
        throw new FounderWeeklyReviewForbiddenError();
    }
}
function assertReportingPeriodMatchesSnapshot(reportingPeriod, evidenceSnapshot) {
    if (reportingPeriod.start !== evidenceSnapshot.reportingPeriod.start ||
        reportingPeriod.end !== evidenceSnapshot.reportingPeriod.end) {
        throw new FounderWeeklyReviewInvalidPayloadError("Evidence snapshot reporting period must match the run reporting period.");
    }
}
export class FounderWeeklyReviewUserService {
    repository;
    constructor(repository = new FounderWeeklyReviewRepository()) {
        this.repository = repository;
    }
    async createOrGetRun(actor, input) {
        assertWorkspaceMutationRole(actor.role);
        let evidenceSnapshot;
        try {
            evidenceSnapshot = input.evidenceSnapshot
                ? parseFounderWeeklyReviewEvidenceSnapshot(input.evidenceSnapshot)
                : undefined;
        }
        catch (error) {
            if (error instanceof ZodError)
                throw new FounderWeeklyReviewInvalidPayloadError(error.message);
            throw error;
        }
        if (evidenceSnapshot)
            assertReportingPeriodMatchesSnapshot(input.reportingPeriod, evidenceSnapshot);
        return (await this.repository.createOrGetByRequestKeyWithResult({
            id: `fwr_${randomUUID()}`,
            companyId: actor.companyId,
            requestKey: input.requestKey,
            reportingPeriod: input.reportingPeriod,
            evidenceSnapshot,
            collectionInput: input.collectionInput ?? {
                workspaceTimezone: evidenceSnapshot?.workspaceTimezone ?? "UTC",
                actorExternalUserId: actor.externalUserId,
            },
            createdByActorId: buildFounderWeeklyReviewActorId(actor),
        })).run;
    }
    async createOrGetRunWithMetadata(actor, input) {
        assertWorkspaceMutationRole(actor.role);
        let evidenceSnapshot;
        try {
            evidenceSnapshot = input.evidenceSnapshot
                ? parseFounderWeeklyReviewEvidenceSnapshot(input.evidenceSnapshot)
                : undefined;
        }
        catch (error) {
            if (error instanceof ZodError)
                throw new FounderWeeklyReviewInvalidPayloadError(error.message);
            throw error;
        }
        if (evidenceSnapshot)
            assertReportingPeriodMatchesSnapshot(input.reportingPeriod, evidenceSnapshot);
        return this.repository.createOrGetByRequestKeyWithResult({
            id: `fwr_${randomUUID()}`,
            companyId: actor.companyId,
            requestKey: input.requestKey,
            reportingPeriod: input.reportingPeriod,
            evidenceSnapshot,
            collectionInput: input.collectionInput ?? {
                workspaceTimezone: evidenceSnapshot?.workspaceTimezone ?? "UTC",
                actorExternalUserId: actor.externalUserId,
            },
            createdByActorId: buildFounderWeeklyReviewActorId(actor),
        });
    }
    async getRun(actor, runId) {
        const run = await this.repository.getByCompanyAndRunId(actor.companyId, runId);
        if (!run) {
            throw new FounderWeeklyReviewNotFoundError(runId);
        }
        return run;
    }
    async listRuns(actor) {
        return this.repository.listByCompany(actor.companyId);
    }
    async retryFailedRun(actor, runId, requestKey) {
        assertWorkspaceMutationRole(actor.role);
        const result = await this.repository.retryFailedRun({
            operationId: `fwrop_${randomUUID()}`,
            companyId: actor.companyId,
            runId,
            requestKey,
            actorId: buildFounderWeeklyReviewActorId(actor),
        });
        if (result.outcome === "not_found" || !result.run) {
            throw new FounderWeeklyReviewNotFoundError(runId);
        }
        if (result.outcome === "updated" || result.outcome === "idempotent") {
            if (result.run.status === "failed" || result.run.status === "queued") {
                return result.run;
            }
        }
        if (result.run.status !== "failed") {
            throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "retry");
        }
        throw new FounderWeeklyReviewConflictError(`Retry request key "${requestKey}" belongs to a different failure cycle for run "${runId}".`);
    }
    async retryFailedRunWithMetadata(actor, runId, requestKey) {
        assertWorkspaceMutationRole(actor.role);
        const result = await this.repository.retryFailedRun({
            operationId: `fwrop_${randomUUID()}`,
            companyId: actor.companyId,
            runId,
            requestKey,
            actorId: buildFounderWeeklyReviewActorId(actor),
        });
        if (result.outcome === "not_found" || !result.run)
            throw new FounderWeeklyReviewNotFoundError(runId);
        if (result.outcome === "updated")
            return { run: result.run, transitionApplied: true };
        if (result.outcome === "idempotent" &&
            (result.run.status === "failed" || result.run.status === "queued"))
            return { run: result.run, transitionApplied: false };
        if (result.run.status !== "failed")
            throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "retry");
        throw new FounderWeeklyReviewConflictError(`Retry request key "${requestKey}" belongs to a different failure cycle for run "${runId}".`);
    }
    async updateDraft(actor, runId, reviewPayload) {
        assertWorkspaceMutationRole(actor.role);
        let payload;
        try {
            payload = parseFounderWeeklyReviewPayload(reviewPayload);
        }
        catch (error) {
            if (error instanceof ZodError) {
                throw new FounderWeeklyReviewInvalidPayloadError(error.message);
            }
            throw error;
        }
        const result = await this.repository.updateDraftConditionally(actor.companyId, runId, payload);
        if (!result.run) {
            throw new FounderWeeklyReviewNotFoundError(runId);
        }
        if (result.updated) {
            return result.run;
        }
        if (result.run.status === "published") {
            throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "edit");
        }
        throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "edit");
    }
    async publishDraft(actor, runId) {
        assertWorkspaceMutationRole(actor.role);
        const result = await this.repository.publishConditionally(actor.companyId, runId);
        if (!result.run) {
            throw new FounderWeeklyReviewNotFoundError(runId);
        }
        if (result.updated || result.run.status === "published") {
            return result.run;
        }
        throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "publish");
    }
}
//# sourceMappingURL=user-service.js.map