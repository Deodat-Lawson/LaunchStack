"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle, ArrowLeft } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import styles from "~/styles/signup.module.css";
import { SignupNavbar } from "../_components/SignupNavbar";

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }

        if (!token) {
            setError("Invalid or missing reset token.");
            return;
        }

        setIsSubmitting(true);

        try {
            const result = await authClient.resetPassword({
                newPassword: password,
                token,
            });

            if (result.error) {
                setError(result.error.message ?? "Failed to reset password.");
            } else {
                setSuccess(true);
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
                            {success ? (
                                <>
                                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                                    <h2 className={styles.title}>Password Reset</h2>
                                    <p className={styles.subtitle}>
                                        Your password has been reset successfully.
                                    </p>
                                    <Link
                                        href="/signin"
                                        className="mt-4 text-sm text-purple-600 dark:text-purple-400 hover:underline font-medium"
                                    >
                                        Sign in with your new password
                                    </Link>
                                </>
                            ) : (
                                <>
                                    <h2 className={styles.title}>Set New Password</h2>
                                    <p className={styles.subtitle}>
                                        Choose a new password for your account.
                                    </p>

                                    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-sm">
                                        <div>
                                            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                                                New Password
                                            </label>
                                            <input
                                                id="password"
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                required
                                                minLength={8}
                                                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                                placeholder="At least 8 characters"
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1">
                                                Confirm Password
                                            </label>
                                            <input
                                                id="confirmPassword"
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                required
                                                minLength={8}
                                                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                                placeholder="Confirm your password"
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
                                                    Resetting...
                                                </>
                                            ) : (
                                                "Reset Password"
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

export default function ResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordForm />
        </Suspense>
    );
}
