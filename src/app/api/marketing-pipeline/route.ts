import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { MarketingPipelineInputSchema, runMarketingPipeline } from "~/lib/tools/marketing-pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 },
            );
        }

        const body = (await request.json()) as unknown;
        const validation = MarketingPipelineInputSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Invalid input",
                    errors: validation.error.flatten(),
                },
                { status: 400 },
            );
        }

        const [requestingUser] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (!requestingUser) {
            return NextResponse.json(
                { success: false, message: "User not found" },
                { status: 404 },
            );
        }

        const companyId = Number(requestingUser.companyId);
        if (Number.isNaN(companyId)) {
            return NextResponse.json(
                { success: false, message: "Invalid company ID" },
                { status: 400 },
            );
        }

        const url = new URL(request.url);
        const debug = url.searchParams.get("debug") === "true";

        const result = await runMarketingPipeline({
            companyId,
            input: validation.data,
            debug,
        });

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        console.error("[marketing-pipeline] POST error:", error);
        return NextResponse.json(
            {
                success: false,
                message: "Failed to run marketing pipeline",
                error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        );
    }
}

