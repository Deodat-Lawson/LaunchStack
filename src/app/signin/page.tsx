"use client";

import React, { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "~/lib/auth-hooks";
import { authClient } from "~/lib/auth-client";
import {
    Brain,
    FileSearch,
    BarChart3,
    Shield,
    CheckCircle,
    Loader2,
    Mail,
    Lock,
    Eye,
    EyeOff,
    AlertCircle,
} from "lucide-react";
import styles from "~/styles/signup.module.css";
import { SignupNavbar } from "../_components/SignupNavbar";
import Link from "next/link";

const SigninPage: React.FC = () => {
    const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // If already signed in, redirect — middleware will then role-route.
    React.useEffect(() => {
        if (isAuthLoaded && isSignedIn) {
            router.push("/");
        }
    }, [isAuthLoaded, isSignedIn, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            const result = await authClient.signIn.email({
                email,
                password,
            });

            if (result.error) {
                setError(result.error.message ?? "Sign in failed. Please check your credentials.");
            } else {
                router.push("/");
            }
        } catch {
            setError("An unexpected error occurred. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // ═════════════════════════════════════════════════════════════════════════
    // RENDER HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    const renderBrandPanel = () => (
        <div className={styles.brandPanel}>
            <div className={styles.brandContent}>
                <div className={styles.brandLogo}>
                    <Brain className={styles.brandLogoIcon} />
                    <span className={styles.brandLogoText}>Launchstack</span>
                </div>

                <h2 className={styles.brandTitle}>
                    Welcome Back
                </h2>
                <p className={styles.brandDescription}>
                    Sign in to access your documents, analytics, and AI-powered tools.
                </p>

                <div className={styles.featureList}>
                    <div className={styles.featureItem}>
                        <FileSearch className={styles.featureIcon} />
                        <div>
                            <h4 className={styles.featureTitle}>Predictive Analysis</h4>
                            <p className={styles.featureText}>AI identifies missing documents and suggests relevant content</p>
                        </div>
                    </div>
                    <div className={styles.featureItem}>
                        <BarChart3 className={styles.featureIcon} />
                        <div>
                            <h4 className={styles.featureTitle}>Analytics &amp; Insights</h4>
                            <p className={styles.featureText}>Real-time dashboards tracking usage and compliance</p>
                        </div>
                    </div>
                    <div className={styles.featureItem}>
                        <Shield className={styles.featureIcon} />
                        <div>
                            <h4 className={styles.featureTitle}>Enterprise Security</h4>
                            <p className={styles.featureText}>Bank-level security with role-based access control</p>
                        </div>
                    </div>
                </div>

                <div className={styles.brandStats}>
                    <div className={styles.brandStat}>
                        <span className={styles.brandStatNumber}>5k+</span>
                        <span className={styles.brandStatLabel}>Documents</span>
                    </div>
                    <div className={styles.brandStat}>
                        <span className={styles.brandStatNumber}>99%</span>
                        <span className={styles.brandStatLabel}>Accuracy</span>
                    </div>
                    <div className={styles.brandStat}>
                        <span className={styles.brandStatNumber}>50+</span>
                        <span className={styles.brandStatLabel}>Companies</span>
                    </div>
                </div>

                <div className={styles.testimonial}>
                    <CheckCircle className={styles.testimonialIcon} />
                    <p className={styles.testimonialText}>
                        &ldquo;Launchstack reduced our document review time by 80% and dramatically improved our compliance workflow.&rdquo;
                    </p>
                </div>
            </div>
        </div>
    );

    // ═════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═════════════════════════════════════════════════════════════════════════

    if (!isAuthLoaded) {
        return (
            <div className={styles.container}>
                <SignupNavbar />
                <div className={styles.splitLayout}>
                    <div className={styles.formPanel}>
                        <div className={styles.formCard}>
                            <div className={styles.form}>
                                <div className={styles.joiningSpinner}>
                                    <div className={styles.spinner} />
                                    <p className={styles.subtitle}>Loading...</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    {renderBrandPanel()}
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <SignupNavbar />
            <div className={styles.splitLayout}>
                <div className={styles.formPanel}>
                    <div className={styles.formCard}>
                        <div className={styles.formHeader}>
                            <h1 className={styles.title}>Welcome back</h1>
                            <p className={styles.subtitle}>
                                Sign in to continue to Launchstack
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

                            <div className={styles.formGroup}>
                                <label htmlFor="password" className={styles.label}>
                                    Password
                                </label>
                                <div className={styles.inputWrapper}>
                                    <Lock className={styles.inputIcon} />
                                    <input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className={`${styles.input} ${styles.inputTrailing}`}
                                        placeholder="Enter your password"
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
                                        Signing in...
                                    </span>
                                ) : (
                                    "Sign In"
                                )}
                            </button>

                            <div className={styles.formFooter}>
                                <Link href="/forgot-password" className={styles.footerLink}>
                                    Forgot password?
                                </Link>
                                <div className={styles.formFooterRow}>
                                    <span>Don&apos;t have an account?</span>
                                    <Link href="/signup" className={styles.footerLink}>
                                        Sign up
                                    </Link>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
                {renderBrandPanel()}
            </div>
        </div>
    );
};

export default function SigninPageWrapper() {
    return (
        <Suspense>
            <SigninPage />
        </Suspense>
    );
}
