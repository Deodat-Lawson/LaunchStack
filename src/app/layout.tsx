import "~/styles/globals.css";
import "@uploadthing/react/styles.css";
import { Analytics } from '@vercel/analytics/next';
import { ThemeProvider } from "next-themes";

import { GeistSans } from "geist/font/sans";
import { type Metadata } from "next";
import {
  ClerkProvider,
} from '@clerk/nextjs'


export const metadata: Metadata = {
  title: "PDR AI",
  description: "PDR AI",
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
