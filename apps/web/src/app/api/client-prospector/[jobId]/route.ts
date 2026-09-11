// GET /api/client-prospector/[jobId] — Get a single prospecting job by ID
//
// The frontend polls this endpoint to check the status of a running job.
// Returns the full job details including results once the pipeline completes.
// The job is scoped to the authenticated user's company, so company A
// can never see company B's jobs (returns 404 instead of leaking data).

import { NextResponse } from "next/server";

import { getJobById } from "@launchstack/pipelines/client-prospector/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const { jobId } = await params;
        const job = await getJobById(jobId, ctx.data.companyId);

        if (!job) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        return NextResponse.json({
            id: job.id,
            status: job.status,
            query: job.input.query,
            companyContext: job.input.companyContext,
            location: job.input.location,
            radius: job.input.radius,
            categories: job.input.categories ?? [],
            results: job.output?.results ?? null,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() ?? null,
        });
    } catch (error) {
        console.error("[client-prospector] GET /[jobId] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
