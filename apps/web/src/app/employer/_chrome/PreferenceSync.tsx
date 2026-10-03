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
 * Renders nothing. Mounted once, in the employer layout.
 */

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { isThemeName, readThemeChoice, type ThemeName } from "@launchstack/design-tokens/theme";

import { useSettingsPayload, writeSettingValue } from "~/lib/settings/useSettings";

import { decideTheme } from "./themeChoice";

function saveTheme(value: ThemeName): void {
    // Best effort: the choice is already applied, and the cookie remembers
    // it for this browser if the account write fails.
    void writeSettingValue({ key: "appearance.theme", scope: "member", value }).catch(
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
