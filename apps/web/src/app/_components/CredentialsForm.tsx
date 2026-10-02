"use client";

/**
 * Email + password forms for /signin and /signup. These replace the embedded
 * Clerk widgets: the fields talk to our own /api/auth/* (better-auth), so
 * the whole flow is first-party.
 *
 * On success, sign-in hands the user to "/" — the middleware fans them out
 * to the right dashboard by DB role, exactly as it always has. Sign-up stays
 * on /signup: the session hook updates and the page flips to its
 * pick-a-path registration step.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, MailCheck } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { PasswordInput } from "~/components/auth/password-input";
import {
    NETWORK_ERROR,
    parseRetryAfter,
    rateLimitMessage,
    signInFailureMessage,
    type AuthFailure,
} from "~/components/auth/auth-errors";
import { withNext } from "~/components/auth/next-path";
import { IconGithub, IconGoogle } from "~/components/icons/brand";
import type { IconComponent } from "~/components/icons/types";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import type { SocialProvider } from "~/server/auth/providers";

const SOCIAL: Record<SocialProvider, { label: string; Icon: IconComponent }> = {
    google: { label: "Google", Icon: IconGoogle },
    github: { label: "GitHub", Icon: IconGithub },
};

/** How long "Resend link" stays disabled after a reset email goes out. */
const RESEND_COOLDOWN_S = 30;

/** Attributes every email field on the auth screens shares (mobile keyboards, no autocorrect). */
const EMAIL_FIELD = {
    type: "email",
    inputMode: "email",
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false,
} as const;

type BetterAuthResult = { error: { status: number; message?: string } | null };
type FetchHooks = { onError: (ctx: { response: Response }) => void };

/**
 * Runs one better-auth client call and folds its three failure shapes — an
 * error result, a 429 whose wait is only in a header, and a thrown network
 * error — into one AuthFailure. `null` means it succeeded.
 */
async function attempt(
    call: (hooks: FetchHooks) => Promise<BetterAuthResult>
): Promise<AuthFailure | null> {
    let retryAfter: number | null = null;
    try {
        const { error } = await call({
            onError: ({ response }) => {
                retryAfter = parseRetryAfter(response.headers.get("X-Retry-After"));
            },
        });
        if (!error) return null;
        return { status: error.status || 0, message: error.message, retryAfter };
    } catch {
        return { status: 0 };
    }
}

/** Whole seconds left until `deadline` (epoch ms), ticking while above zero. */
function useSecondsUntil(deadline: number | null): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (deadline === null) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
    }, [deadline]);
    return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
}

function ErrorText({ id, children }: { id?: string; children: React.ReactNode }) {
    return (
        <p id={id} role="alert" className="text-danger m-0 text-[12.5px] leading-normal">
            {children}
        </p>
    );
}

function LastUsedBadge({ className }: { className?: string }) {
    return (
        <Badge
            variant="info"
            className={cn("px-1.5 py-0 font-mono text-[9.5px] uppercase tracking-wider", className)}
        >
            Last used
        </Badge>
    );
}

function SubmitButton({
    pending,
    disabled,
    children,
}: {
    pending: boolean;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <Button type="submit" disabled={pending || disabled} aria-busy={pending} className="w-full">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {children}
        </Button>
    );
}

type View = "signin" | "forgot" | "sent";
type Pending = "email" | "reset" | SocialProvider | null;
type FormError = { message: React.ReactNode; field?: "email" | "password"; rateLimited?: boolean };

export function SignInForm({
    /**
     * Where to land after a successful sign-in. Defaults to "/", which the
     * middleware fans out by membership; an invitation page passes itself so
     * the person comes straight back to "Join".
     */
    redirectTo = "/",
    /** Providers this deployment has credentials for; one button each. */
    socialProviders = [],
    /** `forgot` opens straight on the reset-link form (from an expired reset link). */
    initialView = "signin",
}: {
    redirectTo?: string;
    socialProviders?: SocialProvider[];
    initialView?: "signin" | "forgot";
} = {}) {
    const [view, setView] = useState<View>(initialView);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(true);
    const [error, setError] = useState<FormError | null>(null);
    const [pending, setPending] = useState<Pending>(null);
    // Read after mount: the cookie is client-only, and reading it during
    // render would disagree with the server's HTML.
    const [lastMethod, setLastMethod] = useState<string | null>(null);
    const [retryAt, setRetryAt] = useState<number | null>(null);
    const [resendAt, setResendAt] = useState<number | null>(null);

    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const sentHeadingRef = useRef<HTMLDivElement>(null);
    const errorId = useId();

    const lockedFor = useSecondsUntil(retryAt);
    const resendIn = useSecondsUntil(resendAt);

    useEffect(() => {
        setLastMethod(authClient.getLastUsedLoginMethod());
    }, []);

    // Put the cursor where the next keystroke belongs. On first load, only
    // when nothing else has focus — never yank it from a field the person
    // (or their password manager) already chose.
    const firstFocus = useRef(true);
    useEffect(() => {
        const isFirst = firstFocus.current;
        firstFocus.current = false;
        if (isFirst && document.activeElement && document.activeElement !== document.body) return;
        if (view === "sent") sentHeadingRef.current?.focus();
        else emailRef.current?.focus();
    }, [view]);

    // A rate-limit lockout clears itself when the wait is over.
    useEffect(() => {
        if (retryAt !== null && lockedFor === 0) {
            setRetryAt(null);
            setError(e => (e?.rateLimited ? null : e));
        }
    }, [retryAt, lockedFor]);

    const fail = (failure: AuthFailure, message: React.ReactNode, field?: FormError["field"]) => {
        const rateLimited = failure.status === 429;
        setError({ message, field, rateLimited });
        if (rateLimited) setRetryAt(Date.now() + (failure.retryAfter ?? 10) * 1000);
        setPending(null);
        if (field === "password") {
            passwordRef.current?.focus();
            passwordRef.current?.select();
        } else if (field === "email") {
            emailRef.current?.focus();
        }
    };

    const switchView = (next: View) => {
        setError(null);
        setView(next);
    };

    const submitSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setPending("email");
        const failure = await attempt(hooks =>
            authClient.signIn.email({ email: email.trim(), password, rememberMe }, hooks)
        );
        if (failure) {
            const wrongCredentials = failure.status === 401 || failure.status === 400;
            fail(failure, signInFailureMessage(failure), wrongCredentials ? "password" : undefined);
            return;
        }
        // Full navigation on purpose: middleware routes a fresh session to
        // the right dashboard by DB role. `pending` stays set until it lands.
        window.location.assign(redirectTo);
    };

    const sendResetLink = async () => {
        setError(null);
        setPending("reset");
        const failure = await attempt(hooks =>
            authClient.requestPasswordReset(
                { email: email.trim(), redirectTo: "/reset-password" },
                hooks
            )
        );
        // Any answer from the server reads the same whether or not the
        // address has an account — no probing. Only a request that never
        // arrived, or one that was throttled, is worth telling apart.
        if (failure?.status === 0) return fail(failure, NETWORK_ERROR, "email");
        if (failure?.status === 429) return fail(failure, rateLimitMessage(failure.retryAfter));
        setPending(null);
        setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000);
        setView("sent");
    };

    const startSocial = async (provider: SocialProvider) => {
        setError(null);
        setPending(provider);
        const next = redirectTo === "/" ? null : redirectTo;
        const failure = await attempt(hooks =>
            authClient.signIn.social(
                {
                    provider,
                    callbackURL: redirectTo,
                    // A first-time social sign-in has an account but no
                    // workspace yet; registration lives on /signup.
                    newUserCallbackURL: withNext("/signup", next),
                    errorCallbackURL: withNext(`/signin?provider=${provider}`, next),
                },
                hooks
            )
        );
        // On success better-auth sends the window to the provider; leave
        // the button spinning until it goes.
        if (failure) {
            fail(
                failure,
                failure.status === 0
                    ? NETWORK_ERROR
                    : failure.status === 429
                      ? rateLimitMessage(failure.retryAfter)
                      : `Couldn't start ${SOCIAL[provider].label} sign-in. Try again in a moment.`
            );
        }
    };

    if (view === "sent") {
        return (
            <div className="border-line bg-panel flex flex-col gap-3 rounded-xl border p-5">
                <div className="bg-brand-soft text-brand flex size-9 items-center justify-center rounded-lg">
                    <MailCheck className="size-4" aria-hidden />
                </div>
                <div
                    ref={sentHeadingRef}
                    tabIndex={-1}
                    className="text-ink text-sm font-semibold outline-none"
                >
                    Check your email
                </div>
                <p className="text-ink-3 m-0 text-[13px] leading-relaxed">
                    If an account exists for <span className="text-ink font-medium">{email}</span>,
                    a reset link is on its way. It expires in an hour — check spam if it
                    doesn&rsquo;t arrive in a minute or two.
                </p>
                {error && <ErrorText>{error.message}</ErrorText>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={resendIn > 0 || lockedFor > 0 || pending !== null}
                        onClick={() => void sendResetLink()}
                    >
                        {pending === "reset" && <Loader2 className="animate-spin" aria-hidden />}
                        {resendIn > 0 ? `Resend link in ${resendIn}s` : "Resend link"}
                    </Button>
                    <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="text-ink-3 h-auto px-0"
                        onClick={() => switchView("forgot")}
                    >
                        Use a different email
                    </Button>
                </div>
                <Separator />
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto self-start px-0"
                    onClick={() => switchView("signin")}
                >
                    <ArrowLeft aria-hidden />
                    Back to sign in
                </Button>
            </div>
        );
    }

    const forgot = view === "forgot";
    const busy = pending !== null;
    const describedBy = error ? errorId : undefined;

    return (
        <div className="flex flex-col gap-4">
            {!forgot && socialProviders.length > 0 && (
                <>
                    <div className="flex flex-col gap-2">
                        {socialProviders.map(provider => {
                            const { label, Icon } = SOCIAL[provider];
                            return (
                                <Button
                                    key={provider}
                                    type="button"
                                    variant="outline"
                                    className="relative h-10 w-full"
                                    disabled={busy || lockedFor > 0}
                                    aria-busy={pending === provider}
                                    onClick={() => void startSocial(provider)}
                                >
                                    {pending === provider ? (
                                        <Loader2 className="animate-spin" aria-hidden />
                                    ) : (
                                        <Icon size={16} />
                                    )}
                                    Continue with {label}
                                    {lastMethod === provider && (
                                        <LastUsedBadge className="absolute -top-2 right-3" />
                                    )}
                                </Button>
                            );
                        })}
                    </div>
                    <div className="text-ink-4 flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.12em]">
                        <Separator className="flex-1" />
                        <span className="flex items-center gap-2">
                            or use email
                            {lastMethod === "email" && <LastUsedBadge />}
                        </span>
                        <Separator className="flex-1" />
                    </div>
                </>
            )}

            <form
                method="post"
                onSubmit={
                    forgot
                        ? e => {
                              e.preventDefault();
                              void sendResetLink();
                          }
                        : e => void submitSignIn(e)
                }
                className="border-line bg-panel flex flex-col gap-3.5 rounded-xl border p-5"
            >
                {forgot && (
                    <div className="flex flex-col gap-1">
                        <div className="text-ink text-sm font-semibold">Reset your password</div>
                        <p className="text-ink-3 m-0 text-[12.5px] leading-relaxed">
                            Enter the email you sign in with and we&rsquo;ll send you a link to
                            choose a new password.
                        </p>
                    </div>
                )}
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                        ref={emailRef}
                        id="signin-email"
                        name="email"
                        {...EMAIL_FIELD}
                        // "username", not "email": what password managers
                        // key a saved login on, whatever the field holds.
                        autoComplete="username"
                        required
                        value={email}
                        onChange={e => {
                            setEmail(e.target.value);
                            if (error?.field === "email") setError(null);
                        }}
                        aria-invalid={error?.field === "email" || undefined}
                        aria-describedby={describedBy}
                        placeholder="you@example.com"
                    />
                </div>
                {!forgot && (
                    <div className="relative flex flex-col gap-1.5">
                        <Label htmlFor="signin-password">Password</Label>
                        <PasswordInput
                            ref={passwordRef}
                            id="signin-password"
                            name="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={e => {
                                setPassword(e.target.value);
                                if (error?.field === "password") setError(null);
                            }}
                            aria-invalid={error?.field === "password" || undefined}
                            aria-describedby={describedBy}
                        />
                        {/*
                          After the field in the DOM, beside its label on screen:
                          Tab from email must land in the password, not here.
                        */}
                        <Button
                            type="button"
                            variant="link"
                            className="text-ink-3 hover:text-brand absolute right-0 top-0.5 h-auto p-0 text-[11.5px] font-medium leading-none"
                            onClick={() => switchView("forgot")}
                        >
                            Forgot password?
                        </Button>
                    </div>
                )}
                {!forgot && (
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="signin-remember"
                            checked={rememberMe}
                            onCheckedChange={checked => setRememberMe(checked === true)}
                        />
                        <Label
                            htmlFor="signin-remember"
                            className="text-ink-2 text-[12.5px] font-normal"
                        >
                            Keep me signed in
                        </Label>
                    </div>
                )}
                {error && <ErrorText id={errorId}>{error.message}</ErrorText>}
                <SubmitButton
                    pending={pending === (forgot ? "reset" : "email")}
                    disabled={busy || lockedFor > 0}
                >
                    {lockedFor > 0
                        ? `Try again in ${lockedFor}s`
                        : forgot
                          ? pending === "reset"
                              ? "Sending…"
                              : "Email me a reset link"
                          : pending === "email"
                            ? "Signing in…"
                            : "Sign in"}
                </SubmitButton>
                {forgot && (
                    <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="text-ink-3 h-auto self-center px-0"
                        onClick={() => switchView("signin")}
                    >
                        <ArrowLeft aria-hidden />
                        Back to sign in
                    </Button>
                )}
            </form>
        </div>
    );
}

export function SignUpForm({ signInHref = "/signin" }: { signInHref?: string } = {}) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<React.ReactNode>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const passwordHintId = useId();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);
        const failure = await attempt(hooks =>
            authClient.signUp.email({ name: name.trim(), email: email.trim(), password }, hooks)
        );
        if (failure) {
            setError(
                failure.status === 422 ? (
                    <>
                        An account with this email already exists.{" "}
                        <Link href={signInHref} className="text-brand font-semibold">
                            Sign in instead →
                        </Link>
                    </>
                ) : failure.status === 0 ? (
                    NETWORK_ERROR
                ) : failure.status === 429 ? (
                    rateLimitMessage(failure.retryAfter)
                ) : (
                    (failure.message ?? "Sign-up failed. Try again in a moment.")
                )
            );
            setIsSubmitting(false);
            return;
        }
        // No navigation: the session hook updates and this page re-renders
        // into its registration step (solo / invite / team).
    };

    const longEnough = password.length >= 8;

    return (
        <form
            method="post"
            onSubmit={e => void submit(e)}
            className="border-line bg-panel flex flex-col gap-3.5 rounded-xl border p-5"
        >
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-name">Name</Label>
                <Input
                    id="signup-name"
                    name="name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Ada Lovelace"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                    id="signup-email"
                    name="email"
                    {...EMAIL_FIELD}
                    autoComplete="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-password">Password</Label>
                <PasswordInput
                    id="signup-password"
                    name="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    aria-describedby={passwordHintId}
                />
                <p
                    id={passwordHintId}
                    className={cn(
                        "m-0 flex items-center gap-1 text-[11.5px] transition-colors",
                        longEnough ? "text-success" : "text-ink-3"
                    )}
                >
                    {longEnough && <Check className="size-3" aria-hidden />}
                    At least 8 characters
                </p>
            </div>
            {error && <ErrorText>{error}</ErrorText>}
            <SubmitButton pending={isSubmitting}>
                {isSubmitting ? "Creating account…" : "Create account"}
            </SubmitButton>
        </form>
    );
}
