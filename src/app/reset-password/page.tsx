"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    Loader2,
    CheckCircle,
    ArrowLeft,
    Lock,
    Eye,
    EyeOff,
    AlertCircle,
} from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { PASSWORD_RULES } from "~/lib/validation";
import styles from "~/styles/signup.module.css";
import { SignupNavbar } from "../_components/SignupNavbar";

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const passwordRuleResults = PASSWORD_RULES.map((rule) => ({
        label: rule.label,
        passed: password.length > 0 && rule.test(password),
    }));
    const allRulesPassed = passwordRuleResults.every((r) => r.passed);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        if (!allRulesPassed) {
            setError("Please meet all password requirements.");
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
                        {success ? (
                            <>
                                <div className={styles.formHeader}>
                                    <div className="flex justify-center mb-3">
                                        <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                                        </div>
                                    </div>
                                    <h1 className={styles.title}>Password reset</h1>
                                    <p className={styles.subtitle}>
                                        Your password has been reset successfully.
                                    </p>
                                </div>
                                <div className={`${styles.form} ${styles.formFooter}`}>
                                    <Link href="/signin" className={styles.footerLink}>
                                        Sign in with your new password
                                    </Link>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className={styles.formHeader}>
                                    <h1 className={styles.title}>Set new password</h1>
                                    <p className={styles.subtitle}>
                                        Choose a new password for your account.
                                    </p>
                                </div>

                                <form onSubmit={handleSubmit} className={styles.form} noValidate>
                                    <div className={styles.formGroup}>
                                        <label htmlFor="password" className={styles.label}>
                                            New Password
                                        </label>
                                        <div className={styles.inputWrapper}>
                                            <Lock className={styles.inputIcon} />
                                            <input
                                                id="password"
                                                type={showPassword ? "text" : "password"}
                                                autoComplete="new-password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                required
                                                minLength={8}
                                                className={`${styles.input} ${styles.inputTrailing}`}
                                                placeholder="At least 8 characters"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword((v) => !v)}
                                                className={styles.passwordToggle}
                                                aria-label={showPassword ? "Hide password" : "Show password"}
                                                tabIndex={-1}
                                            >
                                                {showPassword ? (
                                                    <EyeOff className={styles.passwordToggleIcon} />
                                                ) : (
                                                    <Eye className={styles.passwordToggleIcon} />
                                                )}
                                            </button>
                                        </div>
                                        <ul className="mt-1.5 space-y-0.5 list-none p-0 m-0">
                                            {passwordRuleResults.map((r) => (
                                                <li
                                                    key={r.label}
                                                    className={`flex items-center gap-1.5 text-xs ${
                                                        password.length === 0
                                                            ? "text-gray-400"
                                                            : r.passed
                                                              ? "text-emerald-600"
                                                              : "text-amber-500"
                                                    }`}
                                                >
                                                    {password.length > 0 && r.passed ? (
                                                        <CheckCircle className="w-3 h-3" />
                                                    ) : (
                                                        <AlertCircle className="w-3 h-3" />
                                                    )}
                                                    {r.label}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label htmlFor="confirmPassword" className={styles.label}>
                                            Confirm Password
                                        </label>
                                        <div className={styles.inputWrapper}>
                                            <Lock className={styles.inputIcon} />
                                            <input
                                                id="confirmPassword"
                                                type={showConfirm ? "text" : "password"}
                                                autoComplete="new-password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                required
                                                minLength={8}
                                                className={`${styles.input} ${styles.inputTrailing}`}
                                                placeholder="Confirm your password"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowConfirm((v) => !v)}
                                                className={styles.passwordToggle}
                                                aria-label={showConfirm ? "Hide password" : "Show password"}
                                                tabIndex={-1}
                                            >
                                                {showConfirm ? (
                                                    <EyeOff className={styles.passwordToggleIcon} />
                                                ) : (
                                                    <Eye className={styles.passwordToggleIcon} />
                                                )}
                                            </button>
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
                                                Resetting...
                                            </span>
                                        ) : (
                                            "Reset Password"
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

export default function ResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordForm />
        </Suspense>
    );
}
