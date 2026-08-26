import { z } from "zod";
import { refineContent } from "@launchstack/pipelines/marketing";
import { buildCompanyKnowledgeContext } from "@launchstack/pipelines/marketing";
import { MarketingPlatformEnum, BrandVoiceSchema } from "@launchstack/pipelines/marketing";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { fail, handleRouteError, ok, readJson } from "~/server/api/responses";

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

        const validation = RefineInputSchema.safeParse(await readJson(request));
        if (!validation.success) {
            return fail("Invalid input", 400, { errors: validation.error.flatten() });
        }

        const companyId = Number(ctx.data.companyId);
        if (Number.isNaN(companyId)) {
            return fail("Invalid company ID", 400);
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

        return ok(result);
    } catch (error) {
        return handleRouteError("marketing-pipeline/refine", error);
    }
}
