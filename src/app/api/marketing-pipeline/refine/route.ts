import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { RefinementInputSchema } from "~/lib/tools/marketing-pipeline";
import { refineContent } from "~/lib/tools/marketing-pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

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
        const validation = RefinementInputSchema.safeParse(body);
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

        const { platform, previousMessage, feedback, pipelineContext } = validation.data;

        const result = await refineContent({
            platform,
            previousMessage,
            feedback,
            companyContext: pipelineContext.companyContext,
            research: pipelineContext.research,
            strategy: pipelineContext.strategy,
            brandVoice: pipelineContext.brandVoice,
        });

        return NextResponse.json({ success: true, data: result }, { status: 200 });
    } catch (error) {
        console.error("[marketing-pipeline/refine] POST error:", error);
        return NextResponse.json(
            {
                success: false,
                message: "Failed to refine content",
                error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
        );
    }
}
