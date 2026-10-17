"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <button className="theme-toggle-btn" aria-label="Toggle theme" disabled>
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
        <button onClick={toggleTheme} className="theme-toggle-btn" aria-label="Toggle theme">
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
    );
}
