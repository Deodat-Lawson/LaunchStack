"use client";

/**
 * Applies member preferences to the document.
 *
 * Theme goes through next-themes, which remains the thing that stamps
 * `data-theme` on `<html>` and remembers it in localStorage — so the first
 * paint after a reload is right before the server has answered, and the
 * stored preference only corrects it when the two disagree. Density and
 * motion become data attributes the stylesheet keys off.
 *
 * The theme has two records, the account setting and this browser's latest
 * choice (the `ls-theme` cookie, written on the landing site too). The first
 * answer after mount goes to whichever was chosen later (`decideTheme`); a
 * newer browser choice is saved to the account. After that, every theme
 * change made in the app is saved here, whichever control made it (account
 * menu, right-click menu, command palette), and later server answers (the
 * Settings panel, a reset) are applied as they arrive.
 *
 * The interface language follows the same rule (`decideLocale`): the cookie
 * is what the server renders from, the account setting what follows the
 * person, and whichever was chosen later wins on the first answer; after it,
 * a language picked anywhere in the app is saved here, and a value saved
 * from another browser is applied when it arrives.
 *
 * Renders nothing. Mounted once, in the employer layout.
 */

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { isThemeName, readThemeChoice, type ThemeName } from "@launchstack/design-tokens/theme";

import { readLocaleChoice, useChangeLocale } from "~/i18n/client";
import type { Locale } from "~/i18n/locales";
import { useSettingsPayload, writeSettingValue } from "~/lib/settings/useSettings";

import { decideLocale } from "./localeChoice";
import { decideTheme } from "./themeChoice";

function saveTheme(value: ThemeName): void {
    // Best effort: the choice is already applied, and the cookie remembers
    // it for this browser if the account write fails.
    void writeSettingValue({ key: "appearance.theme", scope: "member", value }).catch(
        () => undefined
    );
}

function saveLocale(value: Locale): void {
    // Best effort, like the theme: the cookie already holds the choice.
    void writeSettingValue({ key: "appearance.language", scope: "member", value }).catch(
        () => undefined
    );
}

export function PreferenceSync() {
    const { payload } = useSettingsPayload();
    const { theme, setTheme } = useTheme();

    const setting = payload?.settings["appearance.theme"];
    const density = payload?.settings["appearance.density"]?.value;
    const motion = payload?.settings["appearance.reducedMotion"]?.value;

    // The theme this component last applied or saved: a change to anything
    // else is the person choosing.
    const known = useRef<string | null>(null);
    const decided = useRef(false);
    const lastAnswer = useRef<string | null>(null);
    const themeNow = useRef(theme);
    themeNow.current = theme;

    const wanted = setting?.value;
    const updatedAt = setting?.updatedAt ?? null;
    useEffect(() => {
        if (!isThemeName(wanted)) return;
        const answer = `${wanted}@${updatedAt ?? ""}`;
        if (lastAnswer.current === answer) return;
        lastAnswer.current = answer;
        let next: ThemeName = wanted;
        if (!decided.current) {
            decided.current = true;
            const decision = decideTheme({ value: wanted, updatedAt }, readThemeChoice());
            if (!decision) return;
            next = decision.theme;
            if (decision.save) saveTheme(next);
        } else if (known.current === wanted) {
            // Our own save coming back.
            return;
        }
        known.current = next;
        if (themeNow.current !== next) setTheme(next);
    }, [wanted, updatedAt, setTheme]);

    // A theme change after the first answer is the person choosing; before
    // it, the cookie (ThemeChoiceSync) carries the change into the decision.
    // The mount run is skipped: with the settings already cached it follows
    // the decision in the same commit, before setTheme has landed.
    const seenTheme = useRef(theme);
    useEffect(() => {
        if (theme === seenTheme.current) return;
        seenTheme.current = theme;
        if (!decided.current || !isThemeName(theme) || theme === known.current) return;
        known.current = theme;
        saveTheme(theme);
    }, [theme]);

    useLocaleSync(payload?.settings["appearance.language"]);

    useEffect(() => {
        const root = document.documentElement;
        if (density === "compact") root.setAttribute("data-density", "compact");
        else root.removeAttribute("data-density");
    }, [density]);

    useEffect(() => {
        const root = document.documentElement;
        if (motion === "reduce") root.setAttribute("data-motion", "reduce");
        else if (motion === "allow") root.setAttribute("data-motion", "allow");
        else root.removeAttribute("data-motion");
    }, [motion]);

    return null;
}

function useLocaleSync(setting: { value: unknown; updatedAt: string | null } | undefined) {
    const { locale, changeLocale } = useChangeLocale();
    // The language this component last applied or saved; any other change of
    // `locale` is the person choosing.
    const known = useRef<Locale | null>(null);
    const decided = useRef(false);
    const lastAnswer = useRef<string | null>(null);
    const localeNow = useRef(locale);
    localeNow.current = locale;

    const wanted = setting?.value;
    const updatedAt = setting?.updatedAt ?? null;
    useEffect(() => {
        if (!setting) return;
        const answer = `${String(wanted)}@${updatedAt ?? ""}`;
        if (lastAnswer.current === answer) return;
        lastAnswer.current = answer;
        const first = !decided.current;
        decided.current = true;
        const decision = decideLocale(
            { value: wanted, updatedAt },
            // After the first answer the cookie is ours; only the account can be news.
            first ? readLocaleChoice() : null,
            localeNow.current
        );
        if (decision.kind === "save") {
            known.current = decision.locale;
            saveLocale(decision.locale);
        } else if (decision.kind === "apply" && decision.locale !== known.current) {
            known.current = decision.locale;
            changeLocale(decision.locale, decision.at);
        } else if (first) {
            known.current = localeNow.current;
        }
    }, [setting, wanted, updatedAt, changeLocale]);

    useEffect(() => {
        if (!decided.current || locale === known.current) return;
        known.current = locale;
        saveLocale(locale);
    }, [locale]);
}
