"use client";

/**
 * The one-time explanation after a Google or GitHub sign-in took over an
 * account whose email address had never been confirmed
 * (~/server/auth/account-linking). The server leaves a short-lived cookie on
 * that sign-in; this reads it once, clears it, and says what changed, so a
 * reload or a later visit never shows it again. The cookie lasts a day, so a
 * sign-in that lands outside these layouts first (onboarding starts on
 * /signup) still gets the note on the first page that has one.
 *
 * Mounted wherever a sign-in can land: the employer layout and /workspaces.
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import {
    parseTakeoverNotice,
    TAKEOVER_NOTICE_COOKIE,
    type TakeoverNotice,
} from "~/lib/auth/takeover-notice";

/** Reads the note and deletes it in the same step, so it shows exactly once. */
function takeNotice(): TakeoverNotice | null {
    const prefix = `${TAKEOVER_NOTICE_COOKIE}=`;
    const raw = document.cookie
        .split("; ")
        .find(part => part.startsWith(prefix))
        ?.slice(prefix.length);
    if (raw === undefined) return null;
    document.cookie = `${TAKEOVER_NOTICE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    return parseTakeoverNotice(raw);
}

export function SignInNotice() {
    const [notice, setNotice] = useState<TakeoverNotice | null>(null);

    useEffect(() => {
        // Only ever set: a second run (Strict Mode) finds the cookie already
        // taken and must not clear what the first run found.
        const found = takeNotice();
        if (found) setNotice(found);
    }, []);

    if (!notice) return null;
    const close = () => setNotice(null);
    const { provider, removed, plural, passwordRemoved } = notice;

    return (
        <Dialog open onOpenChange={open => !open && close()}>
            <DialogContent className="bg-panel border-line sm:max-w-md">
                <DialogHeader>
                    <span className="bg-brand-soft text-brand mx-auto mb-1 flex size-9 items-center justify-center rounded-lg sm:mx-0">
                        <ShieldCheck className="size-[18px]" aria-hidden />
                    </span>
                    <DialogTitle className="text-ink text-xl">
                        You&apos;re signed in with {provider}
                    </DialogTitle>
                    <DialogDescription>
                        {provider} confirmed this email address is yours. Launchstack had never
                        confirmed it, so we couldn&apos;t tell who set up the earlier sign-in. To
                        keep the account yours, {removed} {plural ? "were" : "was"} removed and
                        every other browser was signed out.
                    </DialogDescription>
                </DialogHeader>
                <p className="text-ink-3 m-0 text-center text-[13px] leading-relaxed sm:text-left">
                    If you didn&apos;t create this account yourself, check who else is in its
                    workspaces under Workspace › People and access.
                    {passwordRemoved && " Want a password too? Set a new one in Settings."}
                </p>
                <DialogFooter>
                    {passwordRemoved && (
                        <Button asChild variant="outline" onClick={close}>
                            <Link href="/employer/settings?show=sign-in#account">
                                Set a password
                            </Link>
                        </Button>
                    )}
                    <Button onClick={close} autoFocus>
                        Got it
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
