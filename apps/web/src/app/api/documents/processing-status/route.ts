import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { ocrJobs } from "@launchstack/core/db/schema";
import { eq, and, inArray, gte } from "drizzle-orm";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const companyId = ctx.data.companyId;
        const sixtySecondsAgo = new Date(Date.now() - 60_000);

        // Fetch active jobs (queued/processing) and recently completed/failed ones
        const activeJobs = await db
            .select({
                id: ocrJobs.id,
                documentName: ocrJobs.documentName,
                status: ocrJobs.status,
                startedAt: ocrJobs.startedAt,
                completedAt: ocrJobs.completedAt,
                pageCount: ocrJobs.pageCount,
                createdAt: ocrJobs.createdAt,
            })
            .from(ocrJobs)
            .where(
                and(
                    eq(ocrJobs.companyId, companyId),
                    inArray(ocrJobs.status, ["queued", "processing"])
                )
            );

        const recentlyFinished = await db
            .select({
                id: ocrJobs.id,
                documentName: ocrJobs.documentName,
                status: ocrJobs.status,
                startedAt: ocrJobs.startedAt,
                completedAt: ocrJobs.completedAt,
                pageCount: ocrJobs.pageCount,
                createdAt: ocrJobs.createdAt,
            })
            .from(ocrJobs)
            .where(
                and(
                    eq(ocrJobs.companyId, companyId),
                    inArray(ocrJobs.status, ["completed", "failed"]),
                    gte(ocrJobs.completedAt, sixtySecondsAgo)
                )
            );

        const allJobs = [...activeJobs, ...recentlyFinished];

        const summary = {
            queued: allJobs.filter((j) => j.status === "queued").length,
            processing: allJobs.filter((j) => j.status === "processing").length,
            completed: allJobs.filter((j) => j.status === "completed").length,
            failed: allJobs.filter((j) => j.status === "failed").length,
            total: allJobs.length,
        };

        return NextResponse.json({ jobs: allJobs, summary });
    } catch (error) {
        console.error("Error fetching processing status:", error);
        return NextResponse.json(
            { error: "Failed to fetch processing status" },
            { status: 500 }
        );
    }
}
