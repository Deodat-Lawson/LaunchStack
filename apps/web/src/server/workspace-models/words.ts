/**
 * The workspace-model modules (address checks, probes, the key store, the
 * selection checks) write their sentences in English for the admin who set
 * the endpoint up; `settings.server.models` holds the same sentences, so a
 * route words one for its reader with this. Anything else — a provider's own
 * message — comes back as it was.
 */

import type { Locale } from "~/i18n/locales";
import { wordEnglish } from "~/i18n/translate";

export function wordModels(english: string, locale: Locale): string {
    return wordEnglish(english, "settings.server.models", locale);
}
