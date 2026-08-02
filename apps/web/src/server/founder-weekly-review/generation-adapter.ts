import type { ZodType } from "zod";

import {
    generateStructuredWithMetadata,
    type StructuredGenerationMetadata,
} from "~/lib/llm";

/**
 * Host adapter for LAU-7. The feature receives this function as an injected
 * dependency and therefore remains independent of providers and web code.
 */
export function generateFounderWeeklyReviewStructured<TSchema extends ZodType>(input: {
    system?: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
}): Promise<{
    object: ReturnType<TSchema["parse"]>;
    metadata: StructuredGenerationMetadata;
}> {
    return generateStructuredWithMetadata({
        ...input,
        capability: "founderWeeklyReview",
    });
}
