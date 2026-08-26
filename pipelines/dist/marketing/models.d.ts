/**
 * Shared provider-neutral structured response entry point for marketing.
 */
import type { BaseMessageLike } from "@langchain/core/messages";
import type { z } from "zod";
export declare function invokeMarketingStructured<T>(
    schema: z.ZodType<T>,
    messages: readonly BaseMessageLike[],
    name: string
): Promise<T>;
//# sourceMappingURL=models.d.ts.map
