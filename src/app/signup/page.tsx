"use client";

import React, { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser, SignUp } from "@clerk/nextjs";
import {
    Building,
    Users,
    Briefcase,
    Ticket,
    Brain,
    FileSearch,
    BarChart3,
    Shield,
    CheckCircle,
    ArrowLeft,
    AlertCircle,
} from "lucide-react";
import styles from "~/styles/signup.module.css";
import { SignupNavbar } from "../_components/SignupNavbar";

type ActiveTab = "create" | "join";

// ─── Join flow steps (simplified – no "authenticate" step since auth happens first) ──
type JoinStep = "enter-code" | "joining";

// ─── Validated code info ────────────────────────────────────────────────────
interface ValidatedCodeInfo {
    code: string;
    companyName: string;
    role: string;
}

// ─── Create Company Form ────────────────────────────────────────────────────
interface CreateCompanyFormData {
    companyName: string;
    staffCount: string;
}
interface CreateCompanyFormErrors {
    companyName?: string;
    staffCount?: string;
}

// ─── Join Company Form ──────────────────────────────────────────────────────
interface JoinFormData {
    inviteCode: string;
}
interface JoinFormErrors {
    inviteCode?: string;
}

const SignupPage: React.FC = () => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, isLoaded: isAuthLoaded } = useAuth();
    const { user } = useUser();

    const [activeTab, setActiveTab] = useState<ActiveTab>("create");

    // ─── Create Company State ────────────────────────────────────────────────
    const [createFormData, setCreateFormData] = useState<CreateCompanyFormData>({
        companyName: "",
        staffCount: "",
    });
    const [createErrors, setCreateErrors] = useState<CreateCompanyFormErrors>({});
    const [isCreating, setIsCreating] = useState(false);

    // ─── Join Company State ──────────────────────────────────────────────────
    const [joinFormData, setJoinFormData] = useState<JoinFormData>({
        inviteCode: "",
    });
    const [joinErrors, setJoinErrors] = useState<JoinFormErrors>({});
    const [joinStep, setJoinStep] = useState<JoinStep>("enter-code");
    const [validatedCode, setValidatedCode] = useState<ValidatedCodeInfo | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
    const [registrationError, setRegistrationError] = useState<string | null>(null);

    // Guard so the auto-join from ?code= only fires once
    const autoJoinTriggered = useRef(false);

    const performJoin = useCallback(
        async (code: string) => {
            if (!userId || !user) return;
            setIsJoining(true);
            setJoinSuccess(null);
            setRegistrationError(null);

            try {
                // First check if user is already registered
                const regRes = await fetch("/api/signup/check-registration");
                const regData = (await regRes.json()) as {
                    data?: { registered: boolean; companyName?: string };
                };

                if (regData.data?.registered) {
                    setRegistrationError(
                        `You are already registered with "${regData.data.companyName ?? "a company"}". You cannot join another company.`
                    );
                    setIsJoining(false);
                    return;
                }

                // Proceed with join
                const response = await fetch("/api/signup/join", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId,
                        name: user.fullName ?? user.username,
                        email: user.emailAddresses[0]?.emailAddress,
                        inviteCode: code,
                    }),
                });

                const rawData: unknown = await response.json();

                if (response.status === 400) {
                    if (
                        typeof rawData === "object" &&
                        rawData !== null &&
                        "message" in rawData
                    ) {
                        const errorData = rawData as { message: string };
                        setJoinErrors({ inviteCode: errorData.message });
                    } else {
                        setJoinErrors({ inviteCode: "Invalid invite code" });
                    }
                    setJoinStep("enter-code");
                    setIsJoining(false);
                    return;
                }

                if (!response.ok) {
                    setJoinErrors({
                        inviteCode: "Failed to join. Please try again.",
                    });
                    setJoinStep("enter-code");
                    setIsJoining(false);
                    return;
                }

                const data = rawData as {
                    data?: { redirectPath?: string; companyName?: string; role?: string };
                    message?: string;
                };
                setJoinSuccess(data.message ?? "Successfully joined!");

                setTimeout(() => {
                    router.push(data.data?.redirectPath ?? "/");
                }, 1500);
            } catch (error) {
                console.error("Join company error:", error);
                setJoinErrors({
                    inviteCode: "Failed to join. Please check your connection.",
                });
                setJoinStep("enter-code");
                setIsJoining(false);
            }
        },
        [userId, user, router]
    );

    // Handle ?code= query param on mount / auth change
    useEffect(() => {
        if (!isAuthLoaded || autoJoinTriggered.current) return;

        const codeFromUrl = searchParams.get("code");
        if (!codeFromUrl) return;

        // Switch to the join tab and populate the code
        setActiveTab("join");
        setJoinFormData({ inviteCode: codeFromUrl.toUpperCase() });

        if (userId && user) {
            autoJoinTriggered.current = true;
            setJoinStep("joining");
            void performJoin(codeFromUrl);
        }
    }, [isAuthLoaded, userId, user, searchParams, performJoin]);

    // ═════════════════════════════════════════════════════════════════════════
    // CREATE COMPANY HANDLERS
    // ═════════════════════════════════════════════════════════════════════════

    const handleCreateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setCreateFormData((prev) => ({ ...prev, [name]: value }));
        if (createErrors[name as keyof CreateCompanyFormErrors]) {
            setCreateErrors((prev) => ({ ...prev, [name]: undefined }));
        }
    };

    const validateCreateForm = (): boolean => {
        const errors: CreateCompanyFormErrors = {};
        if (!createFormData.companyName.trim()) {
            errors.companyName = "Company name is required";
        }
        if (!createFormData.staffCount) {
            errors.staffCount = "Please enter approximate staff count";
        }
        setCreateErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const submitCreateCompany = async () => {
        if (!userId || !user) {
            setCreateErrors((prev) => ({
                ...prev,
                companyName: "Please sign in first to create an account",
            }));
            return;
        }
        setIsCreating(true);
        try {
            const response = await fetch("/api/signup/employerCompany", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    name: user?.fullName,
                    email: user?.emailAddresses[0]?.emailAddress,
                    companyName: createFormData.companyName,
                    numberOfEmployees: createFormData.staffCount,
                }),
            });

            if (response.status === 400) {
                const rawData: unknown = await response.json();
                if (typeof rawData === "object" && rawData !== null && "error" in rawData) {
                    const errorData = rawData as { error: string };
                    setCreateErrors((prev) => ({ ...prev, companyName: errorData.error }));
                } else {
                    setCreateErrors((prev) => ({ ...prev, companyName: "Registration failed" }));
                }
                setIsCreating(false);
                return;
            }
            if (!response.ok) {
                setCreateErrors((prev) => ({
                    ...prev,
                    companyName: "Registration failed. Please try again.",
                }));
                setIsCreating(false);
                return;
            }
            router.push("/employer/home");
        } catch (error) {
            console.error("Create company error:", error);
            setCreateErrors((prev) => ({
                ...prev,
                companyName: "Registration failed. Please check your connection.",
            }));
            setIsCreating(false);
        }
    };

    const handleCreateSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateCreateForm()) return;
        await submitCreateCompany();
    };

    // ═════════════════════════════════════════════════════════════════════════
    // JOIN WITH CODE HANDLERS
    // ═════════════════════════════════════════════════════════════════════════

    const handleJoinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setJoinFormData((prev) => ({ ...prev, [name]: value.toUpperCase() }));
        if (joinErrors[name as keyof JoinFormErrors]) {
            setJoinErrors((prev) => ({ ...prev, [name]: undefined }));
        }
        setJoinSuccess(null);
        setRegistrationError(null);
    };

    /** Step 1: validate the invite code via public API */
    const handleValidateCode = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = joinFormData.inviteCode.trim();
        if (!code) {
            setJoinErrors({ inviteCode: "Invite code is required" });
            return;
        }

        setIsValidating(true);
        setJoinErrors({});
        setRegistrationError(null);

        try {
            const res = await fetch("/api/invite-codes/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });

            const rawData: unknown = await res.json();

            if (!res.ok) {
                const errData = rawData as { message?: string };
                setJoinErrors({
                    inviteCode:
                        errData.message ??
                        "Invalid or expired invite code.",
                });
                setIsValidating(false);
                return;
            }

            const data = rawData as {
                data?: { companyName: string; role: string };
            };

            if (!data.data) {
                setJoinErrors({ inviteCode: "Unexpected response. Try again." });
                setIsValidating(false);
                return;
            }

            setValidatedCode({
                code,
                companyName: data.data.companyName,
                role: data.data.role,
            });

            // User is already authenticated (auth-first flow), so auto-join directly
                setJoinStep("joining");
                setIsValidating(false);
                void performJoin(code);
        } catch (error) {
            console.error("Code validation error:", error);
            setJoinErrors({
                inviteCode: "Could not validate code. Check your connection.",
            });
            setIsValidating(false);
        }
    };

    /** Go back to step 1 */
    const handleBackToCode = () => {
        setJoinStep("enter-code");
        setValidatedCode(null);
        setRegistrationError(null);
        setJoinErrors({});
        setJoinSuccess(null);
    };

    // ═════════════════════════════════════════════════════════════════════════
    // TAB DATA
    // ═════════════════════════════════════════════════════════════════════════

    const tabs: { key: ActiveTab; label: string; icon: React.ReactNode }[] = [
        { key: "create", label: "Create Company", icon: <Briefcase className={styles.tabIcon} /> },
        { key: "join", label: "Join with Code", icon: <Ticket className={styles.tabIcon} /> },
    ];

    const getJoinHeading = (): { title: string; subtitle: string } => {
        if (joinStep === "joining") {
            return {
                title: "Joining Company...",
                subtitle: `Setting up your account with ${validatedCode?.companyName ?? "the company"}`,
            };
        }
        return {
            title: "Join a Company",
            subtitle: "Enter an invite code from your organization",
        };
    };

    const headings: Record<ActiveTab, { title: string; subtitle: string }> = {
        create: {
            title: "Create Your Company",
            subtitle: "Set up your organization on PDR AI",
        },
        join: getJoinHeading(),
    };

    // ═════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═════════════════════════════════════════════════════════════════════════

    // ═════════════════════════════════════════════════════════════════════════
    // RENDER HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    const renderBrandPanel = () => (
        <div className={styles.brandPanel}>
            <div className={styles.brandContent}>
                <div className={styles.brandLogo}>
                    <Brain className={styles.brandLogoIcon} />
                    <span className={styles.brandLogoText}>PDR AI</span>
                </div>

                <h2 className={styles.brandTitle}>
                    Professional Document Reader AI
                </h2>
                <p className={styles.brandDescription}>
                    Transform how your team analyzes and interprets professional documents with cutting-edge AI technology.
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
                        &ldquo;PDR AI reduced our document review time by 80% and dramatically improved our compliance workflow.&rdquo;
                    </p>
                </div>
            </div>
        </div>
    );

    // ═════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═════════════════════════════════════════════════════════════════════════

    // While Clerk is still loading, show nothing to avoid flash
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

    // ── Not authenticated: show Clerk SignUp component ─────────────────────
    if (!userId) {
        return (
            <div className={styles.container}>
                <SignupNavbar />
                <div className={styles.splitLayout}>
                    <div className={styles.formPanel}>
                        <SignUp
                            routing="hash"
                            forceRedirectUrl="/"
                            signInUrl="/signin"
                        />
                    </div>
                    {renderBrandPanel()}
                </div>
            </div>
        );
    }

    // ── Authenticated: show Create Company / Join with Code tabs ───────────
    return (
        <div className={styles.container}>
            <SignupNavbar />

            <div className={styles.splitLayout}>
                {/* ── Left: Form Panel ──────────────────────────────── */}
                <div className={styles.formPanel}>
                    <div className={styles.formCard}>
                        {/* Tab Bar */}
                        <div className={styles.tabBar}>
                            {tabs.map((tab) => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
                                    onClick={() => {
                                        setActiveTab(tab.key);
                                        // Reset join state when switching tabs
                                        if (tab.key === "join") {
                                            setJoinStep("enter-code");
                                            setValidatedCode(null);
                                            setRegistrationError(null);
                                            setJoinErrors({});
                                            setJoinSuccess(null);
                                        }
                                    }}
                                >
                                    {tab.icon}
                                    <span className={styles.tabLabel}>{tab.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Header */}
                        <div className={styles.formHeader}>
                            <h1 className={styles.title}>{headings[activeTab].title}</h1>
                            <p className={styles.subtitle}>{headings[activeTab].subtitle}</p>
                        </div>

                        {/* ── Create Company Form ─────────────────────── */}
                        {activeTab === "create" && (
                            <form onSubmit={handleCreateSubmit} className={styles.form}>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>Company Name</label>
                                    <div className={styles.inputWrapper}>
                                        <Building className={styles.inputIcon} />
                                        <input
                                            type="text"
                                            name="companyName"
                                            value={createFormData.companyName}
                                            onChange={handleCreateChange}
                                            className={styles.input}
                                            placeholder="Enter company name"
                                        />
                                    </div>
                                    {createErrors.companyName && (
                                        <span className={styles.error}>{createErrors.companyName}</span>
                                    )}
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.label}>Approximate Number of Staff</label>
                                    <div className={styles.inputWrapper}>
                                        <Users className={styles.inputIcon} />
                                        <input
                                            type="number"
                                            name="staffCount"
                                            value={createFormData.staffCount}
                                            onChange={handleCreateChange}
                                            className={styles.input}
                                            placeholder="Enter staff count"
                                            min="1"
                                        />
                                    </div>
                                    {createErrors.staffCount && (
                                        <span className={styles.error}>{createErrors.staffCount}</span>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    className={styles.submitButton}
                                    disabled={isCreating}
                                >
                                    {isCreating ? "Creating..." : "Create Company"}
                                </button>
                            </form>
                        )}

                        {/* ── Join with Code: Step 1 – Enter Code ─────── */}
                        {activeTab === "join" && joinStep === "enter-code" && (
                            <form onSubmit={handleValidateCode} className={styles.form}>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>Invite Code</label>
                                    <div className={styles.inputWrapper}>
                                        <Ticket className={styles.inputIcon} />
                                        <input
                                            type="text"
                                            name="inviteCode"
                                            value={joinFormData.inviteCode}
                                            onChange={handleJoinChange}
                                            className={`${styles.input} ${styles.codeInput}`}
                                            placeholder="Enter invite code"
                                            maxLength={12}
                                            autoComplete="off"
                                        />
                                    </div>
                                    {joinErrors.inviteCode && (
                                        <span className={styles.error}>{joinErrors.inviteCode}</span>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    className={styles.submitButton}
                                    disabled={isValidating}
                                >
                                    {isValidating ? "Validating..." : "Continue"}
                                </button>

                                <p className={styles.hint}>
                                    Ask your company admin for an invite code or use the invite link they shared.
                                </p>
                            </form>
                        )}

                        {/* ── Join with Code: Joining / Already Registered ── */}
                        {activeTab === "join" && joinStep === "joining" && (
                            <div className={styles.form}>
                                {registrationError ? (
                                    <div className={styles.registrationError}>
                                        <AlertCircle className={styles.registrationErrorIcon} />
                                        <p className={styles.registrationErrorText}>
                                            {registrationError}
                                        </p>
                                        <button
                                            type="button"
                                            className={styles.backButton}
                                            onClick={handleBackToCode}
                                        >
                                            <ArrowLeft className={styles.backIcon} />
                                            Go back
                                        </button>
                                    </div>
                                ) : joinSuccess ? (
                                    <div className={styles.successMessage}>
                                        <CheckCircle className={styles.successIcon} />
                                        <p className={styles.success}>{joinSuccess}</p>
                                        <p className={styles.hint}>Redirecting to your dashboard...</p>
                                    </div>
                                ) : (
                                    <div className={styles.joiningSpinner}>
                                        <div className={styles.spinner} />
                                        <p className={styles.subtitle}>
                                            {isJoining ? "Setting up your account..." : "Preparing..."}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Right: Branding Panel ─────────────────────────── */}
                {renderBrandPanel()}
            </div>
        </div>
    );
};

export default function SignupPageWrapper() {
    return (
        <Suspense>
            <SignupPage />
        </Suspense>
    );
}
