// GET /api/client-prospector/[jobId] — Get a single prospecting job by ID
//
// The frontend polls this endpoint to check the status of a running job.
// Returns the full job details including results once the pipeline completes.
// The job is scoped to the authenticated user's company, so company A
// can never see company B's jobs (returns 404 instead of leaking data).

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { getJobById } from "@launchstack/features/client-prospector/db";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 400 },
            );
        }

        const { jobId } = await params;
        const job = await getJobById(jobId, userInfo.companyId);

        if (!job) {
            return NextResponse.json(
                { error: "Not found" },
                { status: 404 },
            );
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
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
