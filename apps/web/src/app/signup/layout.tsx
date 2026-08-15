import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Get Started with Launchstack — Free",
    description:
        "Your second brain for docs, notes, and code. Set up your personal Launchstack workspace in under a minute — built for solo founders, developers, and students.",
    alternates: {
        canonical: "/signup",
    },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="lsw-root"
            style={{
                minHeight: "100vh",
                width: "100%",
            }}
        >
            {children}
        </div>
    );
}
