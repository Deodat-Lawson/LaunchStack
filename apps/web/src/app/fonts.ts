import localFont from "next/font/local";

// The product's two typefaces, loaded once per app. apps/web and
// apps/landing keep byte-identical copies of this file (enforced by
// __tests__/brand/typography.test.ts) because next/font must be called
// from app code. Components never use these variables directly — they use
// var(--font-sans) / var(--font-mono) from @launchstack/design-tokens.
//
// The files are self-hosted from packages/design-tokens/fonts (provenance and
// rebuild steps in its README), not next/font/google: Google Fonts sometimes
// answers with extensionless `l/font?kit=…&skey=…` URLs that Next 15.5's
// font loader rejects (vercel/next.js#99114) — a 500 on every route under
// `next dev --turbo`, a failed `next build` under webpack. A build that
// never calls Google can't be broken by it.

// Inter 4, variable: one file covers every weight, and the opsz axis gives
// headings the Display cut automatically (font-optical-sizing: auto).
export const inter = localFont({
    src: "../../../../packages/design-tokens/fonts/Inter.woff2",
    weight: "100 900",
    display: "swap",
    variable: "--font-inter",
});

export const jetbrainsMono = localFont({
    src: "../../../../packages/design-tokens/fonts/JetBrainsMono.woff2",
    weight: "400 500",
    display: "swap",
    variable: "--font-jetbrains-mono",
});
