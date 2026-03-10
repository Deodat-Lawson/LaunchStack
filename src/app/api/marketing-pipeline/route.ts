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

        let body: unknown;
        try {
            body = (await request.json()) as unknown;
        } catch {
            return NextResponse.json(
                { success: false, message: "Invalid JSON body", error: "Request body must be valid JSON" },
                { status: 400 },
            );
        }
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

        const result = await runMarketingPipeline({
            companyId,
            input: validation.data,
        });

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        console.error("[marketing-pipeline] POST error:", error);

        // Surface common setup errors for easier debugging
        const hint =
            !process.env.OPENAI_API_KEY && errMessage.toLowerCase().includes("openai")
                ? " (Ensure OPENAI_API_KEY is set in .env)"
                : errMessage.toLowerCase().includes("company")
                  ? " (Ensure your user has a valid company profile)"
                  : "";

        return NextResponse.json(
            {
                success: false,
                message: "Failed to run marketing pipeline",
                error: errMessage + hint,
            },
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
}

