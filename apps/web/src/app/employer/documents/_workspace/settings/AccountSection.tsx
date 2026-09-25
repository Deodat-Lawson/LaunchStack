"use client";

/**
 * Account — who you are, and where you are signed in.
 *
 * Body only. The profile (photo, names, title, the per-workspace look) is
 * `ProfileEditor`. The rest is Better Auth's own data, reached through its
 * client: the credential and linked sign-in accounts, and every session
 * that currently holds a cookie for this person, with the device it came
 * from and a way to end it.
 *
 * The password form is the person's own form for their own password; the
 * values go to `/api/auth/change-password` and nowhere else.
 */

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/layout/page-shell";
import { Field, TextInput } from "~/components/field";
import { authClient, useUser } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

import type { SettingsSectionProps } from "./contract";
import { relativeTime } from "./people/format";
import { ProfileEditor } from "./ProfileEditor";
import { StatusNote } from "./ui";

interface SessionRow {
    id: string;
    token: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    expiresAt: Date | string;
    ipAddress?: string | null;
    userAgent?: string | null;
}

interface AccountRow {
    id: string;
    providerId: string;
    accountId: string;
    createdAt: Date | string;
}

const PROVIDER_LABEL: Record<string, string> = {
    credential: "Email and password",
    google: "Google",
    github: "GitHub",
};

/** "Chrome on macOS" from a user-agent string, or the raw string's first words. */
function describeAgent(userAgent: string | null | undefined): string {
    if (!userAgent) return "Unknown browser";
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
                  ? "Desktop app"
                  : "Browser";
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
    return os ? `${browser} on ${os}` : browser;
}

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

export function AccountSection({ onActions }: SettingsSectionProps) {
    const { user } = useUser();
    const session = authClient.useSession();
    const currentToken = session.data?.session.token ?? null;

    const [sessions, setSessions] = useState<SessionRow[] | null>(null);
    const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [list, linked] = await Promise.all([
                authClient.listSessions(),
                authClient.listAccounts(),
            ]);
            if (list.error) throw new Error(list.error.message ?? "Could not list sessions.");
            setSessions((list.data ?? []) as SessionRow[]);
            setAccounts(linked.error ? [] : ((linked.data ?? []) as AccountRow[]));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load your account.");
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const revoke = async (token: string) => {
        setBusy(token);
        try {
            const result = await authClient.revokeSession({ token });
            if (result.error)
                throw new Error(result.error.message ?? "Could not end that session.");
            toast.success("Session ended");
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not end that session.");
        } finally {
            setBusy(null);
        }
    };

    const revokeOthers = async () => {
        setBusy("others");
        try {
            const result = await authClient.revokeOtherSessions();
            if (result.error)
                throw new Error(result.error.message ?? "Could not end the other sessions.");
            toast.success("Every other session ended");
            await refresh();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not end the other sessions.");
        } finally {
            setBusy(null);
        }
    };

    const hasPassword = accounts?.some(account => account.providerId === "credential") ?? false;
    const others = (sessions ?? []).filter(row => row.token !== currentToken);

    return (
        <>
            {error && <StatusNote tone="danger">{error}</StatusNote>}

            <ProfileEditor onActions={onActions} emailVerified={user ? user.emailVerified : null} />

            <Section
                title="Sign-in"
                description="How you get in, and any accounts linked to yours."
            >
                <Card>
                    {accounts === null ? (
                        <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                            Loading…
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
                                    <div className="min-w-0 flex-1">
                                        <div className="text-ink text-[13px] font-semibold">
                                            {PROVIDER_LABEL[account.providerId] ??
                                                account.providerId}
                                        </div>
                                        <div className="text-ink-3 text-[12px]">
                                            Linked {relativeTime(iso(account.createdAt))}
                                        </div>
                                    </div>
                                    {account.providerId !== "credential" && accounts.length > 1 && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={busy === account.id}
                                            onClick={async () => {
                                                setBusy(account.id);
                                                try {
                                                    const result = await authClient.unlinkAccount({
                                                        accountId: account.accountId,
                                                    });
                                                    if (result.error) {
                                                        throw new Error(
                                                            result.error.message ??
                                                                "Could not unlink."
                                                        );
                                                    }
                                                    toast.success("Account unlinked");
                                                    await refresh();
                                                } catch (err) {
                                                    toast.error(
                                                        err instanceof Error
                                                            ? err.message
                                                            : "Could not unlink."
                                                    );
                                                } finally {
                                                    setBusy(null);
                                                }
                                            }}
                                        >
                                            Unlink
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
                {hasPassword && <PasswordCard />}
            </Section>

            <Section
                title="Sessions"
                description="Every browser that currently holds a session for you. Ending one signs that browser out on its next request."
            >
                <Card padding={0}>
                    {sessions === null ? (
                        <div className="text-ink-3 px-5 py-4 text-[13px]">Loading…</div>
                    ) : (
                        sessions
                            .slice()
                            .sort((a, b) =>
                                a.token === currentToken ? -1 : b.token === currentToken ? 1 : 0
                            )
                            .map((row, index) => {
                                const current = row.token === currentToken;
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
                                                {describeAgent(row.userAgent)}
                                                {current && (
                                                    <Badge variant="success">This browser</Badge>
                                                )}
                                            </div>
                                            <div className="text-ink-3 text-[12px]">
                                                {row.ipAddress ? `${row.ipAddress} · ` : ""}
                                                last active {relativeTime(iso(row.updatedAt))} ·
                                                expires {relativeTime(iso(row.expiresAt))}
                                            </div>
                                        </div>
                                        {!current && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={busy === row.token}
                                                onClick={() => void revoke(row.token)}
                                            >
                                                {busy === row.token ? "Ending…" : "End session"}
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
                                ? "Ending…"
                                : `End the other ${others.length === 1 ? "session" : `${others.length} sessions`}`}
                        </Button>
                    </div>
                )}
            </Section>
        </>
    );
}

function PasswordCard() {
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
            if (result.error)
                throw new Error(result.error.message ?? "Could not change your password.");
            toast.success("Password changed");
            setCurrent("");
            setNext("");
            setConfirm("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not change your password.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="mt-3.5">
            <form onSubmit={submit}>
                <div className="text-ink mb-3 text-[13px] font-semibold">Change password</div>
                <Field label="Current password">
                    <TextInput
                        type="password"
                        autoComplete="current-password"
                        value={current}
                        onChange={e => setCurrent(e.target.value)}
                    />
                </Field>
                <div className="grid gap-3.5 md:grid-cols-2">
                    <Field label="New password" hint="At least 8 characters.">
                        <TextInput
                            type="password"
                            autoComplete="new-password"
                            value={next}
                            onChange={e => setNext(e.target.value)}
                        />
                    </Field>
                    <Field
                        label="Repeat it"
                        error={confirm && confirm !== next ? "Does not match." : undefined}
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
                    Sign out every other browser
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
                        {saving ? "Changing…" : "Change password"}
                    </Button>
                </div>
            </form>
        </Card>
    );
}
