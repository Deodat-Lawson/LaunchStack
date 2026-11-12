"use client";

/**
 * The account chip in the picker's top bar, and the menu behind it: who you
 * are signed in as, every other account signed in on this browser (one click
 * switches), adding another, and signing out of one or all of them.
 *
 * Accounts come from Better Auth's multi-session plugin; see
 * ~/server/auth/device-sessions for how the cookies work. Every change ends
 * in a full page load, so the server renders the picker for whoever is now
 * active and nothing cached in this tab (profile, people) outlives the
 * account it belonged to.
 */

import { Check, ChevronDown, LogOut, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
    authClient,
    listDeviceAccounts,
    rememberActiveSession,
    signOutAllDeviceAccounts,
    signOutDeviceAccount,
    switchDeviceAccount,
    type DeviceAccount,
} from "~/lib/auth-client";
import { MAX_DEVICE_ACCOUNTS, withAddAccount } from "~/lib/auth/device-accounts";

import { reloadAs } from "./reload-as";

export interface AccountMenuProps {
    account: { name: string; email: string };
    /** Your profile photo, or null for initials. */
    photo: string | null;
    /** The chip's look comes from the page; the menu's from the kit. */
    triggerClassName?: string;
    emailClassName?: string;
    chevronClassName?: string;
    /**
     * From the server's read of the cookies: the browser holds the most
     * accounts it keeps. It counts what the list leaves out (a session that
     * has ended but still holds a slot), so it wins over the list's length.
     */
    limitReached?: boolean;
}

export function AccountMenu({
    account,
    photo,
    triggerClassName,
    emailClassName,
    chevronClassName,
    limitReached = false,
}: AccountMenuProps) {
    const t = useTranslations("auth.workspaces.accountMenu");
    const tAdd = useTranslations("auth.addAccount");
    const { data: session } = authClient.useSession();
    const activeToken = session?.session.token;
    const activeUserId = session?.user.id;

    const [accounts, setAccounts] = useState<DeviceAccount[] | null>(null);
    // Each account's own profile photo, the one the chip shows for the
    // active account: Better Auth's `user.image` is the sign-in provider's
    // picture, which would give one person two faces in one menu.
    const [photos, setPhotos] = useState<Record<string, string | null>>({});
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        if (!activeToken) return;
        try {
            setAccounts(await listDeviceAccounts(activeToken));
        } catch {
            // The menu still works for the active account alone.
            setAccounts(current => current ?? []);
        }
        try {
            const res = await fetch("/api/profile/device-photos");
            if (res.ok) {
                const body = (await res.json()) as { photos?: Record<string, string | null> };
                setPhotos(body.photos ?? {});
            }
        } catch {
            // Initials, then.
        }
    }, [activeToken]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const others = useMemo(
        () => (accounts ?? []).filter(a => a.userId !== activeUserId),
        [accounts, activeUserId]
    );
    const atLimit = limitReached || (accounts?.length ?? 1) >= MAX_DEVICE_ACCOUNTS;

    const run = async (work: () => Promise<void>, failure: string) => {
        if (busy) return;
        setBusy(true);
        try {
            await work();
        } catch {
            toast.error(failure);
            setBusy(false);
            void refresh();
        }
    };

    const switchTo = (other: DeviceAccount) =>
        run(
            async () => {
                toast.loading(t("switching", { name: other.name || other.email }), {
                    id: "account-switch",
                });
                try {
                    await switchDeviceAccount(other.sessionToken);
                } finally {
                    toast.dismiss("account-switch");
                }
                reloadAs("/workspaces");
            },
            t("switchFailed", { email: other.email })
        );

    const addAnother = () =>
        run(async () => {
            await rememberActiveSession();
            reloadAs(withAddAccount("/signin"));
        }, t("addFailed"));

    const signOutActive = () =>
        run(async () => {
            const mine = accounts?.find(a => a.userId === activeUserId);
            if (others.length > 0 && mine) {
                await signOutDeviceAccount(mine.sessionToken);
                // The plugin has already made one of the others active, but
                // its pick need not be the one this menu shows first. Land on
                // the top of "Switch to"; if that fails, its pick stands.
                try {
                    await switchDeviceAccount(others[0]!.sessionToken);
                } catch {
                    // Still signed in as whichever account the plugin chose.
                }
                reloadAs("/workspaces");
            } else if (others.length > 0 && activeToken) {
                // Signed in past the limit, so this browser doesn't remember
                // this account and revoke can't name it: end this session,
                // then make one of the others active.
                const { error } = await authClient.revokeSession({ token: activeToken });
                if (error) throw new Error(error.message ?? "sign-out failed");
                await switchDeviceAccount(others[0]!.sessionToken);
                reloadAs("/workspaces");
            } else {
                await signOutAllDeviceAccounts();
                reloadAs("/signin");
            }
        }, t("signOutFailed"));

    const signOutEveryone = () =>
        run(async () => {
            await signOutAllDeviceAccounts();
            reloadAs("/signin");
        }, t("signOutFailed"));

    const label = account.email
        ? t("trigger", { name: account.name, email: account.email })
        : t("triggerNoEmail", { name: account.name });

    return (
        <DropdownMenu onOpenChange={open => open && void refresh()}>
            <DropdownMenuTrigger asChild>
                <button type="button" className={triggerClassName} aria-label={label}>
                    <ProfileAvatar
                        name={account.name}
                        email={account.email}
                        src={photo}
                        className="size-[22px]"
                        fallbackClassName="text-xs"
                    />
                    <span>{account.name}</span>
                    {account.email ? (
                        <span className={emailClassName}>· {account.email}</span>
                    ) : null}
                    <ChevronDown className={chevronClassName} size={12} aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                sideOffset={8}
                // Off the screen's edge on a phone.
                collisionPadding={12}
                className="border-line w-[min(21rem,calc(100vw-2rem))] p-1.5"
            >
                <DropdownMenuLabel className="text-ink-3 px-2 pb-1 pt-1.5 text-xs font-medium">
                    {t("signedInAs")}
                </DropdownMenuLabel>
                <div
                    className="flex items-center gap-2.5 px-2 py-1.5"
                    data-testid="account-current"
                >
                    <ProfileAvatar
                        name={account.name}
                        email={account.email}
                        src={photo}
                        className="size-7"
                        fallbackClassName="text-xs"
                    />
                    <AccountText name={account.name} email={account.email} />
                    <Check className="text-brand size-4 shrink-0" aria-hidden />
                    <span className="sr-only">{t("current")}</span>
                </div>

                {others.length > 0 ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-ink-3 px-2 pb-1 pt-1.5 text-xs font-medium">
                            {t("switchTo")}
                        </DropdownMenuLabel>
                        <DropdownMenuGroup>
                            {others.map(other => (
                                <DropdownMenuItem
                                    key={other.userId}
                                    disabled={busy}
                                    onSelect={() => void switchTo(other)}
                                    className="gap-2.5"
                                    data-testid="account-other"
                                >
                                    <ProfileAvatar
                                        name={other.name}
                                        email={other.email}
                                        src={photos[other.userId] ?? null}
                                        className="size-7"
                                        fallbackClassName="text-xs"
                                    />
                                    <AccountText name={other.name} email={other.email} />
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuGroup>
                    </>
                ) : null}

                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={busy || atLimit} onSelect={() => void addAnother()}>
                    <UserPlus aria-hidden />
                    {t("add")}
                </DropdownMenuItem>
                {atLimit ? (
                    <p className="text-ink-3 m-0 px-2 pb-1.5 text-xs leading-snug">
                        {tAdd("limit", { max: MAX_DEVICE_ACCOUNTS })}
                    </p>
                ) : null}

                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={busy} onSelect={() => void signOutActive()}>
                    <LogOut aria-hidden />
                    <span className="min-w-0 truncate">
                        {account.email
                            ? t("signOutOf", { email: account.email })
                            : t("signOutOfThis")}
                    </span>
                </DropdownMenuItem>
                {others.length > 0 ? (
                    <DropdownMenuItem disabled={busy} onSelect={() => void signOutEveryone()}>
                        <LogOut aria-hidden />
                        {t("signOutAll")}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function AccountText({ name, email }: { name: string; email: string }) {
    return (
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-ink truncate text-[13px] font-medium leading-tight">
                {name || email}
            </span>
            {name && email ? (
                <span className="text-ink-3 truncate text-xs leading-tight">{email}</span>
            ) : null}
        </span>
    );
}
