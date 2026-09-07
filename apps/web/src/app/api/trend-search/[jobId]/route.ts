import { NextResponse } from "next/server";

import { getJobById } from "@launchstack/pipelines/trend-search/db";
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
            categories: job.input.categories ?? [],
            results: job.output?.results ?? null,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() ?? null,
        });
    } catch (error) {
        console.error("[trend-search] GET /[jobId] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
