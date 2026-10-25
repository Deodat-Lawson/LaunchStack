/**
 * The visitor's theme choice, shared by apps/landing and apps/web.
 *
 * The two apps are separate origins (home.<domain> and <domain>, or
 * launchstack.app and app.launchstack.app), so next-themes' localStorage
 * never crosses between them. This cookie does: it lives on the domain the
 * two sites share, and it is the one record of the latest choice made on
 * either site. next-themes stays the thing that stamps `data-theme`; the
 * boot script below copies the cookie into its localStorage before its own
 * script reads it, so the first paint is already right.
 *
 * The value is `<theme>.<ms>`: the theme and when it was chosen, so the app
 * can tell whether this browser chose after the account setting was saved.
 *
 * No React, no dependencies: both apps import it, and its boot script is
 * inlined into every page's <head>.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type ThemeName = (typeof THEMES)[number];

/** Read by the boot script too, so it must stay a plain cookie name. */
export const THEME_COOKIE = "ls-theme";
/** next-themes' default `storageKey`; both apps use the default. */
export const THEME_STORAGE_KEY = "theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export interface ThemeChoice {
    theme: ThemeName;
    /** When it was chosen, in ms since the epoch. */
    at: number;
}

export function isThemeName(value: unknown): value is ThemeName {
    return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function formatThemeChoice(choice: ThemeChoice): string {
    return `${choice.theme}.${Math.floor(choice.at)}`;
}

/**
 * The choice in a cookie header, or null when absent or not ours. A browser
 * can hold two (a host-only copy from before the shared one existed); the
 * newer wins.
 */
export function parseThemeChoice(cookieHeader: string): ThemeChoice | null {
    let best: ThemeChoice | null = null;
    for (const part of cookieHeader.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1 || part.slice(0, eq).trim() !== THEME_COOKIE) continue;
        const [theme, at] = decodeURIComponent(part.slice(eq + 1).trim()).split(".");
        const ms = Number(at);
        if (!isThemeName(theme) || !Number.isFinite(ms) || ms < 0) continue;
        if (!best || ms > best.at) best = { theme, at: ms };
    }
    return best;
}

/**
 * Domains to try for the cookie, broadest first: `a.b.example.com` gives
 * `example.com`, `b.example.com`, `a.b.example.com`. The browser refuses a
 * public suffix (`com`, `co.uk`, `vercel.app`), so the first one that sticks
 * is the registrable domain both sites share. Empty for localhost and IP
 * addresses, where a host-only cookie is already shared across ports.
 */
export function cookieDomainCandidates(hostname: string): string[] {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return [];
    const labels = host.split(".");
    const out: string[] = [];
    for (let n = 2; n <= labels.length; n++) out.push(labels.slice(-n).join("."));
    return out;
}

/** Remember `theme` as this browser's latest choice, on the shared domain. */
export function writeThemeChoice(theme: ThemeName, at: number = Date.now()): void {
    if (typeof document === "undefined") return;
    const entry = `${THEME_COOKIE}=${formatThemeChoice({ theme, at })}`;
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

export function readThemeChoice(): ThemeChoice | null {
    if (typeof document === "undefined") return null;
    return parseThemeChoice(document.cookie);
}

/**
 * Inlined in each app's <head>, ahead of next-themes' own script in <body>:
 * copies the cookie's theme into next-themes' localStorage so the page paints
 * in the latest choice made on either site. Must stay self-contained ES5.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=document.cookie.split(";"),k="${THEME_COOKIE}=",t=null,a=-1;for(var i=0;i<c.length;i++){var s=c[i].replace(/^\\s+/,"");if(s.indexOf(k)!==0)continue;var v=decodeURIComponent(s.slice(k.length)).split("."),n=+v[1];if((v[0]==="light"||v[0]==="dark"||v[0]==="system")&&n>a){a=n;t=v[0]}}if(t&&localStorage.getItem("${THEME_STORAGE_KEY}")!==t)localStorage.setItem("${THEME_STORAGE_KEY}",t)}catch(e){}})();`;
