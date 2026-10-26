/**
 * Where a proposals run executes. Every stage is a handful of model calls over
 * the workspace's own sources — seconds to a minute — so by default the web
 * process runs it after the response (`after()`), the way keyless Prospects
 * runs do, and the UI polls the run row. A deployment with the worker
 * attached sets PROPOSALS_EXECUTOR=worker to queue the same run through
 * Inngest instead; the executor is the same function either way.
 */
import { after } from "next/server";

import {
    executeProposalRun,
    failProposalRun,
    queueProposalRun,
    PROPOSAL_CREDITS,
    type RunInput,
    type RunKind,
    type RunRecord,
} from "@launchstack/pipelines/proposals";
import { getRun } from "@launchstack/pipelines/proposals/db";

import { copy, type Copy } from "~/i18n/copy";
import { englishCopy } from "~/i18n/translate";
import { hasTokens } from "~/lib/credits";
import { resolveMemberContext } from "~/lib/require-workspace-context";
import { isMeteringEnforced } from "~/server/deployment";
import { inngest } from "~/server/inngest/client";

import { assertAcceleratorAccess } from "~/server/accelerators/access";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";
import { createProposalPorts } from "./ports";

export type ProposalsExecutor = "inline" | "worker";

export function readProposalsExecutor(
    env: Record<string, string | undefined> = process.env
): ProposalsExecutor {
    return env.PROPOSALS_EXECUTOR?.trim().toLowerCase() === "worker" ? "worker" : "inline";
}

/** A 402 the shared route handler answers from its `status`, worded from its `copy`. */
export class InsufficientCreditsError extends Error {
    readonly code = "insufficient_credits";
    readonly status = 402;
    readonly copy: Copy = copy("proposals.server.errors.notEnoughCredits");
    constructor(readonly required: number) {
        super(englishCopy(copy("proposals.server.errors.notEnoughCredits")));
        this.name = "InsufficientCreditsError";
    }
}

/** What a run of this kind costs at most, for the pre-check. */
export function creditsFor(kind: RunKind, sections = 1): number {
    return kind === "draft"
        ? PROPOSAL_CREDITS.draft * Math.max(1, sections)
        : PROPOSAL_CREDITS[kind];
}

export interface StartRunArgs {
    companyId: bigint;
    userId: string;
    kind: RunKind;
    input: RunInput;
    sectionLabels?: string[];
}

/**
 * Resolve the persisted writer at execution time, not when the run is queued.
 * Both schedulers call this inside their deferred body under their model scope.
 */
export async function executeProposalRunForMember(
    runId: string,
    companyId: bigint
): Promise<RunRecord> {
    const run = await getRun(runId, companyId, { includeAccelerators: true });
    if (!run) throw new Error("Run not found");
    if (run.status !== "queued") return run;
    const ctx = { runId, companyId, userId: run.userId };
    const member = await resolveMemberContext(run.userId, companyId);
    if (!member) throw new Error("The run's writer is no longer an active workspace member.");
    const scope = await member.documentScope();
    if (run.kind === "programs" || run.kind === "accel_draft" || run.kind === "accel_edit") {
        await assertAcceleratorAccess(member, "documents.edit");
    }
    return executeProposalRun({ ...ctx, scope }, createProposalPorts(companyId, run.userId));
}

/** Queue a run and hand it to the executor. Returns the queued row at once. */
export async function startProposalRun(args: StartRunArgs): Promise<RunRecord> {
    if (isMeteringEnforced()) {
        const required = creditsFor(args.kind, args.sectionLabels?.length ?? 1);
        if (!(await hasTokens(args.companyId, required)))
            throw new InsufficientCreditsError(required);
    }
    const run = await queueProposalRun({
        companyId: args.companyId,
        userId: args.userId,
        kind: args.kind,
        input: args.input,
        sectionLabels: args.sectionLabels,
    });
    if (readProposalsExecutor() === "worker") {
        await inngest.send({
            name: "proposals/run.requested",
            data: { runId: run.id, companyId: args.companyId.toString(), userId: args.userId },
        });
        return run;
    }
    after(async () => {
        try {
            // Resolve the stored writer inside the workspace's current model scope.
            await withWorkspaceChatModels(args.companyId, "proposals", () =>
                executeProposalRunForMember(run.id, args.companyId)
            );
        } catch (error) {
            await failProposalRun(
                { runId: run.id, companyId: args.companyId },
                error instanceof Error && error.message ? error.message : "The run failed"
            );
            console.error("[proposals] run failed:", error);
        }
    });
    return run;
}
