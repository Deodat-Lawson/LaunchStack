/**
 * The concrete font stack behind a type token, for renderers that cannot
 * take a CSS `var()`: canvas `ctx.font`, mermaid's theme config.
 *
 * next/font serves Inter and JetBrains Mono under hashed family names, so
 * a literal "Inter" in such a renderer silently falls back to a system
 * face. Reading the token's computed value yields the real names
 * (`'__Inter_…', '__Inter_Fallback_…', ui-sans-serif, …`).
 */
export type FontRole = "sans" | "serif" | "mono";

const FALLBACK: Record<FontRole, string> = {
    sans: "ui-sans-serif, system-ui, sans-serif",
    serif: "ui-serif, Georgia, serif",
    mono: "ui-monospace, monospace",
};

const resolved: Partial<Record<FontRole, string>> = {};

export function resolveFontStack(role: FontRole): string {
    const hit = resolved[role];
    if (hit) return hit;
    if (typeof document === "undefined") return FALLBACK[role];
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(`--font-${role}`)
        .trim();
    if (!value) return FALLBACK[role];
    resolved[role] = value;
    return value;
}
