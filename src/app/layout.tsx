import "~/styles/globals.css";
import "@uploadthing/react/styles.css";
import { Analytics } from '@vercel/analytics/next';
import { ThemeProvider } from "next-themes";

import { GeistSans } from "geist/font/sans";
import { type Metadata } from "next";
import {
  ClerkProvider,
} from '@clerk/nextjs'


const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pdr-ai.com';

export const metadata: Metadata = {
  title: {
    default: 'PDR AI — AI-Powered Document Analysis Platform',
    template: '%s | PDR AI',
  },
  description: 'Upload documents, get AI-powered analysis, predictive gap detection, and intelligent Q&A — all open source and self-deployable.',
  keywords: [
    'document analysis', 'AI', 'RAG', 'predictive analysis', 'document Q&A',
    'contract analysis', 'compliance', 'open source', 'startup tools',
  ],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'PDR AI',
    title: 'PDR AI — AI-Powered Document Analysis Platform',
    description: 'Upload documents, get AI-powered analysis, predictive gap detection, and intelligent Q&A — all open source and self-deployable.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'PDR AI Platform' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PDR AI — AI-Powered Document Analysis Platform',
    description: 'Upload documents, get AI-powered analysis, predictive gap detection, and intelligent Q&A.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: [{ rel: "icon", url: "favicon.ico" }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${GeistSans.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
      <ThemeProvider attribute={["class", "data-theme"]} defaultTheme="dark" enableSystem>
        {children}
        <Analytics />
      </ThemeProvider>
      </body>
      </html>
    </ClerkProvider>

  );
}
