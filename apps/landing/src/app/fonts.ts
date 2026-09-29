import { Inter, JetBrains_Mono } from "next/font/google";

// The product's two typefaces, loaded once per app. apps/web and
// apps/landing keep byte-identical copies of this file (enforced by
// __tests__/brand/typography.test.ts) because next/font must be called
// from app code. Components never use these variables directly — they use
// var(--font-sans) / var(--font-mono) from @launchstack/design-tokens.

// Inter 4, variable: one file covers every weight, and the opsz axis gives
// headings the Display cut automatically (font-optical-sizing: auto).
// next/font only accepts `axes` without a fixed weight list.
export const inter = Inter({
    subsets: ["latin"],
    axes: ["opsz"],
    display: "swap",
    variable: "--font-inter",
});

export const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    weight: ["400", "500"],
    display: "swap",
    variable: "--font-jetbrains-mono",
});
