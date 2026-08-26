/**
 * Shared provider-neutral structured response entry point for marketing.
 */
import { invokeStructured, resolveChatModel } from "@launchstack/llm";
export async function invokeMarketingStructured(schema, messages, name) {
    return invokeStructured(resolveChatModel({ route: "fast" }), schema, messages, { name });
}
//# sourceMappingURL=models.js.map
