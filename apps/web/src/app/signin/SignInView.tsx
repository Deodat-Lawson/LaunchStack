"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { rememberActiveSession, useAuth, useUser } from "~/lib/auth-client";
import { isAddAccountMode, withAddAccount } from "~/lib/auth/device-accounts";
import { cn } from "~/lib/utils";
import { AccountLimitNotice, AddAccountNotice } from "~/components/auth/AddAccountNotice";
import { oauthErrorMessage } from "~/components/auth/auth-errors";
import { safeNextPath, withNext } from "~/components/auth/next-path";
import { SignInForm } from "~/app/_components/CredentialsForm";
import { AuthBrandPanel } from "~/app/_components/AuthBrandPanel";
import { AuthChrome } from "~/app/_components/AuthChrome";
import { AuthLegalLinks } from "~/app/_components/AuthLegalLinks";
import { LANDING_HREF } from "~/config/landing";
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
 *   add=1             add another account: a signed-in person gets the form,
 *                     stays signed in as themselves, and lands on /workspaces
 *                     as the new account (~/server/auth/device-sessions)
 */
export function SignInView({
    socialProviders,
    accountLimitReached = false,
}: {
    socialProviders: SocialProvider[];
    /**
     * This browser already holds the most accounts it keeps (from the
     * cookies, on the server). In add mode the form would only replace the
     * active account, so a notice stands in for it.
     */
    accountLimitReached?: boolean;
}) {
    const t = useTranslations("auth.signIn");
    const ta = useTranslations("auth.addAccount");
    const te = useTranslations("auth.errors");
    const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
    const { user } = useUser();
    const searchParams = useSearchParams();
    const nextParam = searchParams.get("next");
    const next = safeNextPath(nextParam, "/");
    const addAccount = isAddAccountMode(searchParams);
    // A new account lands on the picker, where the account menu now lists it.
    const redirectTo = addAccount && next === "/" ? "/workspaces" : next;

    // One-shot messages are read once, then dropped from the address bar so
    // a refresh or a bookmark doesn't replay them.
    // The code, not the sentence: the sentence follows the language if it changes.
    const [oauthError] = useState(() => ({
        code: searchParams.get("error"),
        provider: searchParams.get("provider"),
    }));
    const oauthErrorText = oauthErrorMessage(oauthError.code, oauthError.provider, te);
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
    //
    // An assistant's OAuth request (signed, hence `sig`) that asks for a
    // fresh sign-in lands here with a session already present; it needs the
    // form, not the card.
    //
    // Adding another account is the other deliberate case: the form, plus a
    // note naming the account they stay signed in as. That account's email is
    // read once, on arrival, so the note doesn't flip to the new account while
    // this form's own sign-in is redirecting.
    const reauthForAssistant = searchParams.has("sig");
    const [signedInOnArrival, setSignedInOnArrival] = useState<boolean | null>(null);
    const [keptAccountEmail, setKeptAccountEmail] = useState<string | null>(null);
    useEffect(() => {
        if (isAuthLoaded && signedInOnArrival === null) {
            setSignedInOnArrival(isSignedIn && !reauthForAssistant && !addAccount);
            if (addAccount && isSignedIn) {
                setKeptAccountEmail(user?.email ?? "");
                // Before this form can replace the session: a session from
                // before multi-session must be remembered or it is lost.
                if (!accountLimitReached) void rememberActiveSession();
            }
        }
    }, [
        isAuthLoaded,
        isSignedIn,
        signedInOnArrival,
        reauthForAssistant,
        addAccount,
        user,
        accountLimitReached,
    ]);
    const atAccountLimit = keptAccountEmail !== null && accountLimitReached;

    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col">
            <AuthChrome />
            <div className="flex min-h-0 flex-1 items-stretch">
                <main className="flex min-w-0 flex-1 items-center justify-center px-6 py-12">
                    <div className="w-full max-w-[440px]">
                        <h1 className="display text-ink mb-2 text-[32px] leading-[1.1] tracking-[-0.02em]">
                            {keptAccountEmail !== null ? ta("title") : t("title")}
                        </h1>
                        <p className="text-ink-3 mb-7 text-sm leading-[1.55]">
                            {keptAccountEmail !== null ? ta("subtitle") : t("subtitle")}
                        </p>

                        {oauthErrorText ? (
                            <Notice tone="danger">{oauthErrorText}</Notice>
                        ) : passwordReset ? (
                            <Notice tone="success">{t("passwordUpdated")}</Notice>
                        ) : reauthForAssistant ? (
                            <Notice tone="info">{t("assistantReauth")}</Notice>
                        ) : atAccountLimit ? (
                            <AccountLimitNotice />
                        ) : keptAccountEmail !== null ? (
                            <AddAccountNotice email={keptAccountEmail} />
                        ) : next !== "/" && signedInOnArrival !== true ? (
                            <Notice tone="info">
                                {next.startsWith("/invite/")
                                    ? t("acceptInvitation")
                                    : t("continueToPage")}
                            </Notice>
                        ) : null}

                        {signedInOnArrival ? (
                            <AlreadySignedIn continueHref={next === "/" ? "/workspaces" : next} />
                        ) : atAccountLimit ? null : (
                            <SignInForm
                                redirectTo={redirectTo}
                                socialProviders={socialProviders}
                                initialView={initialView}
                                // A brand-new account from Google or GitHub
                                // registers on /signup like any other.
                                newUserRedirectTo={addAccount ? "/signup" : undefined}
                                signInPath={addAccount ? withAddAccount("/signin") : undefined}
                            />
                        )}

                        {/* At the limit a new account can't join the list either. */}
                        {atAccountLimit ? null : (
                            <div className="text-ink-3 mt-6 text-center text-[12.5px]">
                                {t.rich("newHere", {
                                    link: chunks => (
                                        <Link
                                            href={
                                                addAccount
                                                    ? withAddAccount(withNext("/signup", nextParam))
                                                    : withNext("/signup", nextParam)
                                            }
                                            className="text-brand font-semibold no-underline hover:underline"
                                        >
                                            {chunks}
                                        </Link>
                                    ),
                                })}
                            </div>
                        )}
                        <AuthLegalLinks className="mt-4" />
                    </div>
                </main>
                {/*
                  grid, not `hidden min-[961px]:flex`: UploadThing's stylesheet
                  loads after ours and redeclares .hidden, which would win.
                */}
                <div className="grid w-[46%] max-[960px]:hidden">
                    <AuthBrandPanel
                        headline={t("brandHeadline")}
                        description={t("brandDescription")}
                    />
                </div>
            </div>
        </div>
    );
}

const NOTICE_TONES = {
    info: { Icon: Info, icon: "text-info-ink", box: "bg-info-soft border-info/25" },
    success: {
        Icon: CheckCircle2,
        icon: "text-success-ink",
        box: "bg-success-soft border-success/25",
    },
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
    const t = useTranslations("auth.signIn.alreadySignedIn");
    const tc = useTranslations("common.actions");
    const { signOut } = useAuth();
    return (
        <div className="border-line flex flex-col items-start gap-3.5 rounded-xl border px-6 py-7">
            <div className="text-ink text-sm font-semibold">{t("title")}</div>
            <p className="text-ink-3 m-0 text-[13px] leading-[1.55]">{t("body")}</p>
            <div className="flex flex-wrap gap-2.5">
                <Button asChild>
                    <Link href={continueHref}>{tc("continue")}</Link>
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void signOut({ redirectUrl: LANDING_HREF })}
                >
                    {tc("signOut")}
                </Button>
            </div>
        </div>
    );
}
