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
 *
 * The join pages (`/join/<code>`, `/invite/<token>`) embed both forms and
 * point every success path — email or social, new account or existing — back
 * at themselves, so the person joins without detouring through /signup.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { PasswordInput } from "~/components/auth/password-input";
import {
    networkErrorMessage,
    parseRetryAfter,
    rateLimitMessage,
    signInFailureMessage,
    type AuthErrorsTranslator,
    type AuthFailure,
} from "~/components/auth/auth-errors";
import { withNext } from "~/components/auth/next-path";
import { IconGithub, IconGoogle } from "~/components/icons/brand";
import type { IconComponent } from "~/components/icons/types";
import { authClient, oauthFlowRedirect } from "~/lib/auth-client";
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

/** Where better-auth sends the window after a social sign-in, by outcome. */
interface SocialTargets {
    callbackURL: string;
    newUserCallbackURL: string;
    errorCallbackURL: string;
}

function startSocialSignIn(provider: SocialProvider, targets: SocialTargets) {
    return attempt(hooks => authClient.signIn.social({ provider, ...targets }, hooks));
}

function socialFailureMessage(
    provider: SocialProvider,
    failure: AuthFailure,
    t: AuthErrorsTranslator
): React.ReactNode {
    return failure.status === 0
        ? networkErrorMessage(t)
        : failure.status === 429
          ? rateLimitMessage(failure.retryAfter, t)
          : t("socialStartFailed", { provider: SOCIAL[provider].label });
}

function SocialButtons({
    providers,
    pending,
    disabled,
    lastMethod,
    onStart,
    divider,
}: {
    providers: SocialProvider[];
    pending: string | null;
    disabled: boolean;
    lastMethod: string | null;
    onStart: (provider: SocialProvider) => void;
    divider?: string;
}) {
    const t = useTranslations("auth.form");
    return (
        <>
            <div className="flex flex-col gap-2">
                {providers.map(provider => {
                    const { label, Icon } = SOCIAL[provider];
                    return (
                        <Button
                            key={provider}
                            type="button"
                            variant="outline"
                            className="relative h-10 w-full"
                            disabled={disabled}
                            aria-busy={pending === provider}
                            onClick={() => onStart(provider)}
                        >
                            {pending === provider ? (
                                <Loader2 className="animate-spin" aria-hidden />
                            ) : (
                                <Icon size={16} />
                            )}
                            {t("continueWith", { provider: label })}
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
                    {divider ?? t("orUseEmail")}
                    {lastMethod === "email" && <LastUsedBadge />}
                </span>
                <Separator className="flex-1" />
            </div>
        </>
    );
}

function LastUsedBadge({ className }: { className?: string }) {
    const t = useTranslations("auth.form");
    return (
        <Badge
            variant="info"
            className={cn("px-1.5 py-0 font-mono text-[9.5px] uppercase tracking-wider", className)}
        >
            {t("lastUsed")}
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
    /** Prefills the email field (an invitation knows who it was sent to). */
    defaultEmail = "",
    /**
     * Where a first-time social sign-in lands. Defaults to /signup, which
     * registers them; a join page passes itself, since joining registers too.
     */
    newUserRedirectTo,
    /** Runs as a sign-in starts, before any navigation (the join intent). */
    onAuthStart,
}: {
    redirectTo?: string;
    socialProviders?: SocialProvider[];
    initialView?: "signin" | "forgot";
    defaultEmail?: string;
    newUserRedirectTo?: string;
    onAuthStart?: () => void;
} = {}) {
    const t = useTranslations("auth.form");
    const te = useTranslations("auth.errors");
    const tc = useTranslations("common");
    const [view, setView] = useState<View>(initialView);
    const [email, setEmail] = useState(defaultEmail);
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
        onAuthStart?.();
        // Set when this sign-in is a step in an assistant's OAuth connection
        // (see ~/server/mcp): better-auth answers with the next screen of
        // that flow instead of a plain success.
        let flowNext: string | null = null;
        const failure = await attempt(async hooks => {
            const result = await authClient.signIn.email(
                { email: email.trim(), password, rememberMe },
                hooks
            );
            flowNext = oauthFlowRedirect(result.data);
            return result;
        });
        if (failure) {
            const wrongCredentials = failure.status === 401 || failure.status === 400;
            fail(
                failure,
                signInFailureMessage(failure, te),
                wrongCredentials ? "password" : undefined
            );
            return;
        }
        // Full navigation on purpose: middleware routes a fresh session to
        // the right dashboard by DB role. `pending` stays set until it lands.
        window.location.assign(flowNext ?? redirectTo);
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
        if (failure?.status === 0) return fail(failure, networkErrorMessage(te), "email");
        if (failure?.status === 429) return fail(failure, rateLimitMessage(failure.retryAfter, te));
        setPending(null);
        setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000);
        setView("sent");
    };

    const startSocial = async (provider: SocialProvider) => {
        setError(null);
        setPending(provider);
        onAuthStart?.();
        const next = redirectTo === "/" ? null : redirectTo;
        const failure = await startSocialSignIn(provider, {
            callbackURL: redirectTo,
            // A first-time social sign-in has an account but no workspace
            // yet; registration lives on /signup unless the caller joins.
            newUserCallbackURL: newUserRedirectTo ?? withNext("/signup", next),
            errorCallbackURL: withNext(`/signin?provider=${provider}`, next),
        });
        // On success better-auth sends the window to the provider; leave
        // the button spinning until it goes.
        if (failure) fail(failure, socialFailureMessage(provider, failure, te));
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
                    {t("sentTitle")}
                </div>
                <p className="text-ink-3 m-0 text-[13px] leading-relaxed">
                    {t.rich("sentBody", {
                        email,
                        b: chunks => <span className="text-ink font-medium">{chunks}</span>,
                    })}
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
                        {resendIn > 0 ? t("resendIn", { seconds: resendIn }) : t("resend")}
                    </Button>
                    <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="text-ink-3 h-auto px-0"
                        onClick={() => switchView("forgot")}
                    >
                        {t("differentEmail")}
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
                    {t("backToSignIn")}
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
                <SocialButtons
                    providers={socialProviders}
                    pending={pending}
                    disabled={busy || lockedFor > 0}
                    lastMethod={lastMethod}
                    onStart={provider => void startSocial(provider)}
                />
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
                        <div className="text-ink text-sm font-semibold">{t("resetTitle")}</div>
                        <p className="text-ink-3 m-0 text-[12.5px] leading-relaxed">
                            {t("resetIntro")}
                        </p>
                    </div>
                )}
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="signin-email">{tc("fields.email")}</Label>
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
                        <Label htmlFor="signin-password">{tc("fields.password")}</Label>
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
                            {t("forgotPassword")}
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
                            {t("keepSignedIn")}
                        </Label>
                    </div>
                )}
                {error && <ErrorText id={errorId}>{error.message}</ErrorText>}
                <SubmitButton
                    pending={pending === (forgot ? "reset" : "email")}
                    disabled={busy || lockedFor > 0}
                >
                    {lockedFor > 0
                        ? t("tryAgainIn", { seconds: lockedFor })
                        : forgot
                          ? pending === "reset"
                              ? t("sending")
                              : t("emailResetLink")
                          : pending === "email"
                            ? t("signingIn")
                            : tc("actions.signIn")}
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
                        {t("backToSignIn")}
                    </Button>
                )}
            </form>
        </div>
    );
}

export function SignUpForm({
    signInHref = "/signin",
    defaultEmail = "",
    lockEmail = false,
    onAuthStart,
    onSignInInstead,
    socialProviders = [],
    socialRedirectTo = "/signup",
}: {
    signInHref?: string;
    /** Prefills the email field. */
    defaultEmail?: string;
    /** An invitation only works for its own address, so don't let it drift. */
    lockEmail?: boolean;
    /** Runs as sign-up starts, before any navigation (the join intent). */
    onAuthStart?: () => void;
    /** Switches the host to its sign-in form instead of linking to /signin. */
    onSignInInstead?: () => void;
    /** Offered above the form; a social sign-in creates the account too. */
    socialProviders?: SocialProvider[];
    /** Where a social sign-up lands, new account or not. */
    socialRedirectTo?: string;
} = {}) {
    const t = useTranslations("auth.form");
    const te = useTranslations("auth.errors");
    const tc = useTranslations("common");
    const [name, setName] = useState("");
    const [email, setEmail] = useState(defaultEmail);
    const [password, setPassword] = useState("");
    const [error, setError] = useState<React.ReactNode>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [socialPending, setSocialPending] = useState<SocialProvider | null>(null);
    const passwordHintId = useId();
    const emailHintId = useId();

    const startSocial = async (provider: SocialProvider) => {
        setError(null);
        setSocialPending(provider);
        onAuthStart?.();
        const failure = await startSocialSignIn(provider, {
            callbackURL: socialRedirectTo,
            newUserCallbackURL: socialRedirectTo,
            errorCallbackURL: withNext(`/signin?provider=${provider}`, socialRedirectTo),
        });
        if (failure) {
            setError(socialFailureMessage(provider, failure, te));
            setSocialPending(null);
        }
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);
        onAuthStart?.();
        const failure = await attempt(hooks =>
            authClient.signUp.email({ name: name.trim(), email: email.trim(), password }, hooks)
        );
        if (failure) {
            setError(
                failure.status === 422 ? (
                    <>
                        {t("accountExists")}{" "}
                        {onSignInInstead ? (
                            <Button
                                type="button"
                                variant="link"
                                className="text-brand h-auto p-0 text-[12.5px] font-semibold"
                                onClick={onSignInInstead}
                            >
                                {t("signInInstead")}
                            </Button>
                        ) : (
                            <Link href={signInHref} className="text-brand font-semibold">
                                {t("signInInstead")}
                            </Link>
                        )}
                    </>
                ) : failure.status === 0 ? (
                    networkErrorMessage(te)
                ) : failure.status === 429 ? (
                    rateLimitMessage(failure.retryAfter, te)
                ) : (
                    (failure.message ?? te("signUpFailed"))
                )
            );
            setIsSubmitting(false);
            return;
        }
        // No navigation: the session hook updates and this page re-renders
        // into its registration step (solo / invite / team).
    };

    const longEnough = password.length >= 8;
    const busy = isSubmitting || socialPending !== null;

    const form = (
        <form
            method="post"
            onSubmit={e => void submit(e)}
            className="border-line bg-panel flex flex-col gap-3.5 rounded-xl border p-5"
        >
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-name">{t("name")}</Label>
                <Input
                    id="signup-name"
                    name="name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t("namePlaceholder")}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-email">{tc("fields.email")}</Label>
                <Input
                    id="signup-email"
                    name="email"
                    {...EMAIL_FIELD}
                    autoComplete="email"
                    required
                    readOnly={lockEmail}
                    aria-describedby={lockEmail ? emailHintId : undefined}
                    className={cn(lockEmail && "bg-panel-2 text-ink-2")}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                />
                {lockEmail && (
                    <p id={emailHintId} className="text-ink-3 m-0 text-[11.5px]">
                        {t("inviteEmailHint")}
                    </p>
                )}
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-password">{tc("fields.password")}</Label>
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
                        longEnough ? "text-success-ink" : "text-ink-3"
                    )}
                >
                    {longEnough && <Check className="size-3" aria-hidden />}
                    {t("passwordLength")}
                </p>
            </div>
            {error && <ErrorText>{error}</ErrorText>}
            <SubmitButton pending={isSubmitting} disabled={busy}>
                {isSubmitting ? t("creatingAccount") : t("createAccount")}
            </SubmitButton>
        </form>
    );

    if (socialProviders.length === 0) return form;
    return (
        <div className="flex flex-col gap-4">
            <SocialButtons
                providers={socialProviders}
                pending={socialPending}
                disabled={busy}
                lastMethod={null}
                onStart={provider => void startSocial(provider)}
            />
            {form}
        </div>
    );
}
