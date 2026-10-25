/**
 * The request's language, for server code that is not a component: route
 * handlers that answer in words (their errors, the chat route's model
 * instruction) read it here. Components use `getTranslations` /
 * `useTranslations` instead.
 */

import { cookies, headers } from "next/headers";

import {
    DEFAULT_LOCALE,
    TIME_ZONE_COOKIE,
    localeDefinition,
    resolveLocale,
    type Locale,
} from "./locales";
import { translatorFor, type Namespace } from "./translate";

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
 * `getRequestLocale()`, or English outside a request (a worker, a script, a
 * test) — for shared helpers that answer in words without being handed the
 * request, such as the workspace guard's 401 and 403.
 */
export async function requestLocaleOrDefault(): Promise<Locale> {
    try {
        return await getRequestLocale();
    } catch {
        return DEFAULT_LOCALE;
    }
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

/**
 * A translator in the language of the person behind `request`, for the
 * sentences a route handler writes for a screen:
 *
 *   const t = requestTranslator(request, "errors.api");
 *   return NextResponse.json({ error: t("notFound") }, { status: 404 });
 */
export function requestTranslator<N extends Namespace>(request: Request, namespace: N) {
    return translatorFor(localeOfRequest(request), namespace);
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
 * For a model writing text the person will read as interface copy (starter
 * questions, suggestions): write it in their language. Null for English.
 */
export function outputLanguageInstruction(locale: Locale): string | null {
    if (locale === "en") return null;
    const { englishName, nativeName } = localeDefinition(locale);
    return `Write every question and hint in ${englishName} (${nativeName}). Keep document titles, folder names, product names and proper nouns exactly as they appear in the evidence.`;
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
