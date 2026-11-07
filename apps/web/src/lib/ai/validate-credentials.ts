import type { EmbeddingIndexConfig, CompanyEmbeddingConfig } from "@launchstack/llm/embeddings";

import { V, v } from "~/i18n/validation";

export interface CredentialCheckResult {
    ok: boolean;
    error?: string;
}

/**
 * `error` is English: the provider's own message, or one of the
 * `errors.validation` sentences, which the route words for its reader with
 * `wordEnglish(error, "errors.validation", locale)`.
 *
 * Perform a 1-token test embed against the configured provider using the
 * supplied credentials. Returns `{ ok: true }` on success or `{ ok: false,
 * error }` on any network / auth / dimension failure.
 *
 * Callers use this as a pre-save gate so invalid keys fail fast at settings
 * time instead of much later at document ingestion time.
 */
export async function validateEmbeddingCredentials(
    indexKey: string | undefined,
    config: CompanyEmbeddingConfig
): Promise<CredentialCheckResult> {
    // Lazy-load the factory + registry so that route handlers that merely
    // *import* this module don't transitively pull the full embedding stack
    // (which reaches into validated env vars and LangChain). The cost is
    // paid only when validation actually runs, which is rare (only when the
    // settings save was called with ?validate=true).
    const { createEmbeddingModel, resolveEmbeddingIndex } = await import(
        "@launchstack/llm/embeddings"
    );

    let index: EmbeddingIndexConfig;
    try {
        index = resolveEmbeddingIndex(indexKey, config);
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : V.embeddingIndexUnresolved,
        };
    }

    try {
        const provider = createEmbeddingModel(index, config);
        const vector = await provider.embedQuery("healthcheck");
        if (!Array.isArray(vector) || vector.length !== index.dimension) {
            return {
                ok: false,
                error: v("embeddingVectorLength", {
                    actual: Array.isArray(vector) ? String(vector.length) : "unknown",
                    expected: String(index.dimension),
                }),
            };
        }
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : V.embeddingCredentialsRejected,
        };
    }
}
