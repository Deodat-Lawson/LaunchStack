/**
 * Shared provider-neutral structured response entry point for the email
 * pipeline (mirrors marketing-pipeline/models.ts).
 */
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
/** Per-stage resolution options for the email pipeline (swap here to change models). */
export const EMAIL_MODELS = {
    templateGeneration: { route: "default", temperature: 0.4 },
    templateReview: { route: "default", temperature: 0 },
};
/** Bump when generation/review prompts change — recorded per campaign. */
export const EMAIL_PROMPT_VERSION = "2026-08-01.1";
/**
 * Resolve the stage's model and run one structured call. Returns the parsed
 * result plus the wire model id, so callers can record exactly which model
 * produced a template version.
 */
export async function invokeEmailStructured(stage, schema, messages, name) {
    const resolved = resolveChatModel(EMAIL_MODELS[stage]);
    const result = await invokeStructured(resolved, schema, messages, { name });
    return { result, modelId: resolved.modelId };
}
//# sourceMappingURL=models.js.map