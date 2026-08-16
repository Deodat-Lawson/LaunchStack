import "@launchstack/design-tokens/tokens.css";
import "~/styles/globals.css";
// compat.css must stay after globals.css: its purple/slate remap beats
// Tailwind's utilities by source order.
import "~/styles/compat.css";
import "@uploadthing/react/styles.css";
import { ThemeProvider } from "next-themes";
import { CloudAnalytics } from "./_components/CloudAnalytics";

import { type Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { inter, interTight, instrumentSerif, jetbrainsMono } from "./fonts";

// The marketing metadata that used to live here — keywords, OG card, Twitter
// card, canonical, index:true — moved to apps/landing with the public site.
// What is left is what a private application needs.
//
// APP_PUBLIC_URL is the existing variable for "the origin this instance is
// served from" (see env.ts; it also feeds CoreConfig.ocr.appPublicUrl). When
// nothing is set, metadataBase is omitted rather than defaulted: asserting
// launchstack.app as a self-hosted instance's canonical origin is a lie, and
// Next resolves relative URLs fine without it.
const APP_URL = process.env.APP_PUBLIC_URL ?? process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
    title: {
        default: "Launchstack",
        template: "%s | Launchstack",
    },
    description: "Cited answers from your company documents.",
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <ClerkProvider>
            <html
                lang="en"
                className={`${inter.variable} ${interTight.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
                suppressHydrationWarning
            >
                <body suppressHydrationWarning>
                    <ThemeProvider
                        attribute={["class", "data-theme"]}
                        defaultTheme="dark"
                        enableSystem
                    >
                        {children}
                        <CloudAnalytics />
                    </ThemeProvider>
                </body>
            </html>
        </ClerkProvider>
    );
}
