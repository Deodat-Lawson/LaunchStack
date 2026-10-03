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
    queueProposalRun,
    PROPOSAL_CREDITS,
    type RunInput,
    type RunKind,
    type RunRecord,
} from "@launchstack/pipelines/proposals";

import { hasTokens } from "~/lib/credits";
import { isMeteringEnforced } from "~/server/deployment";
import { inngest } from "~/server/inngest/client";

import { createProposalPorts } from "./ports";

export type ProposalsExecutor = "inline" | "worker";

export function readProposalsExecutor(
    env: Record<string, string | undefined> = process.env
): ProposalsExecutor {
    return env.PROPOSALS_EXECUTOR?.trim().toLowerCase() === "worker" ? "worker" : "inline";
}

export class InsufficientCreditsError extends Error {
    readonly code = "insufficient_credits";
    readonly status = 402;
    constructor(readonly required: number) {
        super("Not enough credits to start this run");
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
    const ctx = { runId: run.id, companyId: args.companyId, userId: args.userId };
    if (readProposalsExecutor() === "worker") {
        await inngest.send({
            name: "proposals/run.requested",
            data: { runId: run.id, companyId: args.companyId.toString(), userId: args.userId },
        });
        return run;
    }
    after(async () => {
        try {
            await executeProposalRun(ctx, createProposalPorts(args.companyId));
        } catch (error) {
            console.error("[proposals] run failed:", error);
        }
    });
    return run;
}
