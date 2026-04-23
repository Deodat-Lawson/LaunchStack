import type { Metadata } from 'next';
import { inter, instrumentSerif, jetbrainsMono } from "~/app/employer/fonts";

export const metadata: Metadata = {
    title: 'Get Started with Launchstack — Free',
    description: 'Your second brain for docs, notes, and code. Set up your personal Launchstack workspace in under a minute — built for solo founders, developers, and students.',
    alternates: {
        canonical: '/signup',
    },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            className={`lsw-root ${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}
            style={{
                fontFamily: `var(--font-inter), system-ui, sans-serif`,
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {children}
        </div>
    );
}
