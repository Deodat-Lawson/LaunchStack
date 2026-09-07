"use client";

/**
 * Password reset landing page. The emailed reset link points here with
 * ?token=…; the form trades that token plus a new password against
 * better-auth's /api/auth/reset-password.
 */
import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthChrome } from "~/app/_components/AuthChrome";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";

function ResetPasswordPage() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setError(null);
        setIsSubmitting(true);
        const { error: resetError } = await authClient.resetPassword({
            newPassword: password,
            token,
        });
        if (resetError) {
            setError(
                resetError.message ??
                    "This reset link is invalid or has expired. Request a new one from the sign-in page."
            );
            setIsSubmitting(false);
            return;
        }
        setDone(true);
    };

    return (
        <div className="text-ink flex min-h-screen flex-col" style={{ background: "var(--bg)" }}>
            <AuthChrome />
            <div className="flex flex-1 items-center justify-center px-6 py-12">
                <div className="w-full max-w-md">
                    <h1
                        className="serif"
                        style={{
                            fontSize: 32,
                            lineHeight: 1.1,
                            letterSpacing: "-0.02em",
                            margin: "0 0 8px",
                        }}
                    >
                        Choose a new password.
                    </h1>
                    {done ? (
                        <div className="border-line bg-panel mt-6 flex flex-col gap-2 rounded-xl border p-5">
                            <div className="text-ink text-sm font-semibold">Password updated</div>
                            <p className="text-ink-3 m-0 text-[13px] leading-relaxed">
                                Your new password is live. Sign in to get back to your workspace.
                            </p>
                            <Button asChild className="mt-1 self-start">
                                <Link href="/signin">Go to sign in</Link>
                            </Button>
                        </div>
                    ) : !token ? (
                        <p className="text-ink-3 mt-4 text-sm leading-relaxed">
                            This page only works from a reset link. Request one from the{" "}
                            <Link href="/signin" className="text-brand font-semibold">
                                sign-in page
                            </Link>
                            .
                        </p>
                    ) : (
                        <form
                            onSubmit={e => void submit(e)}
                            className="border-line bg-panel mt-6 flex flex-col gap-3.5 rounded-xl border p-5"
                        >
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="new-password">New password</Label>
                                <Input
                                    id="new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    minLength={8}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="At least 8 characters"
                                />
                            </div>
                            {error && (
                                <p role="alert" className="text-danger m-0 text-[12.5px]">
                                    {error}
                                </p>
                            )}
                            <Button type="submit" disabled={isSubmitting} className="w-full">
                                {isSubmitting ? "Saving…" : "Set new password"}
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
