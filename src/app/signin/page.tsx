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
} from "lucide-react";
import styles from "~/styles/signup.module.css";
import { SignupNavbar } from "../_components/SignupNavbar";
import Link from "next/link";

const SigninPage: React.FC = () => {
    const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // If already signed in, redirect
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
                        <div className={styles.form}>
                            <h2 className={styles.title}>Sign In</h2>
                            <p className={styles.subtitle}>
                                Enter your credentials to access your account
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

                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                                        Password
                                    </label>
                                    <input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                                        placeholder="Enter your password"
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
                                            Signing in...
                                        </>
                                    ) : (
                                        "Sign In"
                                    )}
                                </button>

                                <div className="text-center space-y-2">
                                    <Link
                                        href="/forgot-password"
                                        className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
                                    >
                                        Forgot password?
                                    </Link>
                                    <p className="text-sm text-muted-foreground">
                                        Don&apos;t have an account?{" "}
                                        <Link
                                            href="/signup"
                                            className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
                                        >
                                            Sign up
                                        </Link>
                                    </p>
                                </div>
                            </form>
                        </div>
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
