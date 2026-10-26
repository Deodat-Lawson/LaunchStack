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
import { useFormatter, useTranslations } from "next-intl";

import { AuthChrome } from "~/app/_components/AuthChrome";
import { SignInForm, SignUpForm } from "~/app/_components/CredentialsForm";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useAuth, useUser } from "~/lib/auth-client";
import { isBuiltinRole, normalizeRoleSlug } from "~/lib/authz/permissions";
import {
    clearJoinIntent,
    enterWorkspace,
    hasJoinIntent,
    leaveJoinWelcome,
    rememberJoinIntent,
} from "~/lib/join-handoff";
import { resetMyProfile } from "~/lib/profile/use-my-profile";
import { cn } from "~/lib/utils";
import type { SocialProvider } from "~/server/auth/providers";

export type JoinSource = { kind: "link"; code: string } | { kind: "invite"; token: string };

interface JoinDetails {
    workspaceName: string;
    /** The role's slug, when the server sent one: a built-in role is named in the reader's language. */
    role: string | null;
    /** The server's name for the role (a custom role's own name). */
    roleName: string;
    invitedBy: string | null;
    requiresApproval: boolean;
    /** Invitations only: the one address it works for. */
    email: string | null;
    /** Invitations only. */
    expiresAt: string | null;
}

/**
 * Something to tell the person: one of this page's own sentences
 * (`auth.join.problems`), or a sentence the server wrote, shown as it came.
 * Kept as a key rather than a string so it follows a change of language.
 */
type Problem =
    | {
          key:
              | "network"
              | "linkUnknown"
              | "linkExpired"
              | "linkExhausted"
              | "linkInactive"
              | "inviteGone"
              | "inviteUsed"
              | "sessionEnded"
              | "joinFailed";
      }
    | { key: "linkLoadFailed" | "inviteLoadFailed"; status: number }
    | { text: string };

type LoadState =
    | { phase: "loading" }
    | { phase: "ready"; details: JoinDetails }
    | { phase: "dead"; problem: Problem }
    | { phase: "error"; problem: Problem };

type JoinState =
    | { phase: "idle" }
    | { phase: "joining" }
    | { phase: "entering"; alreadyMember: boolean }
    | { phase: "pending" }
    | { phase: "mismatch"; invitedEmail: string }
    | { phase: "dead"; problem: Problem }
    | { phase: "error"; problem: Problem };

const NETWORK: Problem = { key: "network" };

/** Why a join link can't be used, in words the person holding it can act on. */
const LINK_PROBLEMS: Record<string, Problem> = {
    unknown: { key: "linkUnknown" },
    expired: { key: "linkExpired" },
    exhausted: { key: "linkExhausted" },
    inactive: { key: "linkInactive" },
};

const INVITE_GONE: Problem = { key: "inviteGone" };

function useProblemText(): (problem: Problem) => string {
    const t = useTranslations("auth.join.problems");
    return problem => {
        if ("text" in problem) return problem.text;
        if (problem.key === "linkLoadFailed" || problem.key === "inviteLoadFailed") {
            return t(problem.key, { status: problem.status });
        }
        return t(problem.key);
    };
}

/** A built-in role in the reader's language; a custom role by its own name. */
function useRoleName(): (details: Pick<JoinDetails, "role" | "roleName">) => string {
    const t = useTranslations("auth.roles");
    return ({ role, roleName }) => {
        const slug = role ? normalizeRoleSlug(role) : null;
        return slug && isBuiltinRole(slug) ? t(slug) : roleName;
    };
}

function sourceKey(source: JoinSource): string {
    return source.kind === "link" ? source.code : source.token;
}

function selfPath(source: JoinSource): string {
    return source.kind === "link"
        ? `/join/${encodeURIComponent(source.code)}`
        : `/invite/${encodeURIComponent(source.token)}`;
}

async function readError(res: Response, fallback: Problem): Promise<Problem> {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    return typeof body.error === "string" ? { text: body.error } : fallback;
}

async function loadDetails(source: JoinSource): Promise<LoadState> {
    if (source.kind === "link") {
        const res = await fetch(
            `/api/workspace/join-links/preview?code=${encodeURIComponent(source.code)}`
        );
        if (!res.ok) {
            return { phase: "error", problem: { key: "linkLoadFailed", status: res.status } };
        }
        const body = (await res.json()) as {
            valid: boolean;
            reason?: string;
            workspaceName?: string;
            role?: string;
            roleName?: string;
            requiresApproval?: boolean;
            invitedBy?: string | null;
        };
        if (!body.valid || !body.workspaceName) {
            return {
                phase: "dead",
                problem: LINK_PROBLEMS[body.reason ?? "unknown"] ?? LINK_PROBLEMS.unknown!,
            };
        }
        return {
            phase: "ready",
            details: {
                workspaceName: body.workspaceName,
                // No role at all reads as an ordinary member.
                role: body.role ?? (body.roleName ? null : "member"),
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
        return { phase: "dead", problem: await readError(res, INVITE_GONE) };
    }
    if (!res.ok) {
        return {
            phase: "error",
            problem: await readError(res, { key: "inviteLoadFailed", status: res.status }),
        };
    }
    const body = (await res.json()) as {
        workspaceName: string;
        role?: string;
        roleName: string;
        email: string;
        expiresAt: string;
        status: string;
        invitedBy?: string | null;
    };
    if (body.status !== "pending") {
        return {
            phase: "dead",
            problem: body.status === "accepted" ? { key: "inviteUsed" } : INVITE_GONE,
        };
    }
    return {
        phase: "ready",
        details: {
            workspaceName: body.workspaceName,
            role: body.role ?? null,
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
    const t = useTranslations("auth.join");
    const tc = useTranslations("common.actions");
    const problemText = useProblemText();
    const roleNameOf = useRoleName();
    const { isLoaded, isSignedIn, signOut } = useAuth();
    const { user } = useUser();
    const key = sourceKey(source);
    const here = selfPath(source);

    const [load, setLoad] = useState<LoadState>({ phase: "loading" });
    const [join, setJoin] = useState<JoinState>({ phase: "idle" });
    const [tab, setTab] = useState<"signup" | "signin">("signup");
    const intentChecked = useRef(false);
    // Email sign-in reloads the page once it succeeds (CredentialsForm). The
    // session can arrive here a moment before that navigation, and a join
    // started now would be cut off with the outgoing page — so this page
    // leaves the joining to the one that loads next.
    const reloadPending = useRef(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const next = await loadDetails(source);
                if (!cancelled) setLoad(next);
            } catch {
                if (!cancelled) setLoad({ phase: "error", problem: NETWORK });
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

                // The server has answered: whatever it said, the intent is spent.
                clearJoinIntent();
                if (res.status === 403 && details.email) {
                    setJoin({ phase: "mismatch", invitedEmail: details.email });
                    return;
                }
                if (res.status === 404 || res.status === 410) {
                    const fallback = await readError(
                        res,
                        source.kind === "link" ? LINK_PROBLEMS.unknown! : INVITE_GONE
                    );
                    // It died after the page loaded; ask again so the reason
                    // reads the same as it would have on arrival.
                    const now = await loadDetails(source).catch(() => null);
                    setJoin({
                        phase: "dead",
                        problem: now?.phase === "dead" ? now.problem : fallback,
                    });
                    return;
                }
                if (res.status === 401) {
                    setJoin({ phase: "error", problem: { key: "sessionEnded" } });
                    return;
                }
                if (!res.ok) {
                    setJoin({
                        phase: "error",
                        problem: await readError(res, { key: "joinFailed" }),
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
                        roleName: roleNameOf(details),
                        invitedBy: details.invitedBy,
                    });
                }
                setJoin({ phase: "entering", alreadyMember });
                resetMyProfile();
                enterWorkspace(result.redirectTo ?? "/employer/documents");
            } catch {
                // No answer — possibly cut off by a navigation. The intent stays,
                // so the next load of this page tries again.
                setJoin({ phase: "error", problem: NETWORK });
            }
        },
        // `roleNameOf` follows the language; the welcome takes whichever is current.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [source]
    );

    // Back from signing in or up on this page: join without another click.
    useEffect(() => {
        if (load.phase !== "ready" || !isLoaded || intentChecked.current) return;
        if (!isSignedIn || reloadPending.current) return;
        intentChecked.current = true;
        if (hasJoinIntent(source.kind, key)) void accept(load.details);
    }, [load, isLoaded, isSignedIn, source.kind, key, accept]);

    /** Sign-up and social sign-in: this page (or the one OAuth returns to) joins. */
    const remember = useCallback(() => {
        rememberJoinIntent(source.kind, key);
        reloadPending.current = false;
        intentChecked.current = false;
    }, [source.kind, key]);

    /** Email sign-in: the reload that follows success does the joining. */
    const rememberForReload = useCallback(() => {
        rememberJoinIntent(source.kind, key);
        reloadPending.current = true;
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
                                {t("loading")}
                            </p>
                        </Card>
                    )}

                    {(load.phase === "dead" || load.phase === "error") && (
                        <>
                            <h1 className="display text-ink m-0 mb-3 text-[22px] leading-[1.15] tracking-tight">
                                {t("eyebrowInvitation")}
                            </h1>
                            <Card>
                                <Notice tone={load.phase === "dead" ? "muted" : "danger"}>
                                    {problemText(load.problem)}
                                </Notice>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Button asChild variant="outline" size="sm">
                                        <Link href={isSignedIn ? "/" : "/signin"}>
                                            {isSignedIn ? t("goToWorkspace") : tc("signIn")}
                                        </Link>
                                    </Button>
                                    {load.phase === "error" && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => window.location.reload()}
                                        >
                                            {tc("tryAgain")}
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
                            onSignInStart={rememberForReload}
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
    onSignInStart,
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
    onSignInStart: () => void;
    onJoin: () => void;
    onUseDifferentAccount: () => void;
}) {
    const t = useTranslations("auth.join");
    const tc = useTranslations("common.actions");
    const format = useFormatter();
    const problemText = useProblemText();
    const roleName = useRoleName()(details);
    const { workspaceName: workspace, invitedBy } = details;
    const joinLabel = details.requiresApproval
        ? t("askToJoin", { workspace })
        : t("join", { workspace });
    const busy = join.phase === "joining" || join.phase === "entering";
    const bold = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;

    return (
        <>
            <div className="bg-brand-soft text-brand mb-4 flex size-11 items-center justify-center rounded-xl text-lg font-bold">
                {workspace.trim().charAt(0).toUpperCase() || "W"}
            </div>
            <h1 className="display text-ink m-0 mb-2 break-words text-[28px] leading-[1.1] tracking-tight sm:text-[32px]">
                {t("title", { workspace })}
            </h1>
            <p className="text-ink-3 m-0 text-sm leading-relaxed">
                {invitedBy
                    ? t.rich("invitedBy", {
                          inviter: invitedBy,
                          role: roleName,
                          name: chunks => <span className="text-ink-2 font-medium">{chunks}</span>,
                      })
                    : t("invited", { role: roleName })}
            </p>

            <ul className="m-0 mb-6 mt-4 flex list-none flex-col gap-2 p-0">
                {details.email && (
                    <Fact Icon={ShieldCheck}>
                        {t.rich("forEmail", {
                            email: details.email,
                            b: chunks => <span className="text-ink-2 font-medium">{chunks}</span>,
                        })}
                    </Fact>
                )}
                {details.expiresAt && (
                    <Fact Icon={Clock}>
                        {t("expires", {
                            date: format.dateTime(new Date(details.expiresAt), {
                                dateStyle: "medium",
                                timeStyle: "short",
                            }),
                        })}
                    </Fact>
                )}
                {details.requiresApproval && <Fact Icon={ShieldCheck}>{t("approval")}</Fact>}
            </ul>

            {!isLoaded ? (
                <Card>
                    <p className="text-ink-3 m-0 flex items-center gap-2 text-sm">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        {t("checking")}
                    </p>
                </Card>
            ) : !isSignedIn ? (
                <Tabs value={tab} onValueChange={v => setTab(v as "signup" | "signin")}>
                    <TabsList className="mb-4 grid w-full grid-cols-2">
                        <TabsTrigger value="signup">{t("tabs.signUp")}</TabsTrigger>
                        <TabsTrigger value="signin">{t("tabs.signIn")}</TabsTrigger>
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
                            onAuthStart={onSignInStart}
                        />
                    </TabsContent>
                </Tabs>
            ) : (
                <Card>
                    {join.phase === "mismatch" ? (
                        <Notice tone="warn">
                            {signedInEmail
                                ? t.rich("mismatch", {
                                      invited: join.invitedEmail,
                                      current: signedInEmail,
                                      b: bold,
                                  })
                                : t.rich("mismatchNoCurrent", {
                                      invited: join.invitedEmail,
                                      b: bold,
                                  })}
                        </Notice>
                    ) : join.phase === "pending" ? (
                        <Notice tone="ok">
                            <CheckCircle2 className="mr-1.5 inline size-4 align-[-3px]" />
                            {t("requestSent", { workspace })}
                        </Notice>
                    ) : join.phase === "dead" ? (
                        <Notice tone="muted">{problemText(join.problem)}</Notice>
                    ) : join.phase === "error" ? (
                        <Notice tone="danger">{problemText(join.problem)}</Notice>
                    ) : join.phase === "entering" ? (
                        <Notice tone="ok">
                            <CheckCircle2 className="mr-1.5 inline size-4 align-[-3px]" />
                            {join.alreadyMember
                                ? t("alreadyIn", { workspace })
                                : t("youreIn", { workspace })}
                        </Notice>
                    ) : join.phase === "joining" ? (
                        <p className="text-ink-2 m-0 flex items-center gap-2 text-sm">
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            {t("joining", { workspace })}
                        </p>
                    ) : (
                        <p className="text-ink-2 m-0 text-sm">
                            {signedInEmail
                                ? t.rich("signedInAs", { email: signedInEmail, b: bold })
                                : t.rich("signedInAsYou", { b: bold })}
                        </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                        {join.phase === "mismatch" ? (
                            <Button onClick={onUseDifferentAccount}>
                                {t("useAddress", { email: join.invitedEmail })}
                            </Button>
                        ) : join.phase === "pending" ? (
                            <Button asChild>
                                <Link href="/">{tc("continue")}</Link>
                            </Button>
                        ) : join.phase === "dead" ? null : (
                            <Button onClick={onJoin} disabled={busy} aria-busy={busy}>
                                {busy && <Loader2 className="animate-spin" aria-hidden />}
                                {joinLabel}
                            </Button>
                        )}
                        {join.phase !== "mismatch" && join.phase !== "entering" && (
                            <Button variant="ghost" onClick={onUseDifferentAccount} disabled={busy}>
                                {t("differentAccount")}
                            </Button>
                        )}
                    </div>
                </Card>
            )}
        </>
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
                tone === "ok" && "bg-success-soft text-success-ink",
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
