/**
 * Whose bill a chat answer lands on.
 *
 * A workspace that brought its own model endpoint pays its own provider for
 * every token that endpoint serves, so LaunchStack must not debit credits for
 * the same tokens. Only chat-token debits read this: embeddings, OCR, search
 * and the other services still run on the deployment's providers and are
 * charged as before.
 */
import type { ChatModelsSource } from "@launchstack/llm";

/**
 * True when chat tokens served by `source` should be debited from the
 * workspace's LaunchStack credits. Read `source` where the model was resolved
 * (`getChatModelsSource()` inside the workspace scope), not later.
 */
export function shouldDebitChatTokens(source: ChatModelsSource): boolean {
    return source !== "workspace";
}
