"use client";

/**
 * Password reset landing page. The emailed reset link points here with
 * ?token=…; the form trades that token plus a new password against
 * better-auth's /api/auth/reset-password. A link that was already used or has
 * expired arrives as ?error=INVALID_TOKEN instead.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { AuthChrome } from "~/app/_components/AuthChrome";
import { networkErrorMessage, rateLimitMessage } from "~/components/auth/auth-errors";
import { PasswordInput } from "~/components/auth/password-input";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

function ResetPasswordPage() {
    const t = useTranslations("auth.resetPassword");
    const tf = useTranslations("auth.form");
    const te = useTranslations("auth.errors");
    const tc = useTranslations("common.status");
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");
    const linkError = searchParams.get("error");

    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [expired, setExpired] = useState(linkError === "INVALID_TOKEN");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const passwordRef = useRef<HTMLInputElement>(null);

    // An effect, not autoFocus: React skips autoFocus on server-rendered
    // inputs when it hydrates them.
    useEffect(() => {
        passwordRef.current?.focus();
    }, []);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setError(null);
        setIsSubmitting(true);
        let status = 0;
        let message: string | undefined;
        try {
            const { error: resetError } = await authClient.resetPassword({
                newPassword: password,
                token,
            });
            if (!resetError) {
                router.push("/signin?notice=password-reset");
                return;
            }
            status = resetError.status;
            message = resetError.message;
        } catch {
            // Thrown fetch: the request never got an answer.
        }
        setIsSubmitting(false);
        if (status === 0) setError(networkErrorMessage(te));
        else if (status === 429) setError(rateLimitMessage(null, te));
        else if (status === 400 && /token/i.test(message ?? "")) setExpired(true);
        else setError(message ?? t("expired"));
    };

    const longEnough = password.length >= 8;

    return (
        <div className="bg-surface text-ink flex min-h-screen flex-col">
            <AuthChrome />
            <div className="flex flex-1 items-center justify-center px-6 py-12">
                <div className="w-full max-w-md">
                    <h1 className="display mb-2 text-[32px] leading-[1.1] tracking-[-0.02em]">
                        {expired ? t("expiredTitle") : t("title")}
                    </h1>
                    {expired ? (
                        <div className="border-line bg-panel mt-6 flex flex-col gap-3 rounded-xl border p-5">
                            <p className="text-ink-3 m-0 text-[13px] leading-relaxed">
                                {t("expired")}
                            </p>
                            <Button asChild className="self-start">
                                <Link href="/signin?view=forgot">{t("sendNewLink")}</Link>
                            </Button>
                        </div>
                    ) : !token ? (
                        <p className="text-ink-3 mt-4 text-sm leading-relaxed">
                            {t.rich("noToken", {
                                link: chunks => (
                                    <Link
                                        href="/signin?view=forgot"
                                        className="text-brand font-semibold"
                                    >
                                        {chunks}
                                    </Link>
                                ),
                            })}
                        </p>
                    ) : (
                        <form
                            method="post"
                            onSubmit={e => void submit(e)}
                            className="border-line bg-panel mt-6 flex flex-col gap-3.5 rounded-xl border p-5"
                        >
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="new-password">{t("newPassword")}</Label>
                                <PasswordInput
                                    ref={passwordRef}
                                    id="new-password"
                                    name="new-password"
                                    autoComplete="new-password"
                                    required
                                    minLength={8}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    aria-describedby="new-password-hint"
                                />
                                <p
                                    id="new-password-hint"
                                    className={cn(
                                        "m-0 flex items-center gap-1 text-[11.5px] transition-colors",
                                        longEnough ? "text-success" : "text-ink-3"
                                    )}
                                >
                                    {longEnough && <Check className="size-3" aria-hidden />}
                                    {tf("passwordLength")}
                                </p>
                            </div>
                            {error && (
                                <p role="alert" className="text-danger m-0 text-[12.5px]">
                                    {error}
                                </p>
                            )}
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                aria-busy={isSubmitting}
                                className="w-full"
                            >
                                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                                {isSubmitting ? tc("saving") : t("submit")}
                            </Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ResetPasswordPageWrapper() {
    return (
        <Suspense>
            <ResetPasswordPage />
        </Suspense>
    );
}
