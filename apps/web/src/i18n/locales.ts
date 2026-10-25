/**
 * The languages the interface is offered in, and how a request picks one.
 *
 * Adding a language is three steps (see ./README.md): copy
 * `messages/en/` to `messages/<code>/` and translate the values, add an
 * entry below, and add its loader to `./messages.ts`. Every other surface —
 * the switchers, the settings row, `<html lang>`, the AI's reply language,
 * the parity test — reads this list.
 *
 * Dependency-free: the edge middleware, route handlers and client
 * components all import it.
 */

export interface LocaleDefinition {
    /** BCP-47 tag. Also the `<html lang>`, the `Intl` locale and the messages folder. */
    code: string;
    /** The language's name for itself — what a switcher shows, never translated. */
    nativeName: string;
    /** The name in English, for logs and the model instruction. */
    englishName: string;
    /**
     * Lower-case language tags (or prefixes before a `-`) in an
     * Accept-Language header that this locale answers, besides its own code.
     */
    matches: readonly string[];
}

export const LOCALES = [
    { code: "en", nativeName: "English", englishName: "English", matches: ["en"] },
    {
        code: "zh-CN",
        nativeName: "简体中文",
        englishName: "Simplified Chinese (Mandarin)",
        // Every Chinese tag lands here until a Traditional catalogue exists:
        // Simplified reads better to a zh-TW visitor than English does.
        matches: ["zh"],
    },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof LOCALES)[number]["code"];

export const LOCALE_CODES = LOCALES.map(locale => locale.code) as unknown as readonly [
    Locale,
    ...Locale[],
];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && (LOCALE_CODES as readonly string[]).includes(value);
}

export function localeDefinition(code: Locale): LocaleDefinition {
    return LOCALES.find(locale => locale.code === code) ?? LOCALES[0];
}

// ---------------------------------------------------------------------------
// The browser's choice
// ---------------------------------------------------------------------------

/**
 * This browser's latest choice. The value is `<code>.<ms>` — the locale and
 * when it was chosen — so the workspace can tell whether the browser chose
 * after the account setting was saved, the same rule the theme follows
 * (`@launchstack/design-tokens/theme`).
 */
export const LOCALE_COOKIE = "ls-locale";

export interface LocaleChoice {
    locale: Locale;
    /** When it was chosen, in ms since the epoch. */
    at: number;
}

export function formatLocaleChoice(choice: LocaleChoice): string {
    return `${choice.locale}.${Math.floor(choice.at)}`;
}

/** Parse one cookie value. Null when it is not ours or names no known locale. */
export function parseLocaleChoiceValue(raw: string): LocaleChoice | null {
    let value = raw;
    try {
        value = decodeURIComponent(raw);
    } catch {
        // Keep the raw value; it will fail the checks below if it is mangled.
    }
    const dot = value.lastIndexOf(".");
    const code = dot === -1 ? value : value.slice(0, dot);
    const at = dot === -1 ? 0 : Number(value.slice(dot + 1));
    if (!isLocale(code) || !Number.isFinite(at) || at < 0) return null;
    return { locale: code, at };
}

/**
 * The choice in a cookie header. A browser can hold two (a host-only copy and
 * the shared-domain one); the newer wins.
 */
export function parseLocaleChoice(cookieHeader: string): LocaleChoice | null {
    let best: LocaleChoice | null = null;
    for (const part of cookieHeader.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1 || part.slice(0, eq).trim() !== LOCALE_COOKIE) continue;
        const choice = parseLocaleChoiceValue(part.slice(eq + 1).trim());
        if (choice && (!best || choice.at > best.at)) best = choice;
    }
    return best;
}

/**
 * The browser's IANA time zone, so dates formatted while rendering on the
 * server read the same as they will in the browser.
 */
export const TIME_ZONE_COOKIE = "ls-tz";

// ---------------------------------------------------------------------------
// The browser's languages, when nothing was chosen
// ---------------------------------------------------------------------------

/**
 * The best supported locale for an Accept-Language header, or null when none
 * of its languages is one we have. Exact tags beat a bare language match at
 * the same weight; order breaks ties, as the header intends.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
    if (!acceptLanguage) return null;
    const ranges = acceptLanguage
        .split(",")
        .map((part, index) => {
            const [tag = "", ...params] = part.trim().split(";");
            const q = params
                .map(param => param.trim())
                .find(param => param.startsWith("q="))
                ?.slice(2);
            const weight = q === undefined ? 1 : Number(q);
            return { tag: tag.trim().toLowerCase(), weight, index };
        })
        .filter(range => range.tag && range.tag !== "*" && Number.isFinite(range.weight))
        .filter(range => range.weight > 0)
        .sort((a, b) => b.weight - a.weight || a.index - b.index);

    for (const { tag } of ranges) {
        const exact = LOCALES.find(locale => locale.code.toLowerCase() === tag);
        if (exact) return exact.code;
        const base = tag.split("-")[0]!;
        const loose = LOCALES.find(locale =>
            (locale.matches as readonly string[]).some(match => match === tag || match === base)
        );
        if (loose) return loose.code;
    }
    return null;
}

/** Cookie first, then the browser's languages, then English. */
export function resolveLocale(input: {
    cookieHeader?: string | null;
    acceptLanguage?: string | null;
}): Locale {
    return (
        parseLocaleChoice(input.cookieHeader ?? "")?.locale ??
        negotiateLocale(input.acceptLanguage) ??
        DEFAULT_LOCALE
    );
}
