import "@launchstack/design-tokens/tokens.css";
import "~/styles/tailwind.css";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "next-themes";
import { type Metadata } from "next";

import { inter, instrumentSerif, jetbrainsMono } from "./fonts";
import { SITE_URL } from "~/config/site";

export const metadata: Metadata = {
    title: {
        default: "Launchstack — The Open-Source Launch Stack for Tech Founders",
        template: "%s | Launchstack",
    },
    description:
        "Launchstack is a free, open-source AI platform that helps tech founders analyze documents, detect compliance gaps, manage teams, and grow their product. Self-host with your own API keys.",
    keywords: [
        "open source startup tools",
        "free tools for tech founders",
        "startup launch stack",
        "document analysis AI",
        "RAG",
        "predictive analysis",
        "document Q&A",
        "contract analysis",
        "compliance",
        "open source",
        "self-hosted AI platform",
        "founder tools",
        "startup growth",
        "free AI tools",
    ],
    metadataBase: new URL(SITE_URL),
    alternates: {
        canonical: "/",
    },
    openGraph: {
        type: "website",
        locale: "en_US",
        url: SITE_URL,
        siteName: "Launchstack",
        title: "Launchstack — The Open-Source Launch Stack for Tech Founders",
        description:
            "Launchstack is a free, open-source AI platform that helps tech founders analyze documents, detect compliance gaps, manage teams, and grow their product. Self-host with your own API keys.",
        // No explicit `images` here: the file-convention app/opengraph-image.tsx
        // renders the 1200x630 card. The previous hardcoded '/og-image.png' pointed
        // at a file that has never existed in public/.
    },
    twitter: {
        card: "summary_large_image",
        title: "Launchstack — The Open-Source Launch Stack for Tech Founders",
        description:
            "Free, open-source AI platform for document analysis, compliance gap detection, team management, and startup growth. Self-host with your own API keys.",
    },
    robots: {
        index: true,
        follow: true,
    },
    icons: [{ rel: "icon", url: "favicon.ico" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html
            lang="en"
            className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
            suppressHydrationWarning
        >
            <body suppressHydrationWarning>
                {/*
          attribute={["class", "data-theme"]} is load-bearing: marketing.module.css
          and deployment.module.css each key their dark variants off BOTH
          `:global(.dark) .root` and `:global([data-theme="dark"]) .root`.
          A single-attribute provider half-breaks dark mode on this origin.
        */}
                <ThemeProvider attribute={["class", "data-theme"]} defaultTheme="dark" enableSystem>
                    {children}
                    <Analytics />
                </ThemeProvider>
            </body>
        </html>
    );
}
