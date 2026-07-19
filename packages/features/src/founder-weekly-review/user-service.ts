import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import {
    buildFounderWeeklyReviewActorId,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewPayload,
    type FounderWeeklyReviewRunRecord,
    type FounderWeeklyReviewUserActor,
    parseFounderWeeklyReviewEvidenceSnapshot,
    parseFounderWeeklyReviewPayload,
} from "./contracts";
import {
    FounderWeeklyReviewConflictError,
    FounderWeeklyReviewForbiddenError,
    FounderWeeklyReviewInvalidPayloadError,
    FounderWeeklyReviewInvalidTransitionError,
    FounderWeeklyReviewNotFoundError,
} from "./errors";
import { FounderWeeklyReviewRepository } from "./repository";

const ALLOWED_WORKSPACE_ROLES = new Set(["owner", "admin", "editor"]);

export interface CreateFounderWeeklyReviewRunRequest {
    requestKey: string;
    reportingPeriod: {
        start: string;
        end: string;
    };
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot;
}

function assertWorkspaceMutationRole(role: string): void {
    if (!ALLOWED_WORKSPACE_ROLES.has(role)) {
        throw new FounderWeeklyReviewForbiddenError();
    }
}

function assertReportingPeriodMatchesSnapshot(
    reportingPeriod: { start: string; end: string },
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot
): void {
    if (
        reportingPeriod.start !== evidenceSnapshot.reportingPeriod.start ||
        reportingPeriod.end !== evidenceSnapshot.reportingPeriod.end
    ) {
        throw new FounderWeeklyReviewInvalidPayloadError(
            "Evidence snapshot reporting period must match the run reporting period."
        );
    }
}

export class FounderWeeklyReviewUserService {
    constructor(
        private readonly repository = new FounderWeeklyReviewRepository()
    ) {}

    async createOrGetRun(
        actor: FounderWeeklyReviewUserActor,
        input: CreateFounderWeeklyReviewRunRequest
    ): Promise<FounderWeeklyReviewRunRecord> {
        assertWorkspaceMutationRole(actor.role);
        let evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot;
        try {
            evidenceSnapshot = parseFounderWeeklyReviewEvidenceSnapshot(input.evidenceSnapshot);
        } catch (error) {
            if (error instanceof ZodError) {
                throw new FounderWeeklyReviewInvalidPayloadError(error.message);
            }
            throw error;
        }
        assertReportingPeriodMatchesSnapshot(input.reportingPeriod, evidenceSnapshot);

        return this.repository.createOrGetByRequestKey({
            id: `fwr_${randomUUID()}`,
            companyId: actor.companyId,
            requestKey: input.requestKey,
            reportingPeriod: input.reportingPeriod,
            evidenceSnapshot,
            createdByActorId: buildFounderWeeklyReviewActorId(actor),
        });
    }

    async getRun(
        actor: FounderWeeklyReviewUserActor,
        runId: string
    ): Promise<FounderWeeklyReviewRunRecord> {
        const run = await this.repository.getByCompanyAndRunId(actor.companyId, runId);
        if (!run) {
            throw new FounderWeeklyReviewNotFoundError(runId);
        }
        return run;
    }

    async listRuns(actor: FounderWeeklyReviewUserActor): Promise<FounderWeeklyReviewRunRecord[]> {
        return this.repository.listByCompany(actor.companyId);
    }

    async retryFailedRun(
        actor: FounderWeeklyReviewUserActor,
        runId: string,
        requestKey: string
    ): Promise<FounderWeeklyReviewRunRecord> {
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

        throw new FounderWeeklyReviewConflictError(
            `Retry request key "${requestKey}" belongs to a different failure cycle for run "${runId}".`
        );
    }

    async updateDraft(
        actor: FounderWeeklyReviewUserActor,
        runId: string,
        reviewPayload: FounderWeeklyReviewPayload
    ): Promise<FounderWeeklyReviewRunRecord> {
        assertWorkspaceMutationRole(actor.role);
        let payload: FounderWeeklyReviewPayload;
        try {
            payload = parseFounderWeeklyReviewPayload(reviewPayload);
        } catch (error) {
            if (error instanceof ZodError) {
                throw new FounderWeeklyReviewInvalidPayloadError(error.message);
            }
            throw error;
        }
        const result = await this.repository.updateDraftConditionally(
            actor.companyId,
            runId,
            payload
        );

        if (!result.run) {
            throw new FounderWeeklyReviewNotFoundError(runId);
        }
        if (result.updated) {
            return result.run;
        }
        if (result.run.status === "published") {
            throw new FounderWeeklyReviewInvalidTransitionError(
                result.run.status,
                "edit"
            );
        }
        throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "edit");
    }

    async publishDraft(
        actor: FounderWeeklyReviewUserActor,
        runId: string
    ): Promise<FounderWeeklyReviewRunRecord> {
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
