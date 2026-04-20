import "~/styles/globals.css";
import "@uploadthing/react/styles.css";
import { Analytics } from '@vercel/analytics/next';
import { ThemeProvider } from "next-themes";

import { GeistSans } from "geist/font/sans";
import { type Metadata } from "next";
import {
  ClerkProvider,
} from '@clerk/nextjs'


const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://launchstack.app';

export const metadata: Metadata = {
  title: {
    default: 'Launchstack — The Open-Source Launch Stack for Tech Founders',
    template: '%s | Launchstack',
  },
  description: 'Launchstack is a free, open-source AI platform that helps tech founders analyze documents, detect compliance gaps, manage teams, and grow their product. Self-host with your own API keys.',
  keywords: [
    'open source startup tools', 'free tools for tech founders', 'startup launch stack',
    'document analysis AI', 'RAG', 'predictive analysis', 'document Q&A',
    'contract analysis', 'compliance', 'open source', 'self-hosted AI platform',
    'founder tools', 'startup growth', 'free AI tools',
  ],
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Launchstack',
    title: 'Launchstack — The Open-Source Launch Stack for Tech Founders',
    description: 'Launchstack is a free, open-source AI platform that helps tech founders analyze documents, detect compliance gaps, manage teams, and grow their product. Self-host with your own API keys.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Launchstack — Open-Source AI Platform for Tech Founders' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Launchstack — The Open-Source Launch Stack for Tech Founders',
    description: 'Free, open-source AI platform for document analysis, compliance gap detection, team management, and startup growth. Self-host with your own API keys.',
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
