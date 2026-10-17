/**
 * Language names and the languages a transcript can be translated into.
 * Codes are BCP-47; names come from `Intl.DisplayNames`, so nothing here is a
 * hand-kept translation table.
 */

/** Offered in the transcript viewer's Translate menu, most-spoken first. */
export const TRANSLATION_LANGUAGES = [
    "en",
    "zh-Hans",
    "zh-Hant",
    "es",
    "hi",
    "ar",
    "fr",
    "pt",
    "ru",
    "ja",
    "de",
    "ko",
    "vi",
    "it",
] as const;

function displayName(code: string, inLocale: string): string | null {
    try {
        const name = new Intl.DisplayNames([inLocale], { type: "language" }).of(code);
        return name && name !== code ? name : null;
    } catch {
        return null;
    }
}

/** "yue" → "Cantonese"; an unknown code comes back as given. */
export function languageName(code: string): string {
    return displayName(code, "en") ?? code;
}

/** The language's name for itself: "yue" → "粵語", "es" → "español". */
export function nativeLanguageName(code: string): string {
    return displayName(code, code) ?? languageName(code);
}

/** "Cantonese · 粵語", or just "English" when the two names agree. */
export function languageLabel(code: string): string {
    const english = languageName(code);
    const native = nativeLanguageName(code);
    return native.toLowerCase() === english.toLowerCase() ? english : `${english} · ${native}`;
}

/** "zh-Hant-HK" → "zh"; for "is this the same language" checks. */
export function baseLanguage(code: string): string {
    return code.split("-")[0]!.toLowerCase();
}

/**
 * The reader's own languages that the Translate menu offers, best first: an
 * exact match ("zh-TW" → "zh-Hant" by script), else the base language.
 */
export function readerLanguages(navigatorLanguages: readonly string[]): string[] {
    const offered: string[] = [];
    for (const raw of navigatorLanguages) {
        let maximized: Intl.Locale | null = null;
        try {
            maximized = new Intl.Locale(raw).maximize();
        } catch {
            continue;
        }
        const base = maximized.language;
        const candidate =
            base === "zh" ? (maximized.script === "Hant" ? "zh-Hant" : "zh-Hans") : base;
        if ((TRANSLATION_LANGUAGES as readonly string[]).includes(candidate)) {
            if (!offered.includes(candidate)) offered.push(candidate);
        }
    }
    return offered;
}

/**
 * The language to suggest first for a transcript: the reader's own, unless
 * the transcript is already in it, then English, then Simplified Chinese.
 */
export function suggestedTranslation(
    transcriptLanguage: string | null,
    navigatorLanguages: readonly string[]
): string {
    const spoken = transcriptLanguage ? baseLanguage(transcriptLanguage) : null;
    // Cantonese and Mandarin share a written base for this purpose.
    const sameAsSpoken = (code: string) => {
        const base = baseLanguage(code);
        return spoken !== null && (base === spoken || (spoken === "yue" && base === "zh"));
    };
    const choices = [...readerLanguages(navigatorLanguages), "en", "zh-Hans"];
    return choices.find(code => !sameAsSpoken(code)) ?? "en";
}
