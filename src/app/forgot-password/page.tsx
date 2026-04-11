"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, CheckCircle, Mail, AlertCircle } from "lucide-react";
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
                        {sent ? (
                            <>
                                <div className={styles.formHeader}>
                                    <div className="flex justify-center mb-3">
                                        <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                                        </div>
                                    </div>
                                    <h1 className={styles.title}>Check your email</h1>
                                    <p className={styles.subtitle}>
                                        If an account exists for{" "}
                                        <span className="font-medium text-gray-700 dark:text-gray-300">
                                            {email}
                                        </span>
                                        , you&apos;ll receive a password reset link shortly.
                                    </p>
                                </div>
                                <div className={`${styles.form} ${styles.formFooter}`}>
                                    <Link href="/signin" className={styles.footerLinkMuted}>
                                        <ArrowLeft className="w-3 h-3" />
                                        Back to sign in
                                    </Link>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className={styles.formHeader}>
                                    <h1 className={styles.title}>Reset password</h1>
                                    <p className={styles.subtitle}>
                                        Enter your email and we&apos;ll send you a reset link.
                                    </p>
                                </div>

                                <form onSubmit={handleSubmit} className={styles.form} noValidate>
                                    <div className={styles.formGroup}>
                                        <label htmlFor="email" className={styles.label}>
                                            Email
                                        </label>
                                        <div className={styles.inputWrapper}>
                                            <Mail className={styles.inputIcon} />
                                            <input
                                                id="email"
                                                type="email"
                                                autoComplete="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                required
                                                className={styles.input}
                                                placeholder="you@example.com"
                                            />
                                        </div>
                                    </div>

                                    {error && (
                                        <div className={styles.formError} role="alert">
                                            <AlertCircle className={styles.formErrorIcon} />
                                            <span>{error}</span>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className={styles.submitButton}
                                    >
                                        {isSubmitting ? (
                                            <span className="inline-flex items-center justify-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Sending...
                                            </span>
                                        ) : (
                                            "Send Reset Link"
                                        )}
                                    </button>

                                    <div className={styles.formFooter}>
                                        <Link href="/signin" className={styles.footerLinkMuted}>
                                            <ArrowLeft className="w-3 h-3" />
                                            Back to sign in
                                        </Link>
                                    </div>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
