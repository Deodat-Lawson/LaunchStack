import "@launchstack/design-tokens/tokens.css";
import "~/styles/globals.css";
import { THEME_BOOT_SCRIPT } from "@launchstack/design-tokens/theme";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { CloudAnalytics } from "./_components/CloudAnalytics";
import { ContextMenuProvider } from "~/components/context-menu";
import { ThemeChoiceSync } from "~/components/theme/ThemeChoiceSync";
import { configuredPublicOrigin } from "~/server/public-origin";
import { TimeZoneSync } from "~/i18n/TimeZoneSync";

import { type Metadata } from "next";
import { inter, jetbrainsMono } from "./fonts";

// The marketing metadata that used to live here — keywords, OG card, Twitter
// card, canonical, index:true — moved to apps/landing with the public site.
// What is left is what a private application needs.
//
// BETTER_AUTH_URL is the origin browsers reach this instance at (see
// server/public-origin.ts). When nothing is set, metadataBase is omitted
// rather than defaulted: asserting launchstack.app as a self-hosted
// instance's canonical origin is a lie, and Next resolves relative URLs fine
// without it.
const APP_URL = configuredPublicOrigin() ?? process.env.NEXT_PUBLIC_SITE_URL;

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("common.meta");
    return {
        title: {
            default: "Launchstack",
            template: "%s | Launchstack",
        },
        description: t("description"),
        ...(APP_URL ? { metadataBase: new URL(APP_URL) } : {}),
        // Every route on this origin is behind auth, and / redirects to /signin.
        robots: {
            index: false,
            follow: false,
        },
        // Both files are the Launchstack mark. The SVG is listed first so browsers
        // that support it render the logo crisply at any density; favicon.ico is the
        // multi-resolution raster fallback (see public/icon.svg for how it's built).
        icons: [
            { rel: "icon", url: "/icon.svg", type: "image/svg+xml" },
            { rel: "icon", url: "/favicon.ico", sizes: "any" },
        ],
    };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    // The interface language: the browser's choice, else its languages (src/i18n).
    const locale = await getLocale();
    return (
        <html
            lang={locale}
            className={`${inter.variable} ${jetbrainsMono.variable}`}
            suppressHydrationWarning
        >
            <head>
                {/* A theme picked on the landing site shows here too: see design-tokens/theme.ts. */}
                <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
            </head>
            <body suppressHydrationWarning>
                <NextIntlClientProvider>
                    <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem>
                        <ThemeChoiceSync />
                        <TimeZoneSync />
                        <ContextMenuProvider>{children}</ContextMenuProvider>
                        <CloudAnalytics />
                    </ThemeProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
