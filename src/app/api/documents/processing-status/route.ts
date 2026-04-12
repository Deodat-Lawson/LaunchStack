import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { ocrJobs, users } from "~/server/db/schema";
import { eq, and, inArray, gte } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const [userInfo] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo?.companyId) {
            return NextResponse.json(
                { error: "User or company not found." },
                { status: 400 }
            );
        }

        const companyId = userInfo.companyId;
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
