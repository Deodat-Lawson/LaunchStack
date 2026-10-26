"use client";

/**
 * Changing the interface language from the browser. The cookie is the record
 * the server renders from (./request.ts); the account setting
 * (`appearance.language`) follows the person to other browsers and is kept
 * in step by the workspace's PreferenceSync, which saves any change made here.
 */

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { cookieDomainCandidates } from "@launchstack/design-tokens/theme";

import {
    LOCALE_COOKIE,
    TIME_ZONE_COOKIE,
    formatLocaleChoice,
    parseLocaleChoice,
    type Locale,
    type LocaleChoice,
} from "./locales";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Set a cookie on the broadest domain that sticks, like the theme cookie. */
function writeSharedCookie(name: string, value: string): void {
    if (typeof document === "undefined") return;
    const entry = `${name}=${encodeURIComponent(value)}`;
    const base = `${entry}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${
        location.protocol === "https:" ? "; Secure" : ""
    }`;
    const stuck = () => document.cookie.split(/;\s*/).includes(entry);
    for (const domain of cookieDomainCandidates(location.hostname)) {
        document.cookie = `${base}; Domain=${domain}`;
        if (stuck()) return;
    }
    document.cookie = base;
}

/** Remember `locale` as this browser's latest choice. */
export function writeLocaleChoice(locale: Locale, at: number = Date.now()): void {
    writeSharedCookie(LOCALE_COOKIE, formatLocaleChoice({ locale, at }));
}

export function readLocaleChoice(): LocaleChoice | null {
    if (typeof document === "undefined") return null;
    return parseLocaleChoice(document.cookie);
}

/** Record the browser's time zone for server rendering; true when it changed. */
export function writeTimeZone(): boolean {
    if (typeof document === "undefined") return false;
    let zone: string | undefined;
    try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return false;
    }
    if (!zone) return false;
    const current = document.cookie
        .split(/;\s*/)
        .find(part => part.startsWith(`${TIME_ZONE_COOKIE}=`))
        ?.slice(TIME_ZONE_COOKIE.length + 1);
    if (current && decodeURIComponent(current) === zone) return false;
    writeSharedCookie(TIME_ZONE_COOKIE, zone);
    return true;
}

/**
 * The app router, or null outside one (a component test, a Pages Router
 * screen). `useRouter` throws there; the context read underneath it runs
 * either way, so the hook order holds.
 */
function useOptionalRouter(): ReturnType<typeof useRouter> | null {
    try {
        return useRouter();
    } catch {
        return null;
    }
}

/**
 * Switch the interface language: write the choice and re-render from the
 * server. A refresh, not a reload — drafts, open panes and scroll positions
 * survive, and every string comes back in the new language. Outside the app
 * router it falls back to a reload.
 */
export function useChangeLocale(): {
    locale: Locale;
    changeLocale: (next: Locale, at?: number) => void;
    pending: boolean;
} {
    const locale = useLocale();
    const router = useOptionalRouter();
    const [pending, startTransition] = useTransition();
    const changeLocale = useCallback(
        (next: Locale, at?: number) => {
            writeLocaleChoice(next, at);
            if (next === locale) return;
            document.documentElement.lang = next;
            if (router) startTransition(() => router.refresh());
            else window.location.reload();
        },
        [locale, router]
    );
    return { locale, changeLocale, pending };
}
