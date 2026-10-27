/**
 * The message catalogues, one per locale, each split into one JSON file per
 * namespace (`messages/<locale>/<namespace>.json`) so a feature's strings
 * live in one place and two features never edit the same file.
 *
 * English is the source of truth: its shape is the `Messages` type every
 * `t("…")` call is checked against (./types.d.ts), and it is the fallback a
 * missing translation renders in — another locale's catalogue is laid over
 * it, so a key not yet translated shows English rather than its key.
 */

import type { Locale } from "./locales";
import en from "./messages/en";

export type Messages = typeof en;

/** A catalogue may lag English; whatever it lacks falls back. */
export type PartialMessages = DeepPartial<Messages>;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/**
 * One loader per locale, so a request only parses its own catalogue. A new
 * language adds its line here (see ./README.md).
 */
const LOADERS: Record<Locale, () => Promise<PartialMessages>> = {
    en: () => Promise.resolve(en),
    "zh-CN": () => import("./messages/zh-CN").then(module => module.default),
};

type Tree = { [key: string]: string | Tree };

/** `overlay` laid over `base`: its strings win, its gaps show `base`. */
export function mergeMessages<T extends Tree>(base: T, overlay: DeepPartial<T> | undefined): T {
    if (!overlay) return base;
    const out: Tree = { ...base };
    for (const [key, value] of Object.entries(overlay as Tree)) {
        const under = base[key];
        if (typeof value === "string") {
            if (typeof under === "string" || under === undefined) out[key] = value;
        } else if (value && typeof value === "object" && under && typeof under === "object") {
            out[key] = mergeMessages(under, value);
        }
    }
    return out as T;
}

const cache = new Map<Locale, Promise<Messages>>();

export function loadMessages(locale: Locale): Promise<Messages> {
    let pending = cache.get(locale);
    if (!pending) {
        pending =
            locale === "en"
                ? Promise.resolve(en)
                : (LOADERS[locale]().then(overlay =>
                      mergeMessages(en as unknown as Tree, overlay as never)
                  ) as Promise<Messages>);
        // A failed load is retried on the next request rather than cached.
        pending.catch(() => cache.delete(locale));
        cache.set(locale, pending);
    }
    return pending;
}

export { en as englishMessages };
