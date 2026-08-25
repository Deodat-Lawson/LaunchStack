import type { ResolvedChatModel } from "@launchstack/llm";

export interface DeprecatedChatSelection {
    /** Pre-PR per-request provider selector. No longer meaningful. */
    provider?: string;
    /** Pre-PR per-request model selector. */
    model?: string;
}

export type DeprecatedChatSelectionResult =
    | { ok: true }
    | { ok: false; status: 400; message: string };

/**
 * Compatibility-window handling for legacy request selectors.
 *
 * Operators own model selection. An old client may still echo back the model
 * it was told about — that is harmless and accepted — but it cannot change it,
 * and `provider` has no meaning at all now that every route reaches the same
 * endpoint. Both are rejected loudly rather than ignored: silently discarding
 * a selector would let a client believe it picked a model it did not get.
 */
export function validateDeprecatedChatSelection(
    requested: DeprecatedChatSelection,
    resolved: Pick<ResolvedChatModel, "modelId">
): DeprecatedChatSelectionResult {
    if (requested.provider) {
        return {
            ok: false,
            status: 400,
            message:
                "Per-request provider selection is no longer supported; the deployment serves one chat endpoint configured by the operator",
        };
    }
    if (requested.model && requested.model !== resolved.modelId) {
        return {
            ok: false,
            status: 400,
            message:
                "Per-request model overrides are disabled; the model serving each route is operator-configured",
        };
    }
    return { ok: true };
}
