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
 * Renders nothing. Mounted once, in the employer layout.
 */

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { useSettingsPayload } from "~/lib/settings/useSettings";

export function PreferenceSync() {
    const { payload } = useSettingsPayload();
    const { theme, setTheme } = useTheme();
    const appliedTheme = useRef<string | null>(null);

    const wantedTheme = payload?.settings["appearance.theme"]?.value;
    const density = payload?.settings["appearance.density"]?.value;
    const motion = payload?.settings["appearance.reducedMotion"]?.value;

    useEffect(() => {
        if (typeof wantedTheme !== "string") return;
        // Apply a stored preference once per value; a local toggle afterwards
        // must not be fought by a stale server answer.
        if (appliedTheme.current === wantedTheme) return;
        appliedTheme.current = wantedTheme;
        if (theme !== wantedTheme) setTheme(wantedTheme);
    }, [wantedTheme, theme, setTheme]);

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
