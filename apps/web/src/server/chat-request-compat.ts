import type { Locale } from "~/i18n/locales";
import { translatorFor } from "~/i18n/translate";

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
 * Operators own model selection, and no client is told which model serves a
 * route, so a request naming one is refused whatever it names. Refusing a
 * match and a mismatch alike matters: accepting the right id would let a
 * caller confirm a guess. `provider` has no meaning at all now that every
 * route reaches the same endpoint. Both are rejected loudly rather than
 * ignored: silently discarding a selector would let a client believe it
 * picked something it did not get.
 */
export function validateDeprecatedChatSelection(
    requested: DeprecatedChatSelection,
    /** The reader's language for the refusal; English for API readers. */
    locale: Locale = "en"
): DeprecatedChatSelectionResult {
    const t = translatorFor(locale, "chat.server.compat");
    if (requested.provider) {
        return { ok: false, status: 400, message: t("provider") };
    }
    if (requested.model) {
        return { ok: false, status: 400, message: t("model") };
    }
    return { ok: true };
}
