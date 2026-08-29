"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useAuth } from "~/lib/auth-client";
import { SignInForm } from "~/app/_components/CredentialsForm";
import { AuthBrandPanel } from "~/app/_components/AuthBrandPanel";
import { AuthChrome } from "~/app/_components/AuthChrome";
import { LANDING_URL } from "~/config/landing";

/**
 * Sign-in page.
 *
 * Launchstack design (OKLCH tokens, Inter + Instrument Serif, accent-purple).
 * The credentials form talks to our own better-auth endpoints; everything
 * around it is a thin branded shell that tells solo founders / devs /
 * students what they're signing into. No enterprise "50+ companies" pitch.
 */
const SigninPage: React.FC = () => {
    const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();

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
                        ) : isSignedIn ? (
                            <AlreadySignedIn />
                        ) : (
                            <SignInForm />
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

/**
 * Rendered when the client sees an active session on the sign-in page.
 *
 * This is the cycle breaker, not a cosmetic nicety. `/` redirects here for
 * anonymous visitors, and a successful sign-in hands the user straight back
 * to "/" — so bouncing an already-signed-in user between the two closes a
 * loop that the browser will spin on forever. It fires in two real cases:
 *
 *   1. The middleware's role lookup threw (database down) and it failed open,
 *      so it never fanned the user out to their dashboard.
 *   2. Server and client disagree about the session — a secret mismatch
 *      between deployments, a cookie in flight, or clock skew.
 *
 * Both are degraded states, so this offers manual versions of the two things
 * the app would otherwise have done automatically.
 */
function AlreadySignedIn() {
    const { signOut } = useAuth();
    return (
        <div
            style={{
                padding: "28px 24px",
                border: "1px solid var(--line)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                alignItems: "flex-start",
            }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                You&rsquo;re already signed in.
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55, margin: 0 }}>
                We couldn&rsquo;t work out which workspace to open for you. Continue to pick one, or
                sign out and start again.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                    href="/workspaces"
                    style={{
                        background: "var(--accent)",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 13,
                        padding: "9px 16px",
                        borderRadius: 8,
                        textDecoration: "none",
                    }}
                >
                    Continue
                </Link>
                <button
                    type="button"
                    onClick={() => void signOut({ redirectUrl: LANDING_URL })}
                    style={{
                        background: "transparent",
                        color: "var(--ink-3)",
                        fontWeight: 600,
                        fontSize: 13,
                        padding: "9px 16px",
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        cursor: "pointer",
                    }}
                >
                    Sign out
                </button>
            </div>
        </div>
    );
}

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
