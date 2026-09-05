"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Clock, Mail, ShieldCheck } from "lucide-react";

import { AuthChrome } from "~/app/_components/AuthChrome";
import { Button } from "~/components/ui/button";
import { withNext } from "~/components/auth/next-path";
import { useAuth, useUser } from "~/lib/auth-client";
import { roleLabel } from "~/lib/authz/permissions";

interface Preview {
    workspaceName: string;
    workspaceSlug: string;
    role: string;
    roleName: string;
    email: string;
    expiresAt: string;
    status: "pending" | "accepted" | "revoked" | "expired";
}

type LoadState =
    | { phase: "loading" }
    | { phase: "ready"; preview: Preview }
    | { phase: "gone"; message: string }
    | { phase: "error"; message: string };

type JoinState =
    | { phase: "idle" }
    | { phase: "joining" }
    | { phase: "joined" }
    | { phase: "mismatch"; invitedEmail: string }
    | { phase: "expired"; message: string }
    | { phase: "error"; message: string };

const GONE_MESSAGE =
    "This invitation has expired or was withdrawn. Ask whoever invited you to send a new one.";

async function readError(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? fallback;
}

export function InviteLanding({ token }: { token: string }) {
    const router = useRouter();
    const { isLoaded, isSignedIn, signOut } = useAuth();
    const { user } = useUser();
    const selfPath = `/invite/${encodeURIComponent(token)}`;

    const [load, setLoad] = useState<LoadState>({ phase: "loading" });
    const [join, setJoin] = useState<JoinState>({ phase: "idle" });

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(
                    `/api/workspace/invitations/preview?token=${encodeURIComponent(token)}`
                );
                if (cancelled) return;
                if (res.status === 404 || res.status === 410) {
                    setLoad({ phase: "gone", message: await readError(res, GONE_MESSAGE) });
                    return;
                }
                if (!res.ok) {
                    setLoad({
                        phase: "error",
                        message: await readError(
                            res,
                            `We couldn't load this invitation (${res.status}). Try again in a moment.`
                        ),
                    });
                    return;
                }
                const preview = (await res.json()) as Preview;
                if (preview.status !== "pending") {
                    setLoad({
                        phase: "gone",
                        message:
                            preview.status === "accepted"
                                ? "This invitation has already been used. Sign in to open the workspace."
                                : GONE_MESSAGE,
                    });
                    return;
                }
                setLoad({ phase: "ready", preview });
            } catch {
                if (!cancelled) {
                    setLoad({
                        phase: "error",
                        message:
                            "We couldn't reach the server. Check your connection and try again.",
                    });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);

    const accept = useCallback(async () => {
        if (load.phase !== "ready") return;
        setJoin({ phase: "joining" });
        try {
            const res = await fetch("/api/workspace/invitations/accept", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });
            if (res.status === 403) {
                setJoin({ phase: "mismatch", invitedEmail: load.preview.email });
                return;
            }
            if (res.status === 410 || res.status === 404) {
                setJoin({ phase: "expired", message: await readError(res, GONE_MESSAGE) });
                return;
            }
            if (!res.ok) {
                setJoin({
                    phase: "error",
                    message: await readError(res, "We couldn't add you to the workspace."),
                });
                return;
            }
            const data = (await res.json()) as { redirectTo?: string };
            setJoin({ phase: "joined" });
            router.push(data.redirectTo ?? "/employer/documents");
        } catch {
            setJoin({
                phase: "error",
                message: "We couldn't reach the server. Check your connection and try again.",
            });
        }
    }, [load, token, router]);

    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col">
            <AuthChrome />
            <main className="flex flex-1 items-center justify-center px-6 py-12">
                <div className="w-full max-w-[460px]">
                    <div className="mono text-ink-3 mb-2.5 text-[10px] font-bold uppercase tracking-[0.12em]">
                        You&apos;re invited
                    </div>

                    {load.phase === "loading" && (
                        <Card>
                            <p className="text-ink-3 m-0 text-sm">Loading your invitation…</p>
                        </Card>
                    )}

                    {(load.phase === "gone" || load.phase === "error") && (
                        <Card>
                            <Notice tone={load.phase === "gone" ? "muted" : "danger"}>
                                {load.message}
                            </Notice>
                            <div className="mt-4 flex gap-2">
                                <Button asChild variant="outline" size="sm">
                                    <Link href="/signin">Sign in</Link>
                                </Button>
                                {load.phase === "error" && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => window.location.reload()}
                                    >
                                        Try again
                                    </Button>
                                )}
                            </div>
                        </Card>
                    )}

                    {load.phase === "ready" && (
                        <>
                            <h1 className="serif text-ink m-0 mb-2 text-[32px] leading-[1.1] tracking-tight">
                                Join {load.preview.workspaceName}.
                            </h1>
                            <p className="text-ink-3 m-0 mb-6 text-sm leading-relaxed">
                                Accepting adds you to the workspace with the role below. You can
                                leave at any time from your profile.
                            </p>

                            <Card>
                                <dl className="m-0 grid gap-3">
                                    <Row
                                        Icon={ShieldCheck}
                                        label="Role"
                                        value={roleLabel(load.preview.role, load.preview.roleName)}
                                    />
                                    <Row Icon={Mail} label="Sent to" value={load.preview.email} />
                                    <Row
                                        Icon={Clock}
                                        label="Expires"
                                        value={new Date(load.preview.expiresAt).toLocaleString(
                                            undefined,
                                            { dateStyle: "medium", timeStyle: "short" }
                                        )}
                                    />
                                </dl>

                                <div className="border-line mt-5 border-t pt-5">
                                    {!isLoaded && (
                                        <p className="text-ink-3 m-0 text-sm">
                                            Checking whether you&apos;re signed in…
                                        </p>
                                    )}

                                    {isLoaded && !isSignedIn && (
                                        <>
                                            <p className="text-ink-2 m-0 mb-3 text-sm">
                                                Sign in as{" "}
                                                <b className="font-semibold">
                                                    {load.preview.email}
                                                </b>{" "}
                                                to accept, or create an account with that address.
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                <Button asChild>
                                                    <Link href={withNext("/signin", selfPath)}>
                                                        Sign in
                                                    </Link>
                                                </Button>
                                                <Button asChild variant="outline">
                                                    <Link href={withNext("/signup", selfPath)}>
                                                        Create account
                                                    </Link>
                                                </Button>
                                            </div>
                                        </>
                                    )}

                                    {isLoaded && isSignedIn && (
                                        <>
                                            {join.phase === "mismatch" ? (
                                                <Notice tone="warn">
                                                    This invitation was sent to{" "}
                                                    <b className="font-semibold">
                                                        {join.invitedEmail}
                                                    </b>
                                                    {user?.email ? (
                                                        <>
                                                            , but you&apos;re signed in as{" "}
                                                            <b className="font-semibold">
                                                                {user.email}
                                                            </b>
                                                            .
                                                        </>
                                                    ) : (
                                                        "."
                                                    )}{" "}
                                                    Sign out and use the invited address, or ask for
                                                    a new invitation to this one.
                                                </Notice>
                                            ) : join.phase === "expired" ? (
                                                <Notice tone="muted">{join.message}</Notice>
                                            ) : join.phase === "error" ? (
                                                <Notice tone="danger">{join.message}</Notice>
                                            ) : join.phase === "joined" ? (
                                                <Notice tone="ok">
                                                    <CheckCircle2 className="mr-1.5 inline h-4 w-4 align-[-3px]" />
                                                    You&apos;re in. Opening the workspace…
                                                </Notice>
                                            ) : (
                                                <p className="text-ink-2 m-0 mb-3 text-sm">
                                                    Signed in as{" "}
                                                    <b className="font-semibold">
                                                        {user?.email ?? "you"}
                                                    </b>
                                                    .
                                                </p>
                                            )}

                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {join.phase === "mismatch" ? (
                                                    <Button
                                                        onClick={() =>
                                                            void signOut({
                                                                redirectUrl: withNext(
                                                                    "/signin",
                                                                    selfPath
                                                                ),
                                                            })
                                                        }
                                                    >
                                                        Sign out and use {join.invitedEmail}
                                                    </Button>
                                                ) : join.phase === "expired" ? null : (
                                                    <Button
                                                        onClick={() => void accept()}
                                                        disabled={
                                                            join.phase === "joining" ||
                                                            join.phase === "joined"
                                                        }
                                                    >
                                                        {join.phase === "joining"
                                                            ? "Joining…"
                                                            : `Join ${load.preview.workspaceName}`}
                                                    </Button>
                                                )}
                                                <Button asChild variant="ghost">
                                                    <Link href="/workspaces">Not now</Link>
                                                </Button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </Card>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}

function Card({ children }: { children: React.ReactNode }) {
    return <div className="border-line bg-panel rounded-xl border p-5">{children}</div>;
}

function Row({
    Icon,
    label,
    value,
}: {
    Icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
}) {
    return (
        <div className="flex items-center gap-2.5">
            <Icon className="text-ink-3 h-[15px] w-[15px] shrink-0" />
            <dt className="mono text-ink-3 w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em]">
                {label}
            </dt>
            <dd className="text-ink m-0 min-w-0 flex-1 truncate text-[13px]">{value}</dd>
        </div>
    );
}

function Notice({
    tone,
    children,
}: {
    tone: "ok" | "warn" | "danger" | "muted";
    children: React.ReactNode;
}) {
    const cls =
        tone === "ok"
            ? "bg-success-soft text-success"
            : tone === "warn"
              ? "bg-warn-soft text-ink-2"
              : tone === "danger"
                ? "bg-danger-soft text-danger"
                : "bg-panel-2 text-ink-2";
    return (
        <div
            role={tone === "danger" ? "alert" : undefined}
            className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed ${cls}`}
        >
            {tone === "danger" || tone === "warn" ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : null}
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}
