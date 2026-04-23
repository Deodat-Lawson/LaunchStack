"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useAuth, SignIn } from "@clerk/nextjs";
import { AuthBrandPanel } from "~/app/_components/AuthBrandPanel";
import { AuthChrome } from "~/app/_components/AuthChrome";

/**
 * Sign-in page.
 *
 * Launchstack design (OKLCH tokens, Inter + Instrument Serif, accent-purple).
 * Uses Clerk's <SignIn> embedded component; everything around it is a thin
 * branded shell that tells solo founders / devs / students what they're
 * signing into. No enterprise "50+ companies" pitch.
 */
const SigninPage: React.FC = () => {
    const { isLoaded: isAuthLoaded } = useAuth();

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                flexDirection: "column",
                background: "var(--bg)",
                color: "var(--ink)",
            }}
        >
            <AuthChrome />
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "stretch",
                    minHeight: 0,
                }}
            >
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "48px 24px",
                    }}
                >
                    <div style={{ width: "100%", maxWidth: 440 }}>
                        <div
                            className="mono"
                            style={{
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.12em",
                                color: "var(--ink-3)",
                                textTransform: "uppercase",
                                marginBottom: 10,
                            }}
                        >
                            Welcome back
                        </div>
                        <h1
                            className="serif"
                            style={{
                                fontSize: 32,
                                lineHeight: 1.1,
                                letterSpacing: "-0.02em",
                                color: "var(--ink)",
                                margin: "0 0 8px",
                            }}
                        >
                            Sign in to your workspace.
                        </h1>
                        <p
                            style={{
                                fontSize: 14,
                                color: "var(--ink-3)",
                                lineHeight: 1.55,
                                margin: 0,
                                marginBottom: 28,
                            }}
                        >
                            Your sources, threads, and answers — right where you left them.
                        </p>

                        {!isAuthLoaded ? (
                            <LoadingState />
                        ) : (
                            <SignIn
                                routing="hash"
                                forceRedirectUrl="/"
                                signUpUrl="/signup"
                            />
                        )}

                        <div
                            style={{
                                marginTop: 24,
                                fontSize: 12.5,
                                color: "var(--ink-3)",
                                textAlign: "center",
                            }}
                        >
                            New to Launchstack?{" "}
                            <Link
                                href="/signup"
                                style={{
                                    color: "var(--accent)",
                                    fontWeight: 600,
                                    textDecoration: "none",
                                }}
                            >
                                Start a free workspace →
                            </Link>
                        </div>
                    </div>
                </div>
                <div style={{ width: "46%", display: "flex" }} className="auth-brand-col">
                    <AuthBrandPanel
                        tagline="Built for solo builders"
                        headline="Your second brain, grounded in sources you trust."
                        description="Drop in your docs, notes, transcripts, and repos. Ask anything. Every answer cites the exact passage."
                    />
                </div>
            </div>
            <style>{`
                @media (max-width: 960px) {
                    .auth-brand-col { display: none !important; }
                }
            `}</style>
        </div>
    );
};

function LoadingState() {
    return (
        <div
            style={{
                padding: "48px 0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                color: "var(--ink-3)",
                fontSize: 13,
            }}
        >
            <div
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "2px solid var(--line)",
                    borderTopColor: "var(--accent)",
                    animation: "lsw-spin 700ms linear infinite",
                }}
            />
            Loading…
        </div>
    );
}

export default function SigninPageWrapper() {
    return (
        <Suspense>
            <SigninPage />
        </Suspense>
    );
}
