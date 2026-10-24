/**
 * The request's language, for server code that is not a component: route
 * handlers that answer in words (the chat route's model instruction) read it
 * here. Components use `getTranslations` / `useTranslations` instead.
 */

import { cookies, headers } from "next/headers";

import { TIME_ZONE_COOKIE, localeDefinition, resolveLocale, type Locale } from "./locales";

export async function getRequestLocale(): Promise<Locale> {
    const headerStore = await headers();
    return resolveLocale({
        // The raw header, not cookies(): a browser can hold a host-only and a
        // shared-domain copy, and the newer of the two is the choice.
        cookieHeader: headerStore.get("cookie"),
        acceptLanguage: headerStore.get("accept-language"),
    });
}

/**
 * The language of the person behind `request`, from its own headers — for a
 * route handler that has the request in hand (and for its tests, which have
 * no Next request scope).
 */
export function localeOfRequest(request: Request): Locale {
    return resolveLocale({
        cookieHeader: request.headers.get("cookie"),
        acceptLanguage: request.headers.get("accept-language"),
    });
}

/** The browser's IANA zone, once ./TimeZoneSync has written it. */
export async function getRequestTimeZone(): Promise<string | undefined> {
    const raw = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
    if (!raw) return undefined;
    try {
        // Throws for a zone this runtime does not know.
        new Intl.DateTimeFormat("en", { timeZone: raw });
        return raw;
    } catch {
        return undefined;
    }
}

/**
 * The line a system prompt carries so the model answers in the interface
 * language. Null for English, which needs no instruction. A person who writes
 * in another language, or asks for one, is still answered in it.
 */
export function replyLanguageInstruction(locale: Locale): string | null {
    if (locale === "en") return null;
    const { englishName, nativeName } = localeDefinition(locale);
    return `The user reads this app in ${englishName} (${nativeName}). Write your reply in ${englishName} unless the user writes in another language or asks for one. Keep quotations from sources, code, file names and proper nouns as they are.`;
}
