"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useAuth } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { oauthErrorMessage } from "~/components/auth/auth-errors";
import { safeNextPath, withNext } from "~/components/auth/next-path";
import { SignInForm } from "~/app/_components/CredentialsForm";
import { AuthBrandPanel } from "~/app/_components/AuthBrandPanel";
import { AuthChrome } from "~/app/_components/AuthChrome";
import { LANDING_URL } from "~/config/landing";
import type { SocialProvider } from "~/server/auth/providers";

/**
 * Sign-in page.
 *
 * Launchstack design (OKLCH tokens, Inter + JetBrains Mono, accent-purple).
 * The credentials form talks to our own better-auth endpoints; everything
 * around it is a thin branded shell that tells solo founders / devs /
 * students what they're signing into. No enterprise "50+ companies" pitch.
 *
 * Query parameters it understands:
 *   next=/path        where to land afterwards (same-origin paths only)
 *   error=<code>      a failed social sign-in, from better-auth's callback
 *   provider=<id>     which provider that was, for the error sentence
 *   notice=password-reset   arriving from a completed password reset
 *   view=forgot       open on the reset-link form (from an expired link)
 */
export function SignInView({ socialProviders }: { socialProviders: SocialProvider[] }) {
    const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
    const searchParams = useSearchParams();
    const nextParam = searchParams.get("next");
    const next = safeNextPath(nextParam, "/");

    // One-shot messages are read once, then dropped from the address bar so
    // a refresh or a bookmark doesn't replay them.
    const [oauthError] = useState(() =>
        oauthErrorMessage(searchParams.get("error"), searchParams.get("provider"))
    );
    const [passwordReset] = useState(() => searchParams.get("notice") === "password-reset");
    const [initialView] = useState(() =>
        searchParams.get("view") === "forgot" ? ("forgot" as const) : ("signin" as const)
    );
    useEffect(() => {
        const url = new URL(window.location.href);
        const oneShot = ["error", "error_description", "provider", "notice", "view"];
        if (!oneShot.some(key => url.searchParams.has(key))) return;
        for (const key of oneShot) url.searchParams.delete(key);
        window.history.replaceState(window.history.state, "", url);
    }, []);

    // Only a session that was already here when the page loaded means "you're
    // already signed in". One that appears because this form just succeeded is
    // mid-redirect, and flashing the cycle-breaker card at it would confuse.
    const [signedInOnArrival, setSignedInOnArrival] = useState<boolean | null>(null);
    useEffect(() => {
        if (isAuthLoaded && signedInOnArrival === null) setSignedInOnArrival(isSignedIn);
    }, [isAuthLoaded, isSignedIn, signedInOnArrival]);

    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col">
            <AuthChrome />
            <div className="flex min-h-0 flex-1 items-stretch">
                <main className="flex min-w-0 flex-1 items-center justify-center px-6 py-12">
                    <div className="w-full max-w-[440px]">
                        <div className="text-ink-3 mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                            Welcome back
                        </div>
                        <h1 className="display text-ink mb-2 text-[32px] leading-[1.1] tracking-[-0.02em]">
                            Sign in to your workspace.
                        </h1>
                        <p className="text-ink-3 mb-7 text-sm leading-[1.55]">
                            Your sources, threads, and answers — right where you left them.
                        </p>

                        {oauthError ? (
                            <Notice tone="danger">{oauthError}</Notice>
                        ) : passwordReset ? (
                            <Notice tone="success">
                                Password updated. Sign in with your new password.
                            </Notice>
                        ) : next !== "/" && signedInOnArrival !== true ? (
                            <Notice tone="info">
                                {next.startsWith("/invite/")
                                    ? "Sign in to accept your invitation."
                                    : "Sign in to continue — you'll go straight back to the page you opened."}
                            </Notice>
                        ) : null}

                        {signedInOnArrival ? (
                            <AlreadySignedIn continueHref={next === "/" ? "/workspaces" : next} />
                        ) : (
                            <SignInForm
                                redirectTo={next}
                                socialProviders={socialProviders}
                                initialView={initialView}
                            />
                        )}

                        <div className="text-ink-3 mt-6 text-center text-[12.5px]">
                            New to Launchstack?{" "}
                            <Link
                                href={withNext("/signup", nextParam)}
                                className="text-brand font-semibold no-underline hover:underline"
                            >
                                Start a free workspace →
                            </Link>
                        </div>
                    </div>
                </main>
                {/*
                  grid, not `hidden min-[961px]:flex`: UploadThing's stylesheet
                  loads after ours and redeclares .hidden, which would win.
                */}
                <div className="grid w-[46%] max-[960px]:hidden">
                    <AuthBrandPanel
                        tagline="Built for solo builders"
                        headline="Your second brain, grounded in sources you trust."
                        description="Drop in your docs, notes, transcripts, and repos. Ask anything. Every answer cites the exact passage."
                    />
                </div>
            </div>
        </div>
    );
}

const NOTICE_TONES = {
    info: { Icon: Info, icon: "text-info", box: "bg-info-soft border-info/25" },
    success: { Icon: CheckCircle2, icon: "text-success", box: "bg-success-soft border-success/25" },
    danger: { Icon: AlertCircle, icon: "text-danger", box: "bg-danger-soft border-danger/25" },
} as const;

function Notice({
    tone,
    children,
}: {
    tone: keyof typeof NOTICE_TONES;
    children: React.ReactNode;
}) {
    const { Icon, icon, box } = NOTICE_TONES[tone];
    return (
        <div
            role={tone === "danger" ? "alert" : "status"}
            className={cn(
                "text-ink-2 mb-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] leading-normal",
                box
            )}
        >
            <Icon className={cn("mt-px size-4 shrink-0", icon)} aria-hidden />
            <div>{children}</div>
        </div>
    );
}

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
function AlreadySignedIn({ continueHref }: { continueHref: string }) {
    const { signOut } = useAuth();
    return (
        <div className="border-line flex flex-col items-start gap-3.5 rounded-xl border px-6 py-7">
            <div className="text-ink text-sm font-semibold">You&rsquo;re already signed in.</div>
            <p className="text-ink-3 m-0 text-[13px] leading-[1.55]">
                We couldn&rsquo;t work out which workspace to open for you. Continue to pick one, or
                sign out and start again.
            </p>
            <div className="flex flex-wrap gap-2.5">
                <Button asChild>
                    <Link href={continueHref}>Continue</Link>
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void signOut({ redirectUrl: LANDING_URL })}
                >
                    Sign out
                </Button>
            </div>
        </div>
    );
}
