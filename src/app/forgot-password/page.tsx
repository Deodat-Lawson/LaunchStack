"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Brain, Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import styles from "~/styles/signup.module.css";
import { SignupNavbar } from "../_components/SignupNavbar";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            const result = await authClient.requestPasswordReset({
                email,
                redirectTo: "/reset-password",
            });

            if (result.error) {
                setError(result.error.message ?? "Failed to send reset email.");
            } else {
                setSent(true);
            }
        } catch {
            setError("An unexpected error occurred. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={styles.container}>
            <SignupNavbar />
            <div className={styles.splitLayout}>
                <div className={styles.formPanel}>
                    <div className={styles.formCard}>
                        <div className={styles.form}>
                            {sent ? (
                                <>
                                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                                    <h2 className={styles.title}>Check Your Email</h2>
                                    <p className={styles.subtitle}>
                                        If an account exists for {email}, you&apos;ll receive a password reset link shortly.
                                    </p>
                                    <Link
                                        href="/signin"
                                        className="mt-4 text-sm text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center gap-1"
                                    >
                                        <ArrowLeft className="w-3 h-3" />
                                        Back to sign in
                                    </Link>
                                </>
                            ) : (
                                <>
                                    <h2 className={styles.title}>Reset Password</h2>
                                    <p className={styles.subtitle}>
                                        Enter your email and we&apos;ll send you a reset link.
                                    </p>

                                    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
                                        <div>
                                            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
                                                Email
                                            </label>
                                            <input
                                                id="email"
                                                type="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                required
                                                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                                placeholder="you@example.com"
                                            />
                                        </div>

                                        {error && (
                                            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                                                {error}
                                            </div>
                                        )}

                                        <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Sending...
                                                </>
                                            ) : (
                                                "Send Reset Link"
                                            )}
                                        </button>

                                        <p className="text-sm text-muted-foreground text-center">
                                            <Link
                                                href="/signin"
                                                className="text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center gap-1"
                                            >
                                                <ArrowLeft className="w-3 h-3" />
                                                Back to sign in
                                            </Link>
                                        </p>
                                    </form>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
