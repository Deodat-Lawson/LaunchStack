import type { Metadata } from 'next';
import { inter, instrumentSerif, jetbrainsMono } from "~/app/employer/fonts";

export const metadata: Metadata = {
    title: 'Sign In',
    description: 'Sign in to Launchstack — your second brain for docs, notes, and conversations.',
    alternates: {
        canonical: '/signin',
    },
};

export default function SigninLayout({ children }: { children: React.ReactNode }) {
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
