"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ className }: { className?: string }) {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const isDark = resolvedTheme === "dark";
    return (
        <button
            type="button"
            className={className}
            disabled={!mounted}
            aria-label={
                mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Switch color theme"
            }
            onClick={() => setTheme(isDark ? "light" : "dark")}
        >
            {mounted && isDark ? (
                <Sun size={17} aria-hidden="true" />
            ) : (
                <Moon size={17} aria-hidden="true" />
            )}
        </button>
    );
}
