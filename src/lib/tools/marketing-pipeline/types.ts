import { z } from "zod";

export const MarketingPlatformEnum = z.enum(["x", "linkedin", "reddit"]);
export type MarketingPlatform = z.infer<typeof MarketingPlatformEnum>;

export const MarketingPipelineInputSchema = z.object({
    platform: MarketingPlatformEnum,
    prompt: z.string().min(1).max(2000),
    maxResearchResults: z.number().int().min(1).max(12).optional(),
});
export type MarketingPipelineInput = z.infer<typeof MarketingPipelineInputSchema>;

export interface MarketingResearchResult {
    title: string;
    url: string;
    snippet: string;
    source: MarketingPlatform;
}

export const MarketingPipelineOutputSchema = z.object({
    platform: MarketingPlatformEnum,
    message: z.string().min(1),
    "image/video": z.enum(["image", "video"]),
});
export type MarketingPipelineOutput = z.infer<typeof MarketingPipelineOutputSchema>;

export interface MarketingPipelineResult extends MarketingPipelineOutput {
    research: MarketingResearchResult[];
    normalizedInput: {
        platform: MarketingPlatform;
        prompt: string;
    };
}

