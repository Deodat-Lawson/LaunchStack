"use client";

import Link from "next/link";
import React from "react";
import { useAuth, useUser, UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "./ThemeToggle";
import { LaunchstackMark } from "./LaunchstackLogo";

/**
 * Top bar used on /signin and /signup.
 *
 * Mirrors the Launchstack brand treatment in EmployerChrome — dark square with
 * an accent bolt — rather than the legacy purple lucide Brain logo, so the
 * entry-point design is consistent with the product.
 */
export function AuthChrome() {
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
            <Link
                href="/"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    textDecoration: "none",
                    color: "inherit",
                }}
            >
                <LaunchstackMark size={26} title="Launchstack" />
                <span
                    style={{
                        fontSize: 14,
                        fontWeight: 700,
                        letterSpacing: "-0.01em",
                    }}
                >
                    Launchstack
                </span>
            </Link>
            <div style={{ flex: 1 }} />
            <ThemeToggle />
            {isLoaded && isSignedIn && user && (
                <>
                    <span
                        style={{
                            fontSize: 12,
                            color: "var(--ink-3)",
                            marginLeft: 4,
                        }}
                    >
                        {user.primaryEmailAddress?.emailAddress ?? user.fullName ?? "Signed in"}
                    </span>
                    <UserButton
                        afterSignOutUrl="/"
                        appearance={{ elements: { avatarBox: "w-8 h-8" } }}
                    />
                </>
            )}
        </nav>
    );
}
