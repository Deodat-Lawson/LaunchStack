"use client";

/**
 * Account — who you are, and where you are signed in.
 *
 * Body only. The profile (photo, names, title, the per-workspace look) is
 * `ProfileEditor`; your AI allowance this month is `AiAllowanceCard`. The
 * rest is Better Auth's own data: the credential and linked sign-in
 * accounts (through its client), and every session that currently holds a
 * cookie for this person, with the device it came from and a way to end it
 * (through `/api/profile/sessions`, which needs no recent sign-in and never
 * sends a session's token to the page).
 *
 * Unlinking a sign-in and setting a password do need a recent sign-in
 * (Better Auth's `freshAge`, a day); past that, they say so and offer to
 * sign in again rather than showing Better Auth's "Session is not fresh".
 *
 * The password forms are the person's own forms for their own password: a
 * change goes to `/api/auth/change-password`, and setting one on an account
 * that has none (made with a sign-in provider) to `/api/profile/sign-in`.
 *
 * "Connect" links a provider the deployment offers to this account; the
 * round trip through the provider comes back to `/employer/settings` with
 * `?connect=<provider>` and, when it failed, Better Auth's `&error=<code>`.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { connectErrorMessage } from "~/components/auth/auth-errors";
import { providerIcon } from "~/components/auth/provider-icons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/layout/page-shell";
import { Field, TextInput } from "~/components/field";
import { authClient, useAuth, useUser } from "~/lib/auth-client";
import { providerName, type SocialProvider } from "~/lib/auth/providers";
import { cn } from "~/lib/utils";

import { AiAllowanceCard } from "./AiAllowanceCard";
import { AssistantsBlock } from "./AssistantsBlock";
import type { SettingsSectionProps } from "./contract";
import { useTimeFormat } from "./people/format";
import { ProfileEditor } from "./ProfileEditor";
import { StatusNote } from "./ui";

/** A row from `/api/profile/sessions`: no token, the current one marked. */
interface SessionRow {
    id: string;
    current: boolean;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
}

/** Better Auth's code for a sign-in older than `freshAge`; our routes answer with it too. */
const SESSION_NOT_FRESH = "SESSION_NOT_FRESH";

/** Back here after signing in again, opened on the Sign-in block. */
const SIGN_IN_AGAIN_RETURN = "/employer/settings?show=sign-in";

interface AccountRow {
    id: string;
    providerId: string;
    accountId: string;
    createdAt: Date | string;
}

/** `useTranslations("settings.account")`. */
type AccountT = ReturnType<typeof useTranslations<"settings.account">>;

/**
 * Brand names stay as they are; the password is said in the reader's
 * language. The deployment's OIDC provider is named by the deployment (the
 * offered list carries AUTH_OIDC_NAME); a linked one the deployment no longer
 * offers is just "Single sign-on".
 */
function providerLabel(
    t: AccountT,
    providerId: string,
    offered: readonly SocialProvider[]
): string | undefined {
    if (providerId === "credential") return t("providers.credential");
    return (
        providerName(providerId, offered) ??
        (providerId === "oidc" ? t("providers.oidc") : undefined)
    );
}

/**
 * "For your security, sign in again to …" with the button that does it:
 * signs out, then the sign-in page brings the person back here.
 */
function SignInAgainNote({ message }: { message: string }) {
    const t = useTranslations("settings.account");
    const { signOut } = useAuth();
    const [leaving, setLeaving] = useState(false);
    return (
        <StatusNote tone="warn">
            <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">{message}</span>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={leaving}
                    onClick={() => {
                        setLeaving(true);
                        void signOut({
                            redirectUrl: `/signin?next=${encodeURIComponent(SIGN_IN_AGAIN_RETURN)}`,
                        });
                    }}
                >
                    {t("signInAgain.button")}
                </Button>
            </div>
        </StatusNote>
    );
}

/** Where a "Connect" round trip lands, success or failure. */
function connectReturnPath(provider: SocialProvider): string {
    return `/employer/settings?connect=${provider.id}#account`;
}

interface Arrival {
    /** Back from a "Connect" round trip: which provider, and Better Auth's error code if it failed. */
    connect: { provider: string; error: string | null } | null;
    /** Open on the Sign-in block: a connect result, or `?show=sign-in` (the takeover notice). */
    showSignIn: boolean;
}

/**
 * What the address bar says about how this page was reached, read once and
 * then dropped from it so a reload doesn't replay it.
 */
function takeArrival(): Arrival {
    const url = new URL(window.location.href);
    const provider = url.searchParams.get("connect");
    const connect = provider ? { provider, error: url.searchParams.get("error") } : null;
    const showSignIn = connect !== null || url.searchParams.get("show") === "sign-in";
    const keys = ["connect", "error", "error_description", "show"];
    if (keys.some(key => url.searchParams.has(key))) {
        for (const key of keys) url.searchParams.delete(key);
        window.history.replaceState(window.history.state, "", url);
    }
    return { connect, showSignIn };
}

/** "Chrome on macOS" from a user-agent string, or the raw string's first words. */
function describeAgent(t: AccountT, userAgent: string | null | undefined): string {
    if (!userAgent) return t("agent.unknown");
    const ua = userAgent;
    const browser = ua.includes("Edg/")
        ? "Edge"
        : ua.includes("OPR/")
          ? "Opera"
          : ua.includes("Chrome/")
            ? "Chrome"
            : ua.includes("Firefox/")
              ? "Firefox"
              : ua.includes("Safari/")
                ? "Safari"
                : ua.includes("Electron/")
                  ? t("agent.desktopApp")
                  : t("agent.browser");
    const os = ua.includes("Windows")
        ? "Windows"
        : ua.includes("Mac OS X") || ua.includes("Macintosh")
          ? "macOS"
          : ua.includes("Android")
            ? "Android"
            : ua.includes("iPhone") || ua.includes("iPad")
              ? "iOS"
              : ua.includes("Linux")
                ? "Linux"
                : null;
    return os ? t("agent.on", { browser, os }) : browser;
}

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

export function AccountSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.account");
    const tc = useTranslations("common");
    const tAuthErrors = useTranslations("auth.errors");
    const time = useTimeFormat();
    const { user } = useUser();

    const [sessions, setSessions] = useState<SessionRow[] | null>(null);
    const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
    // A failed list must not read as "no password, nothing linked": that
    // would offer to set a password the person already has.
    const [accountsFailed, setAccountsFailed] = useState(false);
    const [offered, setOffered] = useState<SocialProvider[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [connectFailure, setConnectFailure] = useState<{
        provider: string;
        error: string;
    } | null>(null);
    // Back from a successful "Connect": toasted once the offered list has
    // loaded, since only that list can name the deployment's OIDC provider.
    const [connectedArrival, setConnectedArrival] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const signInRef = useRef<HTMLDivElement>(null);
    const [showSignIn, setShowSignIn] = useState(false);
    // Unlink was refused because the sign-in is more than a day old.
    const [unlinkNeedsSignIn, setUnlinkNeedsSignIn] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const [list, linked, signIn] = await Promise.all([
                fetch("/api/profile/sessions", { credentials: "same-origin" }).then(async res => {
                    const body = (await res.json().catch(() => null)) as {
                        sessions?: SessionRow[];
                        error?: string;
                    } | null;
                    if (!res.ok || !body?.sessions) {
                        return { data: null, error: { message: body?.error } };
                    }
                    return { data: body.sessions, error: null };
                }),
                authClient.listAccounts(),
                fetch("/api/profile/sign-in", { credentials: "same-origin" })
                    .then(res =>
                        res.ok ? (res.json() as Promise<{ providers: SocialProvider[] }>) : null
                    )
                    .catch(() => null),
            ]);
            setAccountsFailed(Boolean(linked.error));
            if (!linked.error) setAccounts((linked.data ?? []) as AccountRow[]);
            setOffered(signIn?.providers ?? []);
            if (list.error) throw new Error(list.error.message ?? t("couldNotListSessions"));
            setSessions(list.data ?? []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("couldNotLoad"));
        }
    }, [t]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Back from a "Connect" round trip, or sent here to set a password: say
    // how it went, once, and open on the Sign-in block.
    useEffect(() => {
        const arrival = takeArrival();
        // Only ever set: a second run (Strict Mode) finds the address already
        // cleaned and must not undo the first.
        if (arrival.showSignIn) setShowSignIn(true);
        const connected = arrival.connect;
        if (!connected) return;
        if (connected.error) {
            setConnectFailure({ provider: connected.provider, error: connected.error });
        } else {
            setConnectedArrival(connected.provider);
        }
    }, []);

    useEffect(() => {
        if (connectedArrival === null || accounts === null) return;
        toast.success(
            t("connected", {
                provider: providerLabel(t, connectedArrival, offered) ?? t("accountFallback"),
            })
        );
        setConnectedArrival(null);
    }, [connectedArrival, accounts, offered, t]);

    // Once the block has its rows, so it doesn't move after the jump.
    useEffect(() => {
        if (!showSignIn || accounts === null) return;
        signInRef.current?.scrollIntoView({ block: "start" });
        setShowSignIn(false);
    }, [showSignIn, accounts]);

    const connect = async (provider: SocialProvider) => {
        setBusy(`connect:${provider.id}`);
        setConnectFailure(null);
        try {
            // Leaves the page for the provider on success; Better Auth's client
            // follows the redirect it answers with.
            const result = await authClient.linkSocial({
                provider: provider.id,
                callbackURL: connectReturnPath(provider),
                errorCallbackURL: connectReturnPath(provider),
            });
            if (result.error) {
                throw new Error(
                    result.error.message ?? t("couldNotConnect", { provider: provider.name })
                );
            }
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : t("couldNotConnect", { provider: provider.name })
            );
            setBusy(null);
        }
    };

    const revoke = async (id: string) => {
        setBusy(id);
        try {
            const res = await fetch("/api/profile/sessions", {
                method: "DELETE",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error ?? t("couldNotEndSession"));
            }
            toast.success(t("sessionEnded"));
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("couldNotEndSession"));
        } finally {
            setBusy(null);
        }
    };

    const revokeOthers = async () => {
        setBusy("others");
        try {
            const result = await authClient.revokeOtherSessions();
            if (result.error) throw new Error(result.error.message ?? t("couldNotEndOthers"));
            toast.success(t("othersEnded"));
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("couldNotEndOthers"));
        } finally {
            setBusy(null);
        }
    };

    const hasPassword = accounts?.some(account => account.providerId === "credential") ?? false;
    const unlinked = offered.filter(
        provider => !accounts?.some(account => account.providerId === provider.id)
    );
    const others = (sessions ?? []).filter(row => !row.current);

    return (
        <>
            {error && <StatusNote tone="danger">{error}</StatusNote>}

            <ProfileEditor onActions={onActions} emailVerified={user ? user.emailVerified : null} />

            <AiAllowanceCard />

            <div ref={signInRef} className="scroll-mt-4" />
            <Section title={t("signIn.title")}>
                {connectFailure && (
                    <StatusNote tone="danger">
                        {connectErrorMessage(
                            connectFailure.error,
                            offered.find(provider => provider.id === connectFailure.provider) ??
                                connectFailure.provider,
                            user?.email,
                            tAuthErrors
                        )}
                    </StatusNote>
                )}
                {unlinkNeedsSignIn && <SignInAgainNote message={t("signInAgain.unlink")} />}
                <Card>
                    {accountsFailed ? (
                        <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                            {t("signIn.loadFailed")}
                        </StatusNote>
                    ) : accounts === null ? (
                        <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                            {tc("status.loading")}
                        </StatusNote>
                    ) : (
                        <ul className="m-0 list-none p-0">
                            {accounts.map((account, index) => (
                                <li
                                    key={account.id}
                                    className={cn(
                                        "flex items-center gap-3 py-2.5",
                                        index > 0 && "border-line border-t"
                                    )}
                                >
                                    <ProviderMark providerId={account.providerId} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-ink text-[13px] font-semibold">
                                            {providerLabel(t, account.providerId, offered) ??
                                                account.providerId}
                                        </div>
                                        <div className="text-ink-3 text-[12px]">
                                            {t("signIn.linked", {
                                                when: time.relative(iso(account.createdAt)),
                                            })}
                                        </div>
                                    </div>
                                    {account.providerId !== "credential" && accounts.length > 1 && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={busy === account.id}
                                            onClick={async () => {
                                                setBusy(account.id);
                                                setUnlinkNeedsSignIn(false);
                                                try {
                                                    // Better Auth's own row id, not the
                                                    // provider's subject (accountId).
                                                    const result = await authClient.unlinkAccount({
                                                        accountId: account.id,
                                                    });
                                                    if (result.error?.code === SESSION_NOT_FRESH) {
                                                        setUnlinkNeedsSignIn(true);
                                                        return;
                                                    }
                                                    if (result.error) {
                                                        throw new Error(
                                                            result.error.message ??
                                                                t("signIn.couldNotUnlink")
                                                        );
                                                    }
                                                    toast.success(t("signIn.unlinked"));
                                                    await refresh();
                                                } catch (err) {
                                                    toast.error(
                                                        err instanceof Error
                                                            ? err.message
                                                            : t("signIn.couldNotUnlink")
                                                    );
                                                } finally {
                                                    setBusy(null);
                                                }
                                            }}
                                        >
                                            {t("signIn.unlink")}
                                        </Button>
                                    )}
                                </li>
                            ))}
                            {unlinked.map((provider, index) => (
                                <li
                                    key={provider.id}
                                    className={cn(
                                        "flex items-center gap-3 py-2.5",
                                        (accounts.length > 0 || index > 0) && "border-line border-t"
                                    )}
                                >
                                    <ProviderMark providerId={provider.id} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-ink text-[13px] font-semibold">
                                            {provider.name}
                                        </div>
                                        <div className="text-ink-3 text-[12px]">
                                            {tc("status.notConnected")}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy?.startsWith("connect:") ?? false}
                                        onClick={() => void connect(provider)}
                                    >
                                        {busy === `connect:${provider.id}`
                                            ? t("signIn.connecting")
                                            : tc("actions.connect")}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
                {accounts !== null &&
                    !accountsFailed &&
                    (hasPassword ? <PasswordCard /> : <SetPasswordCard onSet={refresh} />)}
            </Section>

            <Section title={t("sessions.title")} description={t("sessions.description")}>
                <Card padding={0}>
                    {sessions === null ? (
                        <div className="text-ink-3 px-5 py-4 text-[13px]">
                            {tc("status.loading")}
                        </div>
                    ) : (
                        // The route sorts: this browser first, then by last activity.
                        sessions.map((row, index) => {
                            const current = row.current;
                            return (
                                <div
                                    key={row.id}
                                    className={cn(
                                        "flex items-center gap-3 px-5 py-3",
                                        index > 0 && "border-line border-t"
                                    )}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="text-ink flex items-center gap-2 text-[13px] font-semibold">
                                            {describeAgent(t, row.userAgent)}
                                            {current && (
                                                <Badge variant="success">
                                                    {t("sessions.thisBrowser")}
                                                </Badge>
                                            )}
                                        </div>
                                        {/* An IPv6 address has no break opportunities of its
                                                own; without this it widens a narrow pane. */}
                                        <div className="text-ink-3 text-[12px] [overflow-wrap:anywhere]">
                                            {row.ipAddress
                                                ? t("sessions.metaWithIp", {
                                                      ip: row.ipAddress,
                                                      active: time.relative(row.updatedAt),
                                                      expires: time.until(row.expiresAt),
                                                  })
                                                : t("sessions.meta", {
                                                      active: time.relative(row.updatedAt),
                                                      expires: time.until(row.expiresAt),
                                                  })}
                                        </div>
                                    </div>
                                    {!current && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={busy === row.id}
                                            onClick={() => void revoke(row.id)}
                                        >
                                            {busy === row.id
                                                ? t("sessions.ending")
                                                : t("sessions.end")}
                                        </Button>
                                    )}
                                </div>
                            );
                        })
                    )}
                </Card>
                {others.length > 0 && (
                    <div className="mt-3">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy === "others"}
                            onClick={() => void revokeOthers()}
                        >
                            {busy === "others"
                                ? t("sessions.ending")
                                : t("sessions.endOthers", { count: others.length })}
                        </Button>
                    </div>
                )}
            </Section>

            <AssistantsBlock />
        </>
    );
}

function ProviderMark({ providerId }: { providerId: string }) {
    const Icon = providerId === "credential" ? KeyRound : providerIcon(providerId);
    return (
        <span
            aria-hidden
            className="border-line bg-panel-2 text-ink-2 grid size-8 shrink-0 place-items-center rounded-lg border"
        >
            <Icon size={15} />
        </span>
    );
}

/**
 * For an account with no password: one made with a sign-in provider, or one
 * whose unconfirmed password a provider sign-in removed. No current password
 * to ask for, so the session is the proof (see /api/profile/sign-in).
 */
function SetPasswordCard({ onSet }: { onSet: () => Promise<void> }) {
    const t = useTranslations("settings.account.password");
    const tAccount = useTranslations("settings.account");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [needsSignIn, setNeedsSignIn] = useState(false);

    const canSave = next.length >= 8 && next.length <= 128 && next === confirm;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSave) return;
        setSaving(true);
        setError(null);
        setNeedsSignIn(false);
        try {
            const res = await fetch("/api/profile/sign-in", {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ newPassword: next }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as {
                    error?: string;
                    code?: string;
                } | null;
                if (body?.code === SESSION_NOT_FRESH) {
                    setNeedsSignIn(true);
                    return;
                }
                throw new Error(body?.error ?? t("couldNotSet"));
            }
            toast.success(t("passwordSet"));
            setNext("");
            setConfirm("");
            await onSet();
        } catch (err) {
            setError(err instanceof Error ? err.message : t("couldNotSet"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="mt-3.5">
            <form onSubmit={submit}>
                <div className="text-ink text-[13px] font-semibold">{t("setTitle")}</div>
                <p className="text-ink-3 mb-3 mt-1 text-[12.5px] leading-normal">{t("setBody")}</p>
                <div className="grid gap-3.5 md:grid-cols-2">
                    <Field label={t("newPassword")} hint={t("hint")}>
                        <TextInput
                            type="password"
                            autoComplete="new-password"
                            value={next}
                            onChange={e => setNext(e.target.value)}
                        />
                    </Field>
                    <Field
                        label={t("repeat")}
                        error={confirm && confirm !== next ? t("mismatch") : undefined}
                    >
                        <TextInput
                            type="password"
                            autoComplete="new-password"
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                        />
                    </Field>
                </div>
                {error && (
                    <div className="mt-3">
                        <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                            {error}
                        </StatusNote>
                    </div>
                )}
                {needsSignIn && (
                    <div className="mt-3 [&>div]:mb-0">
                        <SignInAgainNote message={tAccount("signInAgain.password")} />
                    </div>
                )}
                <div className="mt-4 flex justify-end">
                    <Button type="submit" disabled={!canSave || saving}>
                        {saving ? t("setting") : t("setSubmit")}
                    </Button>
                </div>
            </form>
        </Card>
    );
}

function PasswordCard() {
    const t = useTranslations("settings.account.password");
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [signOutOthers, setSignOutOthers] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSave = current.length > 0 && next.length >= 8 && next === confirm;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSave) return;
        setSaving(true);
        setError(null);
        try {
            const result = await authClient.changePassword({
                currentPassword: current,
                newPassword: next,
                revokeOtherSessions: signOutOthers,
            });
            if (result.error) throw new Error(result.error.message ?? t("couldNotChange"));
            toast.success(t("changed"));
            setCurrent("");
            setNext("");
            setConfirm("");
        } catch (err) {
            setError(err instanceof Error ? err.message : t("couldNotChange"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="mt-3.5">
            <form onSubmit={submit}>
                <div className="text-ink mb-3 text-[13px] font-semibold">{t("changeTitle")}</div>
                <Field label={t("current")}>
                    <TextInput
                        type="password"
                        autoComplete="current-password"
                        value={current}
                        onChange={e => setCurrent(e.target.value)}
                    />
                </Field>
                <div className="grid gap-3.5 md:grid-cols-2">
                    <Field label={t("newPassword")} hint={t("hint")}>
                        <TextInput
                            type="password"
                            autoComplete="new-password"
                            value={next}
                            onChange={e => setNext(e.target.value)}
                        />
                    </Field>
                    <Field
                        label={t("repeat")}
                        error={confirm && confirm !== next ? t("mismatch") : undefined}
                    >
                        <TextInput
                            type="password"
                            autoComplete="new-password"
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                        />
                    </Field>
                </div>
                <label className="text-ink-2 flex items-center gap-2 text-[12.5px]">
                    <input
                        type="checkbox"
                        checked={signOutOthers}
                        onChange={e => setSignOutOthers(e.target.checked)}
                    />
                    {t("signOutOthers")}
                </label>
                {error && (
                    <div className="mt-3">
                        <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                            {error}
                        </StatusNote>
                    </div>
                )}
                <div className="mt-4 flex justify-end">
                    <Button type="submit" disabled={!canSave || saving}>
                        {saving ? t("changing") : t("changeSubmit")}
                    </Button>
                </div>
            </form>
        </Card>
    );
}
