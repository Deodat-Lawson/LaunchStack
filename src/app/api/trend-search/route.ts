import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { inngest } from "~/server/inngest/client";
import { TrendSearchInputSchema } from "~/server/trend-search/types";
import { createJob, getJobsByCompanyId } from "~/server/trend-search/db";

// ─── POST /api/trend-search ─────────────────────────────────────────────────
export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        // Parse and validate request body
        const body: unknown = await request.json();
        const parsed = TrendSearchInputSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Validation failed", details: parsed.error.flatten() },
                { status: 400 },
            );
        }

        const input = parsed.data;

        // Look up user's company_id
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

        const companyId = userInfo.companyId;
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

        return NextResponse.json(
            { jobId, status: "queued" },
            { status: 202 },
        );
    } catch (error) {
        console.error("[trend-search] POST error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

// ─── GET /api/trend-search ──────────────────────────────────────────────────
export async function GET() {
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

        const jobs = await getJobsByCompanyId(userInfo.companyId);

        const results = jobs.map((job) => ({
            id: job.id,
            status: job.status,
            query: job.input.query,
            categories: job.input.categories ?? [],
            createdAt: job.createdAt.toISOString(),
        }));

        return NextResponse.json({ searches: results }, { status: 200 });
    } catch (error) {
        console.error("[trend-search] GET error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
