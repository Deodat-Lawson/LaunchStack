"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

export function ThemeToggle() {
    const t = useTranslations("auth.chrome");
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <button className="theme-toggle-btn" aria-label={t("toggleTheme")} disabled>
                <Sun className="h-5 w-5 opacity-0" />
            </button>
        );
    }

    // resolvedTheme, not theme: under "system" the theme is neither, and a
    // click that sets the colour already showing looks like it did nothing.
    const isDark = resolvedTheme === "dark";
    const toggleTheme = () => {
        setTheme(isDark ? "light" : "dark");
    };

    return (
        <button onClick={toggleTheme} className="theme-toggle-btn" aria-label={t("toggleTheme")}>
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
    );
}
