"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { LanguageToggle } from "~/components/i18n/LanguageMenu";
import { useAuth, useUser } from "~/lib/auth-client";
import { UserMenu } from "~/components/UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { LaunchstackMark } from "./LaunchstackLogo";
import { LogoLink } from "~/components/LogoLink";
import { LANDING_HREF } from "~/config/landing";

/**
 * Top bar used on /signin and /signup.
 *
 * Mirrors the Launchstack brand treatment in EmployerChrome — dark square with
 * an accent bolt — rather than the legacy purple lucide Brain logo, so the
 * entry-point design is consistent with the product.
 */
export function AuthChrome() {
    const t = useTranslations("auth.chrome");
    const { isLoaded, isSignedIn } = useAuth();
    const { user } = useUser();

    return (
        <nav
            style={{
                background: "var(--panel)",
                borderBottom: "1px solid var(--line)",
                padding: "12px 24px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                position: "sticky",
                top: 0,
                zIndex: 40,
            }}
        >
            {/*
              A logged-out visitor clicking the brand from a sign-in screen
              wants the public site, not a redirect straight back to where they
              already are. Someone signed in (the OAuth connect screens, an
              invite link, /signin's already-signed-in state) goes home. Until
              the session has loaded, the visitor counts as logged out.
            */}
            <LogoLink signedIn={isLoaded && isSignedIn} className="flex items-center gap-[9px]">
                <LaunchstackMark size={26} title="Launchstack" />
                <span className="text-sm font-bold tracking-[-0.01em]">Launchstack</span>
            </LogoLink>
            <div style={{ flex: 1 }} />
            <LanguageToggle />
            <ThemeToggle />
            {isLoaded && isSignedIn && user && (
                <>
                    {/* The avatar menu carries the account on a phone; the address
                        would push it off-screen (the OAuth connect screens are
                        reached signed in, unlike /signin). */}
                    <span className="text-ink-3 ml-1 min-w-0 truncate text-xs max-sm:hidden">
                        {user.email || t("signedIn")}
                    </span>
                    {/* A just-signed-out user is a public-site audience. */}
                    <UserMenu afterSignOutUrl={LANDING_HREF} />
                </>
            )}
        </nav>
    );
}
