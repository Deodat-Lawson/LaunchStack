import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";

import { inngest } from "~/server/inngest/client";
import { TrendSearchInputSchema } from "@launchstack/pipelines/trend-search";
import { createJob, getJobsByCompanyId } from "@launchstack/pipelines/trend-search/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

// ─── POST /api/trend-search ─────────────────────────────────────────────────
export async function POST(request: NextRequest) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        // Parse and validate request body
        const body: unknown = await request.json();
        const parsed = TrendSearchInputSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Validation failed", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const input = parsed.data;

        const companyId = ctx.data.companyId;
        const userId = ctx.data.clerkUserId;
        const jobId = uuidv4();

        // Create job record in DB
        await createJob({
            id: jobId,
            companyId,
            userId,
            query: input.query,
            companyContext: input.companyContext,
            categories: input.categories,
        });

        // Dispatch Inngest event
        await inngest.send({
            name: "trend-search/run.requested",
            data: {
                jobId,
                companyId: companyId.toString(),
                userId,
                query: input.query,
                companyContext: input.companyContext,
                ...(input.categories ? { categories: input.categories } : {}),
            },
        });

        return NextResponse.json({ jobId, status: "queued" }, { status: 202 });
    } catch (error) {
        console.error("[trend-search] POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// ─── GET /api/trend-search ──────────────────────────────────────────────────
export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const jobs = await getJobsByCompanyId(ctx.data.companyId);

        const results = jobs.map(job => ({
            id: job.id,
            status: job.status,
            query: job.input.query,
            categories: job.input.categories ?? [],
            createdAt: job.createdAt.toISOString(),
        }));

        return NextResponse.json({ searches: results }, { status: 200 });
    } catch (error) {
        console.error("[trend-search] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
