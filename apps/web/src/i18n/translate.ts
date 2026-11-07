/**
 * Translators for server code: the sentences a route handler or a service
 * writes for a screen (an `{ error }` shown as it comes, a step label, a
 * reason). Synchronous — every catalogue is in memory on the server — so
 * they work inside the sync helpers that build responses.
 *
 * Components use `getTranslations` / `useTranslations`; a route handler with
 * the request in hand uses `requestTranslator` (./server). API, MCP and audit
 * readers send neither the `ls-locale` cookie nor a Chinese Accept-Language,
 * so what they read stays English.
 */

import { createTranslator } from "next-intl";
import type { NamespaceKeys, NestedKeyOf } from "use-intl";

import type { Copy } from "./copy";
import type { Locale } from "./locales";
import { englishMessages, mergeMessages, type Messages } from "./messages";
import zhCN from "./messages/zh-CN";

/**
 * Every catalogue, complete: a translation's gaps show English. A new
 * language adds its line here too (see ./README.md).
 */
const CATALOGUES: Record<Locale, Messages> = {
    en: englishMessages,
    "zh-CN": mergeMessages(englishMessages, zhCN),
};

export type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

const translators = new Map<string, unknown>();

/** next-intl's translator over `namespace` in `locale`. */
export function translatorFor<N extends Namespace>(locale: Locale, namespace: N) {
    const id = `${locale}\u0000${namespace}`;
    let translator = translators.get(id) as ReturnType<typeof make<N>> | undefined;
    if (!translator) {
        translator = make(locale, namespace);
        translators.set(id, translator);
    }
    return translator;
}

function make<N extends Namespace>(locale: Locale, namespace: N) {
    return createTranslator({ locale, messages: CATALOGUES[locale], namespace });
}

const roots = new Map<Locale, (key: string, values?: Copy["values"]) => string>();

/** A `Copy` in `locale`. */
export function wordCopy(copy: Copy, locale: Locale): string {
    let t = roots.get(locale);
    if (!t) {
        const translator = createTranslator({ locale, messages: CATALOGUES[locale] });
        t = (key, values) => translator(key as never, values as never);
        roots.set(locale, t);
    }
    return t(copy.key, copy.values);
}

/** The English of a `Copy` — an error's `message`, a log line, an API field. */
export function englishCopy(copy: Copy): string {
    return wordCopy(copy, "en");
}

/** A `Copy`'s words in `locale`, or `english` as it is when there is none. */
export function wordOr(copy: Copy | null | undefined, english: string, locale: Locale): string {
    return copy ? wordCopy(copy, locale) : english;
}

type Tree = { [key: string]: string | Tree };

const reverse = new Map<string, Map<string, string[]>>();

/**
 * The words of an English sentence that came from the catalogue subtree at
 * `path` — for text a library carries as a plain string, which is how a zod
 * issue keeps the message its schema was given (~/i18n/validation). Whole
 * sentences only: a message with arguments matches with its values filled
 * in, and `wordValue` may word those values in turn (a sentence quoted
 * inside another). Anything else comes back as it was.
 */
export function wordEnglish(
    english: string,
    path: string,
    locale: Locale,
    wordValue?: (value: string) => string
): string {
    if (locale === "en") return english;
    let index = reverse.get(path);
    if (!index) {
        index = new Map();
        for (const [key, source] of leaves(subtree(englishMessages as unknown as Tree, path))) {
            const keys = index.get(source) ?? [];
            keys.push(key);
            index.set(source, keys);
        }
        reverse.set(path, index);
    }
    const exact = index.get(english)?.[0];
    if (exact) return wordCopy({ key: `${path}.${exact}` as Copy["key"] }, locale);
    for (const [source, keys] of index) {
        const values = matchTemplate(source, english);
        if (!values) continue;
        if (wordValue)
            for (const name of Object.keys(values)) values[name] = wordValue(values[name]!);
        return wordCopy({ key: `${path}.${keys[0]}` as Copy["key"], values }, locale);
    }
    return english;
}

function subtree(tree: Tree, path: string): Tree {
    let node: string | Tree | undefined = tree;
    for (const part of path.split(".")) {
        node = typeof node === "object" ? node[part] : undefined;
    }
    if (!node || typeof node !== "object") throw new Error(`No messages at "${path}".`);
    return node;
}

function leaves(tree: Tree, prefix = ""): [string, string][] {
    return Object.entries(tree).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return typeof value === "string"
            ? [[path, value] as [string, string]]
            : leaves(value, path);
    });
}

/**
 * `{name}` arguments of a template read back out of a sentence it produced.
 * Plural and select messages never match (their text depends on the value).
 */
function matchTemplate(template: string, sentence: string): Record<string, string> | null {
    if (!template.includes("{") || /\{\s*\w+\s*,/.test(template)) return null;
    const names: string[] = [];
    const pattern = template
        .replace(/''/g, "'")
        .split(/\{\s*(\w+)\s*\}/)
        .map((part, i) => {
            if (i % 2 === 1) {
                names.push(part);
                return "(.+?)";
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
    const match = new RegExp(`^${pattern}$`, "s").exec(sentence);
    if (!match) return null;
    return Object.fromEntries(names.map((name, i) => [name, match[i + 1]!]));
}
