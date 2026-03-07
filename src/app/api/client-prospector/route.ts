// POST /api/client-prospector — Start a new prospecting search
// GET  /api/client-prospector — List all prospecting jobs for the user's company
//
// POST flow:
//   1. Authenticate the user via Clerk
//   2. Validate the request body (query, companyContext, location, etc.)
//   3. Resolve the location to lat/lng if the user sent a string like "Austin, TX"
//   4. Look up the user's company_id from the users table
//   5. Create a DB row with status "queued"
//   6. Send an event to Inngest to run the pipeline in the background
//   7. Return 202 with the jobId so the frontend can start polling

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { inngest } from "~/server/inngest/client";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import {
    ProspectorInputSchema,
    DEFAULT_SEARCH_RADIUS,
} from "~/lib/tools/client-prospector/types";
import { createJob, getJobsByCompanyId } from "~/lib/tools/client-prospector/db";

// ─── POST /api/client-prospector ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 },
        );
    }

    return withRateLimit(
        request,
        {
            maxRequests: 10,
            windowMs: 15 * 60 * 1000,
            keyGenerator: () => `client-prospector:${userId}`,
        },
        async () => {
            try {
                // Step 2: Parse and validate the request body.
                const body: unknown = await request.json();
                const parsed = ProspectorInputSchema.safeParse(body);
                if (!parsed.success) {
                    return NextResponse.json(
                        { error: "Validation failed", details: parsed.error.flatten() },
                        { status: 400 },
                    );
                }

                const input = parsed.data;

                // Step 4: Look up the user's company.
                // Every job is scoped to a company for data isolation.
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
                const radius = input.radius ?? DEFAULT_SEARCH_RADIUS;
                const queuedLocation =
                    typeof input.location === "string"
                        ? { lat: 0, lng: 0 }
                        : input.location;

                // Step 5: Create the job row in the DB with status "queued".
                // The frontend can immediately start polling GET /api/client-prospector/[jobId]
                // to see the status update as the pipeline progresses.
                await createJob({
                    id: jobId,
                    companyId,
                    userId,
                    query: input.query,
                    companyContext: input.companyContext,
                    location: queuedLocation,
                    radius,
                    categories: input.categories,
                });

                // Step 6: Send the event to Inngest to start the background pipeline.
                // companyId is serialized as a string because Inngest payloads are JSON
                // and bigint can't be serialized directly.
                await inngest.send({
                    name: "client-prospector/run.requested",
                    data: {
                        jobId,
                        companyId: companyId.toString(),
                        userId,
                        query: input.query,
                        companyContext: input.companyContext,
                        location: input.location,
                        radius,
                        ...(input.categories ? { categories: input.categories } : {}),
                        ...(input.excludeChains !== undefined ? { excludeChains: input.excludeChains } : {}),
                    },
                });

                // Step 7: Return 202 Accepted — the job is queued, not finished yet.
                return NextResponse.json(
                    { jobId, status: "queued" },
                    { status: 202 },
                );
            } catch (error) {
                console.error("[client-prospector] POST error:", error);
                return NextResponse.json(
                    { error: "Internal server error" },
                    { status: 500 },
                );
            }
        },
    );
}

// ─── GET /api/client-prospector ──────────────────────────────────────────────
// Lists all prospecting jobs for the authenticated user's company.
// Returns a summary for each job (id, status, query, location, createdAt).
export async function GET(request: NextRequest) {
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

        const limitParam = request.nextUrl.searchParams.get("limit");
        const offsetParam = request.nextUrl.searchParams.get("offset");
        const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;
        const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            return NextResponse.json(
                { error: "Invalid limit: expected an integer between 1 and 500" },
                { status: 400 },
            );
        }

        if (!Number.isInteger(offset) || offset < 0) {
            return NextResponse.json(
                { error: "Invalid offset: expected a non-negative integer" },
                { status: 400 },
            );
        }

        const jobs = await getJobsByCompanyId(userInfo.companyId, { limit, offset });

        const results = jobs.map((job) => ({
            id: job.id,
            status: job.status,
            query: job.input.query,
            location: job.input.location,
            categories: job.input.categories ?? [],
            createdAt: job.createdAt.toISOString(),
        }));

        return NextResponse.json({ jobs: results, pagination: { limit, offset } }, { status: 200 });
    } catch (error) {
        console.error("[client-prospector] GET error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}
