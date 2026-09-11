/**
 * Shared provider-neutral structured response entry point for the email
 * pipeline (mirrors marketing-pipeline/models.ts).
 */
import type { BaseMessageLike } from "@langchain/core/messages";
import type { z } from "zod";
/** Per-stage resolution options for the email pipeline (swap here to change models). */
export declare const EMAIL_MODELS: {
    readonly templateGeneration: {
        readonly route: "default";
        readonly temperature: 0.4;
    };
    readonly templateReview: {
        readonly route: "default";
        readonly temperature: 0;
    };
};
/** Bump when generation/review prompts change — recorded per campaign. */
export declare const EMAIL_PROMPT_VERSION = "2026-08-23.1";
/**
 * Resolve the stage's model and run one structured call. Returns the parsed
 * result plus the wire model id, so callers can record exactly which model
 * produced a template version.
 */
export declare function invokeEmailStructured<T>(stage: keyof typeof EMAIL_MODELS, schema: z.ZodType<T>, messages: readonly BaseMessageLike[], name: string): Promise<{
    result: T;
    modelId: string;
}>;
//# sourceMappingURL=models.d.ts.map