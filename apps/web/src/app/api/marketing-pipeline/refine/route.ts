import { NextResponse } from "next/server";
import { z } from "zod";
import { refineContent } from "@launchstack/features/marketing-pipeline";
import { buildCompanyKnowledgeContext } from "@launchstack/features/marketing-pipeline";
import { MarketingPlatformEnum, BrandVoiceSchema } from "@launchstack/features/marketing-pipeline";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

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
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

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

        const companyId = Number(ctx.data.companyId);
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
