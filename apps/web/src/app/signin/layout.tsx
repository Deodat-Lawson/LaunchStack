import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Sign In",
    description: "Sign in to Launchstack — your second brain for docs, notes, and conversations.",
    alternates: {
        canonical: "/signin",
    },
};

export default function SigninLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {children}
        </div>
    );
}
