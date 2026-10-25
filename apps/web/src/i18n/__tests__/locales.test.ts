import {
    DEFAULT_LOCALE,
    formatLocaleChoice,
    negotiateLocale,
    parseLocaleChoice,
    resolveLocale,
} from "~/i18n/locales";
import { mergeMessages } from "~/i18n/messages";
import { decideLocale } from "~/app/employer/_chrome/localeChoice";
import { messageShape } from "~/i18n/icu";

describe("negotiateLocale", () => {
    it.each([
        ["zh-CN,zh;q=0.9,en;q=0.8", "zh-CN"],
        ["zh-TW", "zh-CN"],
        ["zh-Hans-CN", "zh-CN"],
        ["en-US,en;q=0.9", "en"],
        ["fr-FR,fr;q=0.9,zh;q=0.5,en;q=0.4", "zh-CN"],
        ["fr-FR,en;q=0.1,zh;q=0.5", "zh-CN"],
        ["de, en;q=0", null],
        ["", null],
        ["*", null],
    ])("%s → %s", (header, expected) => {
        expect(negotiateLocale(header)).toBe(expected);
    });
});

describe("the locale cookie", () => {
    it("round-trips and prefers the newer of two copies", () => {
        const older = formatLocaleChoice({ locale: "en", at: 1000 });
        const newer = formatLocaleChoice({ locale: "zh-CN", at: 2000 });
        expect(parseLocaleChoice(`a=b; ls-locale=${newer}; ls-locale=${older}`)).toEqual({
            locale: "zh-CN",
            at: 2000,
        });
    });

    it("ignores a locale this build does not ship", () => {
        expect(parseLocaleChoice("ls-locale=xx-YY.5")).toBeNull();
    });

    it("beats the browser's languages, which beat the default", () => {
        expect(resolveLocale({ cookieHeader: "ls-locale=en.1", acceptLanguage: "zh-CN" })).toBe(
            "en"
        );
        expect(resolveLocale({ cookieHeader: "", acceptLanguage: "zh-CN" })).toBe("zh-CN");
        expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    });
});

describe("mergeMessages", () => {
    it("falls back to the base for what the overlay lacks", () => {
        const base = { a: "A", nested: { b: "B", c: "C" } };
        expect(mergeMessages(base, { nested: { b: "乙" } })).toEqual({
            a: "A",
            nested: { b: "乙", c: "C" },
        });
    });
});

describe("decideLocale", () => {
    const at = (iso: string) => Date.parse(iso);

    it("keeps the browser's guess while the account has never chosen", () => {
        expect(decideLocale({ value: "en", updatedAt: null }, null, "zh-CN")).toEqual({
            kind: "keep",
        });
    });

    it("saves a browser choice the account has not seen", () => {
        expect(
            decideLocale({ value: "en", updatedAt: null }, { locale: "zh-CN", at: 5 }, "zh-CN")
        ).toEqual({ kind: "save", locale: "zh-CN" });
    });

    it("follows an account choice made after the browser's", () => {
        expect(
            decideLocale(
                { value: "zh-CN", updatedAt: "2026-10-02T00:00:00.000Z" },
                { locale: "en", at: at("2026-10-01T00:00:00.000Z") },
                "en"
            )
        ).toEqual({ kind: "apply", locale: "zh-CN", at: at("2026-10-02T00:00:00.000Z") });
    });

    it("keeps a newer browser choice and saves it", () => {
        expect(
            decideLocale(
                { value: "zh-CN", updatedAt: "2026-10-01T00:00:00.000Z" },
                { locale: "en", at: at("2026-10-02T00:00:00.000Z") },
                "en"
            )
        ).toEqual({ kind: "save", locale: "en" });
    });
});

describe("messageShape", () => {
    it("finds arguments at every depth, and tags", () => {
        const shape = messageShape(
            "{count, plural, =0 {No files} one {# file from {name}} other {# files}} <link>view</link> '{literal}'"
        );
        expect([...shape.arguments].sort()).toEqual(["count", "name"]);
        expect([...shape.tags]).toEqual(["link"]);
    });

    it("rejects unbalanced braces", () => {
        expect(() => messageShape("Hello {name")).toThrow();
        expect(() => messageShape("Hello }")).toThrow();
    });
});
