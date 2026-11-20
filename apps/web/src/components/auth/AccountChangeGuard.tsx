"use client";

/**
 * Stops a tab that is no longer acting as the account it was loaded for.
 *
 * Switching account (or signing out) in one tab changes the session for every
 * tab in the browser. A tab still showing the old account would otherwise
 * carry on as the new one, writing into the new account's workspace. When the
 * server says this tab's account has changed — after another tab announces
 * it (~/lib/auth/account-sync), or when this tab comes back into view — a
 * dialog that can't be dismissed says so and offers a reload. Never a silent
 * reload: the tab may hold unsaved work.
 *
 * Mounted on the signed-in layouts (/workspaces and /employer) with the
 * account the server rendered the page for.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { authClient } from "~/lib/auth-client";
import {
    announceAccountChange,
    leaveAfterAccountChange,
    onAccountChange,
} from "~/lib/auth/account-sync";

type Changed = { to: string } | { signedOut: true };

export function AccountChangeGuard({ userId, userName }: { userId: string; userName: string }) {
    const t = useTranslations("auth.accountChanged");
    const [changed, setChanged] = useState<Changed | null>(null);

    useEffect(() => {
        let checking = false;
        const check = async () => {
            if (checking) return;
            checking = true;
            try {
                const { data } = await authClient.getSession();
                const now = data?.user;
                if (now?.id === userId) return;
                setChanged(now ? { to: now.name || now.email } : { signedOut: true });
            } catch {
                // Offline: the next focus asks again.
            } finally {
                checking = false;
            }
        };
        const onVisible = () => {
            if (document.visibilityState === "visible") void check();
        };
        const stop = onAccountChange(() => void check());
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        // A page that loads as an account tells the others: this covers every
        // way an account becomes active (the menu, adding one, a Google
        // sign-in that ends on a page load).
        announceAccountChange();
        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [userId]);

    if (!changed) return null;

    const signedOut = "signedOut" in changed;

    return (
        // Open until answered: no close button, no Escape, no click outside.
        <Dialog open onOpenChange={() => undefined}>
            <DialogContent
                showCloseButton={false}
                onEscapeKeyDown={event => event.preventDefault()}
                onPointerDownOutside={event => event.preventDefault()}
                onInteractOutside={event => event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>
                        {signedOut ? t("signedOutTitle") : t("title", { name: changed.to })}
                    </DialogTitle>
                    <DialogDescription>
                        {signedOut
                            ? t("signedOutBody")
                            : t("body", { previous: userName, name: changed.to })}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" onClick={() => leaveAfterAccountChange(signedOut)}>
                        {signedOut ? t("signIn") : t("reload")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
