"use client";

/**
 * The page a shared link opens: `/join/<code>` (a join link anyone can use)
 * and `/invite/<token>` (an invitation for one email address).
 *
 * One screen does the whole trip. It names the workspace and who invited
 * you, signs you up or in right here (email, Google, GitHub), and joins the
 * moment you're back — no second click, no detour through /signup — then
 * drops you inside the workspace. Someone already signed in clicks Join
 * once; they are never joined without that click (see `~/lib/join-handoff`).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldCheck } from "lucide-react";

import { AuthChrome } from "~/app/_components/AuthChrome";
import { SignInForm, SignUpForm } from "~/app/_components/CredentialsForm";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useAuth, useUser } from "~/lib/auth-client";
import {
    clearJoinIntent,
    enterWorkspace,
    leaveJoinWelcome,
    rememberJoinIntent,
    takeJoinIntent,
} from "~/lib/join-handoff";
import { resetMyProfile } from "~/lib/profile/use-my-profile";
import { cn } from "~/lib/utils";
import type { SocialProvider } from "~/server/auth/providers";

export type JoinSource = { kind: "link"; code: string } | { kind: "invite"; token: string };

interface JoinDetails {
    workspaceName: string;
    roleName: string;
    invitedBy: string | null;
    requiresApproval: boolean;
    /** Invitations only: the one address it works for. */
    email: string | null;
    /** Invitations only. */
    expiresAt: string | null;
}

type LoadState =
    | { phase: "loading" }
    | { phase: "ready"; details: JoinDetails }
    | { phase: "dead"; message: string }
    | { phase: "error"; message: string };

type JoinState =
    | { phase: "idle" }
    | { phase: "joining" }
    | { phase: "entering"; alreadyMember: boolean }
    | { phase: "pending" }
    | { phase: "mismatch"; invitedEmail: string }
    | { phase: "dead"; message: string }
    | { phase: "error"; message: string };

const NETWORK_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

/** Why a join link can't be used, in words the person holding it can act on. */
export const LINK_PROBLEMS: Record<string, string> = {
    unknown:
        "This invite link doesn't work. Check that you copied all of it, or ask whoever sent it for a new one.",
    expired: "This invite link has expired. Ask whoever sent it for a new one.",
    exhausted: "This invite link has been used as many times as it allows. Ask for a new one.",
    inactive: "This invite link was turned off. Ask whoever sent it for a new one.",
};

const INVITE_GONE =
    "This invitation has expired or was withdrawn. Ask whoever invited you to send a new one.";

function sourceKey(source: JoinSource): string {
    return source.kind === "link" ? source.code : source.token;
}

function selfPath(source: JoinSource): string {
    return source.kind === "link"
        ? `/join/${encodeURIComponent(source.code)}`
        : `/invite/${encodeURIComponent(source.token)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
}

async function loadDetails(source: JoinSource): Promise<LoadState> {
    if (source.kind === "link") {
        const res = await fetch(
            `/api/workspace/join-links/preview?code=${encodeURIComponent(source.code)}`
        );
        if (!res.ok) {
            return {
                phase: "error",
                message: `We couldn't load this invite link (${res.status}). Try again in a moment.`,
            };
        }
        const body = (await res.json()) as {
            valid: boolean;
            reason?: string;
            workspaceName?: string;
            roleName?: string;
            requiresApproval?: boolean;
            invitedBy?: string | null;
        };
        if (!body.valid || !body.workspaceName) {
            return {
                phase: "dead",
                message: LINK_PROBLEMS[body.reason ?? "unknown"] ?? LINK_PROBLEMS.unknown!,
            };
        }
        return {
            phase: "ready",
            details: {
                workspaceName: body.workspaceName,
                roleName: body.roleName ?? "Member",
                invitedBy: body.invitedBy ?? null,
                requiresApproval: body.requiresApproval === true,
                email: null,
                expiresAt: null,
            },
        };
    }

    const res = await fetch(
        `/api/workspace/invitations/preview?token=${encodeURIComponent(source.token)}`
    );
    if (res.status === 404 || res.status === 410) {
        return { phase: "dead", message: await readError(res, INVITE_GONE) };
    }
    if (!res.ok) {
        return {
            phase: "error",
            message: await readError(
                res,
                `We couldn't load this invitation (${res.status}). Try again in a moment.`
            ),
        };
    }
    const body = (await res.json()) as {
        workspaceName: string;
        roleName: string;
        email: string;
        expiresAt: string;
        status: string;
        invitedBy?: string | null;
    };
    if (body.status !== "pending") {
        return {
            phase: "dead",
            message:
                body.status === "accepted"
                    ? "This invitation has already been used. Sign in to open the workspace."
                    : INVITE_GONE,
        };
    }
    return {
        phase: "ready",
        details: {
            workspaceName: body.workspaceName,
            roleName: body.roleName,
            invitedBy: body.invitedBy ?? null,
            requiresApproval: false,
            email: body.email,
            expiresAt: body.expiresAt,
        },
    };
}

export function JoinLanding({
    source,
    socialProviders,
}: {
    source: JoinSource;
    socialProviders: SocialProvider[];
}) {
    const { isLoaded, isSignedIn, signOut } = useAuth();
    const { user } = useUser();
    const key = sourceKey(source);
    const here = selfPath(source);

    const [load, setLoad] = useState<LoadState>({ phase: "loading" });
    const [join, setJoin] = useState<JoinState>({ phase: "idle" });
    const [tab, setTab] = useState<"signup" | "signin">("signup");
    const intentChecked = useRef(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const next = await loadDetails(source);
                if (!cancelled) setLoad(next);
            } catch {
                if (!cancelled) setLoad({ phase: "error", message: NETWORK_MESSAGE });
            }
        })();
        return () => {
            cancelled = true;
        };
        // `source` is rebuilt every render; its key is what identifies it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source.kind, key]);

    const accept = useCallback(
        async (details: JoinDetails) => {
            setJoin({ phase: "joining" });
            try {
                const res =
                    source.kind === "link"
                        ? await fetch("/api/workspace/join-links/accept", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ code: source.code }),
                          })
                        : await fetch("/api/workspace/invitations/accept", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ token: source.token }),
                          });

                if (res.status === 403 && details.email) {
                    setJoin({ phase: "mismatch", invitedEmail: details.email });
                    return;
                }
                if (res.status === 404 || res.status === 410) {
                    setJoin({
                        phase: "dead",
                        message: await readError(
                            res,
                            source.kind === "link" ? LINK_PROBLEMS.unknown! : INVITE_GONE
                        ),
                    });
                    return;
                }
                if (res.status === 401) {
                    setJoin({
                        phase: "error",
                        message: "Your session ended. Sign in again to join.",
                    });
                    return;
                }
                if (!res.ok) {
                    setJoin({
                        phase: "error",
                        message: await readError(res, "We couldn't add you to the workspace."),
                    });
                    return;
                }

                const result = (await res.json()) as {
                    status?: "active" | "pending";
                    redirectTo?: string;
                    alreadyMember?: boolean;
                };
                if (result.status === "pending") {
                    setJoin({ phase: "pending" });
                    return;
                }
                const alreadyMember = result.alreadyMember === true;
                if (!alreadyMember) {
                    leaveJoinWelcome({
                        workspaceName: details.workspaceName,
                        roleName: details.roleName,
                        invitedBy: details.invitedBy,
                    });
                }
                setJoin({ phase: "entering", alreadyMember });
                resetMyProfile();
                enterWorkspace(result.redirectTo ?? "/employer/documents");
            } catch {
                setJoin({ phase: "error", message: NETWORK_MESSAGE });
            }
        },
        [source]
    );

    // Back from signing in or up on this page: join without another click.
    useEffect(() => {
        if (load.phase !== "ready" || !isLoaded || intentChecked.current) return;
        if (!isSignedIn) return;
        intentChecked.current = true;
        if (takeJoinIntent(source.kind, key)) void accept(load.details);
    }, [load, isLoaded, isSignedIn, source.kind, key, accept]);

    const remember = useCallback(() => {
        rememberJoinIntent(source.kind, key);
        // A fresh sign-in on this page should be honoured once it lands.
        intentChecked.current = false;
    }, [source.kind, key]);

    const useDifferentAccount = () => {
        clearJoinIntent();
        setJoin({ phase: "idle" });
        setTab("signin");
        void signOut();
    };

    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col">
            <AuthChrome />
            <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:px-6 sm:py-12">
                <div className="w-full max-w-[460px]">
                    {load.phase === "loading" && (
                        <Card>
                            <p className="text-ink-3 m-0 flex items-center gap-2 text-sm">
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                                Loading your invitation…
                            </p>
                        </Card>
                    )}

                    {(load.phase === "dead" || load.phase === "error") && (
                        <>
                            <Eyebrow>Invitation</Eyebrow>
                            <Card>
                                <Notice tone={load.phase === "dead" ? "muted" : "danger"}>
                                    {load.message}
                                </Notice>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Button asChild variant="outline" size="sm">
                                        <Link href={isSignedIn ? "/" : "/signin"}>
                                            {isSignedIn ? "Go to your workspace" : "Sign in"}
                                        </Link>
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
                        </>
                    )}

                    {load.phase === "ready" && (
                        <Ready
                            details={load.details}
                            source={source}
                            here={here}
                            join={join}
                            tab={tab}
                            setTab={setTab}
                            isLoaded={isLoaded}
                            isSignedIn={isSignedIn}
                            signedInEmail={user?.email ?? null}
                            socialProviders={socialProviders}
                            onAuthStart={remember}
                            onJoin={() => void accept(load.details)}
                            onUseDifferentAccount={useDifferentAccount}
                        />
                    )}
                </div>
            </main>
        </div>
    );
}

function Ready({
    details,
    source,
    here,
    join,
    tab,
    setTab,
    isLoaded,
    isSignedIn,
    signedInEmail,
    socialProviders,
    onAuthStart,
    onJoin,
    onUseDifferentAccount,
}: {
    details: JoinDetails;
    source: JoinSource;
    here: string;
    join: JoinState;
    tab: "signup" | "signin";
    setTab: (tab: "signup" | "signin") => void;
    isLoaded: boolean;
    isSignedIn: boolean;
    signedInEmail: string | null;
    socialProviders: SocialProvider[];
    onAuthStart: () => void;
    onJoin: () => void;
    onUseDifferentAccount: () => void;
}) {
    const { workspaceName, roleName, invitedBy } = details;
    const joinLabel = details.requiresApproval
        ? `Ask to join ${workspaceName}`
        : `Join ${workspaceName}`;
    const busy = join.phase === "joining" || join.phase === "entering";

    return (
        <>
            <div className="bg-brand-soft text-brand mb-4 flex size-11 items-center justify-center rounded-xl text-lg font-bold">
                {workspaceName.trim().charAt(0).toUpperCase() || "W"}
            </div>
            <Eyebrow>You&apos;re invited</Eyebrow>
            <h1 className="display text-ink m-0 mb-2 break-words text-[28px] leading-[1.1] tracking-tight sm:text-[32px]">
                Join {workspaceName}.
            </h1>
            <p className="text-ink-3 m-0 text-sm leading-relaxed">
                {invitedBy ? (
                    <>
                        <span className="text-ink-2 font-medium">{invitedBy}</span> invited you to
                        join as {roleName}.
                    </>
                ) : (
                    <>You&apos;ve been invited to join as {roleName}.</>
                )}
            </p>

            <ul className="m-0 mb-6 mt-4 flex list-none flex-col gap-2 p-0">
                {details.email && (
                    <Fact Icon={ShieldCheck}>
                        For <span className="text-ink-2 font-medium">{details.email}</span>
                    </Fact>
                )}
                {details.expiresAt && (
                    <Fact Icon={Clock}>
                        Expires{" "}
                        {new Date(details.expiresAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                        })}
                    </Fact>
                )}
                {details.requiresApproval && (
                    <Fact Icon={ShieldCheck}>
                        An admin approves new members before they can get in.
                    </Fact>
                )}
            </ul>

            {!isLoaded ? (
                <Card>
                    <p className="text-ink-3 m-0 flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Checking whether you&apos;re signed in…
                    </p>
                </Card>
            ) : !isSignedIn ? (
                <Tabs value={tab} onValueChange={v => setTab(v as "signup" | "signin")}>
                    <TabsList className="mb-4 grid w-full grid-cols-2">
                        <TabsTrigger value="signup">Create account</TabsTrigger>
                        <TabsTrigger value="signin">I have an account</TabsTrigger>
                    </TabsList>
                    <TabsContent value="signup">
                        <SignUpForm
                            defaultEmail={details.email ?? ""}
                            lockEmail={source.kind === "invite"}
                            onAuthStart={onAuthStart}
                            onSignInInstead={() => setTab("signin")}
                            socialProviders={socialProviders}
                            socialRedirectTo={here}
                        />
                    </TabsContent>
                    <TabsContent value="signin">
                        <SignInForm
                            redirectTo={here}
                            newUserRedirectTo={here}
                            socialProviders={socialProviders}
                            defaultEmail={details.email ?? ""}
                            onAuthStart={onAuthStart}
                        />
                    </TabsContent>
                </Tabs>
            ) : (
                <Card>
                    {join.phase === "mismatch" ? (
                        <Notice tone="warn">
                            This invitation is for{" "}
                            <b className="font-semibold">{join.invitedEmail}</b>
                            {signedInEmail ? (
                                <>
                                    , but you&apos;re signed in as{" "}
                                    <b className="font-semibold">{signedInEmail}</b>.
                                </>
                            ) : (
                                "."
                            )}{" "}
                            Use that address, or ask for an invitation to this one.
                        </Notice>
                    ) : join.phase === "pending" ? (
                        <Notice tone="ok">
                            <CheckCircle2 className="mr-1.5 inline size-4 align-[-3px]" />
                            Request sent. An admin of {workspaceName} needs to approve you —
                            you&apos;ll get in as soon as they do.
                        </Notice>
                    ) : join.phase === "dead" ? (
                        <Notice tone="muted">{join.message}</Notice>
                    ) : join.phase === "error" ? (
                        <Notice tone="danger">{join.message}</Notice>
                    ) : join.phase === "entering" ? (
                        <Notice tone="ok">
                            <CheckCircle2 className="mr-1.5 inline size-4 align-[-3px]" />
                            {join.alreadyMember
                                ? `You're already in ${workspaceName}. Opening it…`
                                : `You're in. Opening ${workspaceName}…`}
                        </Notice>
                    ) : join.phase === "joining" ? (
                        <p className="text-ink-2 m-0 flex items-center gap-2 text-sm">
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            Joining {workspaceName}…
                        </p>
                    ) : (
                        <p className="text-ink-2 m-0 text-sm">
                            Signed in as <b className="font-semibold">{signedInEmail ?? "you"}</b>.
                        </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                        {join.phase === "mismatch" ? (
                            <Button onClick={onUseDifferentAccount}>
                                Sign out and use {join.invitedEmail}
                            </Button>
                        ) : join.phase === "pending" ? (
                            <Button asChild>
                                <Link href="/">Continue</Link>
                            </Button>
                        ) : join.phase === "dead" ? null : (
                            <Button onClick={onJoin} disabled={busy} aria-busy={busy}>
                                {busy && <Loader2 className="animate-spin" aria-hidden />}
                                {joinLabel}
                            </Button>
                        )}
                        {join.phase !== "mismatch" && join.phase !== "entering" && (
                            <Button variant="ghost" onClick={onUseDifferentAccount} disabled={busy}>
                                Use a different account
                            </Button>
                        )}
                    </div>
                </Card>
            )}
        </>
    );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
    return (
        <div className="mono text-ink-3 mb-2.5 text-[10px] font-bold uppercase tracking-[0.12em]">
            {children}
        </div>
    );
}

function Card({ children }: { children: React.ReactNode }) {
    return <div className="border-line bg-panel rounded-xl border p-5">{children}</div>;
}

function Fact({
    Icon,
    children,
}: {
    Icon: React.ComponentType<{ className?: string }>;
    children: React.ReactNode;
}) {
    return (
        <li className="text-ink-3 flex items-start gap-2 text-[13px] leading-relaxed">
            <Icon className="text-ink-4 mt-0.5 size-[15px] shrink-0" />
            <span className="min-w-0 break-words">{children}</span>
        </li>
    );
}

function Notice({
    tone,
    children,
}: {
    tone: "ok" | "warn" | "danger" | "muted";
    children: React.ReactNode;
}) {
    return (
        <div
            role={tone === "danger" ? "alert" : "status"}
            className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed",
                tone === "ok" && "bg-success-soft text-success",
                tone === "warn" && "bg-warn-soft text-ink-2",
                tone === "danger" && "bg-danger-soft text-danger",
                tone === "muted" && "bg-panel-2 text-ink-2"
            )}
        >
            {tone === "danger" || tone === "warn" ? (
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
            ) : null}
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}
