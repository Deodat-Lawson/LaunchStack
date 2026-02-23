import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { getJobById } from "~/server/trend-search/db";

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
            categories: job.input.categories ?? [],
            results: job.output?.results ?? null,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() ?? null,
        });
    } catch (error) {
        console.error("[trend-search] GET /[jobId] error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
