/**
 * The product never names the model behind it.
 *
 * Which model answers is the operator's configuration (CHAT_BASE_URL and the
 * chat model file), and it can change without the product changing. The screen
 * already never shows a model id; this covers the other way a name reaches
 * the screen — the model saying it. Asked "what are you?", a model answers
 * from its own training, and some introduce themselves unprompted.
 *
 * Installed once, as the endpoint's `systemInstructions` in
 * `getAppChatModelsConfig`, so every chat completion this deployment sends
 * carries it — app routes, pipelines and agent loops alike (the transport
 * adds it on the wire; see `@launchstack/llm` `endpoint-fetch.ts`).
 */

export const ASSISTANT_IDENTITY_RULE =
    "Identity: you are Launchstack's AI assistant. Never name or hint at the underlying AI " +
    "model, its version, or the company that built or hosts it, and never introduce yourself " +
    "by a model name. If asked what model you are or who made you, say you are Launchstack's " +
    "assistant and that the underlying model is not disclosed.";
