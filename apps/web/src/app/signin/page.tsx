"use client";

import React, { Suspense } from "react";
import { useAuth, SignIn } from "@clerk/nextjs";
import {
    Brain,
    FileSearch,
    BarChart3,
    Shield,
    CheckCircle,
} from "lucide-react";
import styles from "~/styles/signup.module.css";
import { SignupNavbar } from "../_components/SignupNavbar";

const SigninPage: React.FC = () => {
    const { isLoaded: isAuthLoaded } = useAuth();

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

    // While Clerk is still loading, show a spinner
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

    // Show the Clerk SignIn component in the same split-screen layout
    return (
        <div className={styles.container}>
            <SignupNavbar />
            <div className={styles.splitLayout}>
                <div className={styles.formPanel}>
                    <SignIn
                        routing="hash"
                        forceRedirectUrl="/"
                        signUpUrl="/signup"
                    />
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
