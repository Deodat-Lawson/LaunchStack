/**
 * Every shipped catalogue says everything English says, asks for the same
 * values, and parses. Run `npx jest src/i18n` after editing any messages file.
 */

import { createTranslator } from "use-intl";

import { LOCALES } from "~/i18n/locales";
import { englishMessages } from "~/i18n/messages";
import zhCN from "~/i18n/messages/zh-CN";
import { messageShape } from "~/i18n/icu";

type Tree = { [key: string]: string | Tree };

const CATALOGUES: Record<string, Tree> = { "zh-CN": zhCN as unknown as Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (key.includes(".")) throw new Error(`Key "${path}" contains a dot; nest it instead.`);
        if (typeof value === "string") out.set(path, value);
        else for (const [k, v] of leaves(value, path)) out.set(k, v);
    }
    return out;
}

/**
 * `I18N_NAMESPACES=sources,chat npx jest src/i18n` checks only those
 * namespaces — for working on one feature while another is mid-edit.
 */
const only = process.env.I18N_NAMESPACES?.split(",")
    .map(ns => ns.trim())
    .filter(Boolean);
function inScope(key: string): boolean {
    return !only?.length || only.includes(key.split(".")[0]!);
}

const english = new Map(
    [...leaves(englishMessages as unknown as Tree)].filter(([key]) => inScope(key))
);

function sorted(set: Set<string>): string[] {
    return [...set].sort();
}

describe("English catalogue", () => {
    it("has no empty messages and parses", () => {
        for (const [key, message] of english) {
            expect([key, message.trim().length > 0]).toEqual([key, true]);
            expect(() => messageShape(message)).not.toThrow();
        }
    });

    it("formats every message", () => {
        const t = createTranslator({ locale: "en", messages: englishMessages });
        for (const [key, message] of english) expect(() => format(t, key, message)).not.toThrow();
    });
});

describe.each(LOCALES.filter(locale => locale.code !== "en").map(locale => locale.code))(
    "%s catalogue",
    code => {
        const catalogue = CATALOGUES[code];
        const translated = new Map(
            [...(catalogue ? leaves(catalogue) : new Map<string, string>())].filter(([key]) =>
                inScope(key)
            )
        );

        it("is registered here and in i18n/messages.ts", () => {
            expect(catalogue).toBeDefined();
        });

        it("translates every English key", () => {
            const missing = [...english.keys()].filter(key => !translated.has(key));
            expect(missing).toEqual([]);
        });

        it("has no keys English does not", () => {
            const extra = [...translated.keys()].filter(key => !english.has(key));
            expect(extra).toEqual([]);
        });

        it("asks for the same arguments and tags as English", () => {
            const mismatched: string[] = [];
            for (const [key, message] of translated) {
                const source = english.get(key);
                if (source === undefined) continue;
                const theirs = messageShape(message);
                const ours = messageShape(source);
                if (
                    sorted(theirs.arguments).join() !== sorted(ours.arguments).join() ||
                    sorted(theirs.tags).join() !== sorted(ours.tags).join()
                ) {
                    mismatched.push(`${key}: "${source}" → "${message}"`);
                }
            }
            expect(mismatched).toEqual([]);
        });

        it("formats every message", () => {
            const t = createTranslator({ locale: code, messages: catalogue as never });
            for (const [key, message] of translated) {
                expect(() => format(t, key, message)).not.toThrow();
            }
        });

        it("translates sentences rather than copying the English", () => {
            // Brand and product names legitimately stay the same; a sentence
            // of ordinary English words copied across is a missed translation.
            const copied = [...translated].filter(([key, message]) => {
                if (message !== english.get(key)) return false;
                const words = message.replace(/\{[^}]*\}|<[^>]*>/g, " ").match(/\b[a-z]{2,}\b/g);
                return (words?.length ?? 0) >= 3;
            });
            expect(copied.map(([key]) => key)).toEqual([]);
        });
    }
);

/** Format with a stand-in for every argument and tag the message names. */
function format(t: unknown, key: string, message: string): string {
    const shape = messageShape(message);
    const values: Record<string, unknown> = {};
    for (const name of shape.arguments) values[name] = 1;
    for (const tag of shape.tags) values[tag] = (chunks: string) => chunks;
    return (t as { markup: (k: string, v: object) => string }).markup(key, values);
}
