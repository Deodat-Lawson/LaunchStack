import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { refineContent } from "@launchstack/features/marketing-pipeline";
import { buildCompanyKnowledgeContext } from "@launchstack/features/marketing-pipeline";
import { MarketingPlatformEnum, BrandVoiceSchema } from "@launchstack/features/marketing-pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

const RefineInputSchema = z.object({
    platform: MarketingPlatformEnum,
    originalMessage: z.string().min(1),
    feedback: z.string().min(1).max(1000),
    brandVoice: BrandVoiceSchema.optional(),
});

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
                { success: false, message: "Invalid JSON body" },
                { status: 400 },
            );
        }

        const validation = RefineInputSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: "Invalid input", errors: validation.error.flatten() },
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

        const companyContext = await buildCompanyKnowledgeContext({
            companyId,
            prompt: validation.data.feedback,
        });

        const result = await refineContent({
            platform: validation.data.platform,
            originalMessage: validation.data.originalMessage,
            feedback: validation.data.feedback,
            companyContext,
            brandVoice: validation.data.brandVoice,
        });

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("[marketing-pipeline/refine] error:", error);
        return NextResponse.json(
            { success: false, message: "Refinement failed" },
            { status: 500 },
        );
    }
}
