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
import React, { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";

function ErrorText({ children }: { children: React.ReactNode }) {
    return (
        <p role="alert" className="text-danger m-0 text-[12.5px] leading-normal">
            {children}
        </p>
    );
}

export function SignInForm({
    /**
     * Where to land after a successful sign-in. Defaults to "/", which the
     * middleware fans out by membership; an invitation page passes itself so
     * the person comes straight back to "Join".
     */
    redirectTo = "/",
}: {
    redirectTo?: string;
} = {}) {
    const [view, setView] = useState<"signin" | "forgot" | "sent">("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submitSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);
        const { error: signInError } = await authClient.signIn.email({ email, password });
        if (signInError) {
            setError(
                signInError.status === 401 || signInError.status === 400
                    ? "Wrong email or password. Check both and try again."
                    : (signInError.message ?? "Sign-in failed. Try again in a moment.")
            );
            setIsSubmitting(false);
            return;
        }
        // Full navigation on purpose: middleware routes a fresh session to
        // the right dashboard by DB role.
        window.location.href = redirectTo;
    };

    const submitForgot = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);
        await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        // Same response whether or not the address exists — no account probing.
        setIsSubmitting(false);
        setView("sent");
    };

    if (view === "sent") {
        return (
            <div className="border-line bg-panel flex flex-col gap-2 rounded-xl border p-5">
                <div className="text-ink text-sm font-semibold">Check your email</div>
                <p className="text-ink-3 m-0 text-[13px] leading-relaxed">
                    If an account exists for {email}, a reset link is on its way. The link expires
                    after an hour.
                </p>
                <button
                    type="button"
                    className="text-brand self-start text-[12.5px] font-semibold"
                    onClick={() => setView("signin")}
                >
                    ← Back to sign in
                </button>
            </div>
        );
    }

    const forgot = view === "forgot";
    return (
        <form
            onSubmit={forgot ? e => void submitForgot(e) : e => void submitSignIn(e)}
            className="border-line bg-panel flex flex-col gap-3.5 rounded-xl border p-5"
        >
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signin-email">Email</Label>
                <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                />
            </div>
            {!forgot && (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between">
                        <Label htmlFor="signin-password">Password</Label>
                        <button
                            type="button"
                            className="text-ink-3 hover:text-brand text-[11.5px] font-medium"
                            onClick={() => {
                                setError(null);
                                setView("forgot");
                            }}
                        >
                            Forgot password?
                        </button>
                    </div>
                    <Input
                        id="signin-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </div>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            <Button type="submit" disabled={isSubmitting} className="w-full">
                {forgot
                    ? isSubmitting
                        ? "Sending…"
                        : "Email me a reset link"
                    : isSubmitting
                      ? "Signing in…"
                      : "Sign in"}
            </Button>
            {forgot && (
                <button
                    type="button"
                    className="text-ink-3 self-center text-[12px] font-medium"
                    onClick={() => setView("signin")}
                >
                    ← Back to sign in
                </button>
            )}
        </form>
    );
}

export function SignUpForm() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);
        const { error: signUpError } = await authClient.signUp.email({
            name: name.trim(),
            email,
            password,
        });
        if (signUpError) {
            setError(
                signUpError.status === 422
                    ? "An account with this email already exists — sign in instead."
                    : (signUpError.message ?? "Sign-up failed. Try again in a moment.")
            );
            setIsSubmitting(false);
            return;
        }
        // No navigation: the session hook updates and this page re-renders
        // into its registration step (solo / invite / team).
    };

    return (
        <form
            onSubmit={e => void submit(e)}
            className="border-line bg-panel flex flex-col gap-3.5 rounded-xl border p-5"
        >
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-name">Name</Label>
                <Input
                    id="signup-name"
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
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="signup-password">Password</Label>
                <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                />
            </div>
            {error && <ErrorText>{error}</ErrorText>}
            <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Creating account…" : "Create account"}
            </Button>
        </form>
    );
}
