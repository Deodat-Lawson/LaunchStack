/**
 * Install this deployment's AI configuration before every background run.
 *
 * API routes reach chat through `~/lib/models`, whose helpers configure core
 * on the way in. Background functions do not use those helpers: they call
 * feature pipelines, and those call core's `resolveChatModel` directly. Whether
 * the configuration was installed by then came down to whether some earlier
 * step in the same invocation happened to touch `getEngine()` — true for some
 * jobs, false for others, and not a property a newly added job would know it
 * had to preserve. On a cold `/api/inngest` invocation that lost the coin flip,
 * the planning or scoring step failed with "Chat models are not configured."
 *
 * The same reasoning applies to the *provider* registry, which NER, reranking
 * and transcription read: `configureProviders` runs inside `getEngine()`, so a
 * cold `/api/inngest` invocation that never touched the engine left the
 * registry empty and every capability resolved to the default endpoint with a
 * blank credential. Both are installed here for the same reason.
 *
 * Inngest re-enters the handler once per step, so this runs per step rather
 * than once per job. The parsed file is cached and `getEngine()` memoizes on
 * globalThis, so the repeat cost is a map lookup.
 */

import { InngestMiddleware } from "inngest";

let warnedAboutFailure = false;

/**
 * Loaded on demand rather than imported at module scope. This module is
 * reachable from the Inngest client, which every route that *sends* an event
 * imports; a static import would pull `@launchstack/core/llm`, the OpenAI SDK,
 * and `yaml` into all of them for a client they never construct.
 */
async function installAiConfiguration(): Promise<void> {
  const [{ env }, { configureAppChatModels }, { getEngine }] = await Promise.all([
    import("~/env"),
    import("~/server/chat-models"),
    import("~/server/engine"),
  ]);
  configureAppChatModels(env.server);
  // Registers the provider registry, embedding defaults and secret box. Cached
  // on globalThis, so this is a lookup after the first step.
  getEngine();
}

export const chatConfigMiddleware = new InngestMiddleware({
  name: "chat-configuration",
  init() {
    return {
      onFunctionRun() {
        return {
          async transformInput() {
            try {
              await installAiConfiguration();
            } catch (error) {
              // Deliberately not fatal. Most background functions never touch
              // chat or a provider, and failing them all because the model file
              // is wrong would turn a misconfiguration into a
              // document-processing outage. The steps that do need one still
              // fail — with their own typed error — and this log explains why.
              if (!warnedAboutFailure) {
                warnedAboutFailure = true;
                console.warn(
                  "[inngest] AI configuration unavailable; steps that need a chat model or a provider will fail:",
                  error instanceof Error ? error.message : error,
                );
              }
            }
          },
        };
      },
    };
  },
});

/** Test helper — re-arms the one-shot warning. */
export function resetChatConfigMiddlewareWarning(): void {
  warnedAboutFailure = false;
}
