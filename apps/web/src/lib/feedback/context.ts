/**
 * What the browser can say about where a report was made. Collected when the
 * dialog opens — not when it is sent, by which time the page under it may
 * have changed — and shown to the reporter in full before anything is sent.
 */

import type { FeedbackContext } from "./contract";
import { recentErrors } from "./recent-errors";

/** "Chrome 141 on macOS". Coarse on purpose: triage reads it at a glance. */
export function describeBrowser(userAgent: string): string | undefined {
    const ua = userAgent;
    const browser =
        match(ua, /Edg\/(\d+)/, "Edge") ??
        match(ua, /OPR\/(\d+)/, "Opera") ??
        match(ua, /Firefox\/(\d+)/, "Firefox") ??
        match(ua, /Chrome\/(\d+)/, "Chrome") ??
        (ua.includes("Safari/") ? match(ua, /Version\/(\d+)/, "Safari") : undefined);
    const os = /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : ua.includes("Android")
          ? "Android"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : ua.includes("Windows")
              ? "Windows"
              : /Linux|X11/.test(ua)
                ? "Linux"
                : undefined;
    if (!browser && !os) return undefined;
    if (!os) return browser;
    if (!browser) return os;
    return `${browser} on ${os}`;
}

function match(ua: string, pattern: RegExp, name: string): string | undefined {
    const m = pattern.exec(ua);
    return m ? `${name} ${m[1]}` : undefined;
}

export interface CollectOptions {
    /** Off sends the page's path and nothing else. */
    technical: boolean;
    origin?: Record<string, string>;
}

export function collectFeedbackContext({ technical, origin }: CollectOptions): FeedbackContext {
    if (typeof window === "undefined") return {};
    const { location, navigator, document, screen } = window;
    const path = `${location.pathname}${location.search}`;
    if (!technical) return origin ? { path, origin } : { path };
    const root = document.documentElement;
    const errors = recentErrors();
    return {
        url: location.href,
        path,
        pageTitle: document.title || undefined,
        userAgent: navigator.userAgent,
        browser: describeBrowser(navigator.userAgent),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        screen: {
            width: screen.width,
            height: screen.height,
            pixelRatio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
        },
        theme: root.dataset.theme === "dark" ? "dark" : "light",
        locale: root.lang || navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recentErrors: errors.length > 0 ? errors : undefined,
        origin,
    };
}
