"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { isThemeName, writeThemeChoice } from "@launchstack/design-tokens/theme";

/**
 * Records every theme change as this browser's latest choice, in the cookie
 * the app reads too, so a theme picked here is the one the landing site opens in.
 * The theme the page loaded with is not a choice and is not written.
 */
export function ThemeChoiceSync() {
    const { theme } = useTheme();
    const last = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (!theme) return;
        const previous = last.current;
        last.current = theme;
        if (previous !== undefined && previous !== theme && isThemeName(theme)) {
            writeThemeChoice(theme);
        }
    }, [theme]);

    return null;
}
