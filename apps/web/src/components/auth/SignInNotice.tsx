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
import { useFormatter, useTranslations } from "next-intl";

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
    parseTakeoverNoticeMethods,
    TAKEOVER_NOTICE_COOKIE,
    type TakeoverNoticeMethods,
} from "~/lib/auth/takeover-notice";

/** Reads the note and deletes it in the same step, so it shows exactly once. */
function takeNotice(): TakeoverNoticeMethods | null {
    const prefix = `${TAKEOVER_NOTICE_COOKIE}=`;
    const raw = document.cookie
        .split("; ")
        .find(part => part.startsWith(prefix))
        ?.slice(prefix.length);
    if (raw === undefined) return null;
    document.cookie = `${TAKEOVER_NOTICE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    return parseTakeoverNoticeMethods(raw);
}

export function SignInNotice() {
    const t = useTranslations("auth.signInNotice");
    const format = useFormatter();
    const [notice, setNotice] = useState<TakeoverNoticeMethods | null>(null);

    useEffect(() => {
        // Only ever set: a second run (Strict Mode) finds the cookie already
        // taken and must not clear what the first run found.
        const found = takeNotice();
        if (found) setNotice(found);
    }, []);

    if (!notice) return null;
    const close = () => setNotice(null);
    const { provider } = notice;
    const removed = format.list(
        notice.removed.map(method => t(`methods.${method}`)),
        { type: "conjunction" }
    );
    const passwordRemoved = notice.removed.includes("credential");
    const body = notice.removed.length > 1 ? "bodyPlural" : "bodySingle";

    return (
        <Dialog open onOpenChange={open => !open && close()}>
            <DialogContent className="bg-panel border-line sm:max-w-md">
                <DialogHeader>
                    <span className="bg-brand-soft text-brand mx-auto mb-1 flex size-9 items-center justify-center rounded-lg sm:mx-0">
                        <ShieldCheck className="size-[18px]" aria-hidden />
                    </span>
                    <DialogTitle className="text-ink text-xl">
                        {t("title", { provider })}
                    </DialogTitle>
                    <DialogDescription>{t(body, { provider, removed })}</DialogDescription>
                </DialogHeader>
                <p className="text-ink-3 m-0 text-center text-[13px] leading-relaxed sm:text-left">
                    {passwordRemoved ? t("checkPeopleSetPassword") : t("checkPeople")}
                </p>
                <DialogFooter>
                    {passwordRemoved && (
                        <Button asChild variant="outline" onClick={close}>
                            <Link href="/employer/settings?show=sign-in#account">
                                {t("setPassword")}
                            </Link>
                        </Button>
                    )}
                    <Button onClick={close} autoFocus>
                        {t("gotIt")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
