"use client";

import { useEffect, useState } from "react";

import type { ThemeMode } from "../model/palette";

/**
 * The app's current light/dark setting, read from the `data-theme` attribute
 * next-themes stamps on `<html>`.
 *
 * Starts at "light" and corrects on mount rather than reading during render:
 * the attribute does not exist on the server, and branching on it during the
 * first client render is a hydration mismatch. Watching for changes keeps
 * previews honest when someone flips the app theme with the editor open.
 */
export function useAppThemeMode(): ThemeMode {
    const [mode, setMode] = useState<ThemeMode>("light");

    useEffect(() => {
        const read = () =>
            setMode(
                document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
            );
        read();
        const observer = new MutationObserver(read);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, []);

    return mode;
}
