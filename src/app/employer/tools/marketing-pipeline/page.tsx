"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Brain, ChevronDown, ChevronRight, Loader2, MessageSquareText, Megaphone, Sparkles } from "lucide-react";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import homeStyles from "~/styles/Employer/Home.module.css";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

type Platform = "x" | "linkedin" | "reddit" | "bluesky";

interface DNADebugInfo {
    source: "metadata" | "rag";
    contextUsed: string;
    dna: {
        coreMission: string;
        keyDifferentiators: string[];
        provenResults: string[];
        humanStory: string;
        technicalEdge: string;
    };
}

interface PipelineResponse {
    success: boolean;
    message?: string;
    data?: {
        platform: Platform;
        message: string;
        "image/video": "image" | "video";
        research: Array<{
            title: string;
            url: string;
            snippet: string;
            source: Platform;
        }>;
        dnaDebug?: DNADebugInfo;
    };
}

const REDDIT_SNOO_URL = "/images/reddit-snoo.png";

const PLATFORM_OPTIONS: Array<{ id: Platform; label: string; subtitle: string; logoText: string; logoImg?: string }> = [
    { id: "reddit", label: "Reddit", subtitle: "Community-first threads", logoText: "reddit", logoImg: REDDIT_SNOO_URL },
    { id: "x", label: "Twitter / X", subtitle: "Fast-moving trends", logoText: "𝕏" },
    { id: "linkedin", label: "LinkedIn", subtitle: "B2B + thought leadership", logoText: "in" },
    { id: "bluesky", label: "Bluesky", subtitle: "Decentralized trends", logoText: "🦋" },
];

function usePlatformLogoClassNames() {
    return useMemo(
        () => ({
            reddit: styles.platformLogoReddit,
            x: styles.platformLogoX,
            linkedin: styles.platformLogoLinkedin,
            bluesky: styles.platformLogoBluesky,
        }),
        [],
    );
}

export default function MarketingPipelinePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isDebug = searchParams.get("debug") === "true";
    const [platform, setPlatform] = useState<Platform | null>(null);
    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PipelineResponse["data"] | null>(null);
    const [debugOpen, setDebugOpen] = useState(false);

    const logoClassNames = usePlatformLogoClassNames();
    const selectedPlatform = PLATFORM_OPTIONS.find((option) => option.id === platform) ?? null;

    const runPipeline = async () => {
        setError(null);
        setResult(null);

        if (!platform) {
            setError("Choose a platform to continue.");
            return;
        }

        const normalizedPrompt = prompt.trim();
        if (!normalizedPrompt) {
            setError("Add a short description of what you want to promote.");
            return;
        }

        setLoading(true);
        try {
            const apiUrl = isDebug ? "/api/marketing-pipeline?debug=true" : "/api/marketing-pipeline";
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    platform,
                    prompt: normalizedPrompt,
                }),
            });

            const payload = (await response.json()) as PipelineResponse;
            if (!response.ok || !payload.success || !payload.data) {
                setError(payload.message ?? "We couldn't generate a campaign right now. Please try again.");
                return;
            }

            setResult(payload.data);
        } catch (requestError) {
            console.error("[marketing-pipeline] request error:", requestError);
            setError("Something went wrong talking to the marketing engine. Try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={homeStyles.container}>
            <nav className={homeStyles.navbar}>
                <div className={homeStyles.navContent}>
                    <div
                        className={homeStyles.logoContainer}
                        onClick={() => router.push("/employer/home")}
                        onKeyDown={(e) => e.key === "Enter" && router.push("/employer/home")}
                        role="button"
                        tabIndex={0}
                    >
                        <Brain className={homeStyles.logoIcon} />
                        <span className={homeStyles.logoText}>PDR AI</span>
                    </div>
                    <div className={homeStyles.navActions}>
                        <button
                            type="button"
                            className={styles.backNavButton}
                            onClick={() => router.push("/employer/home")}
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Home
                        </button>
                        <ThemeToggle />
                        <ProfileDropdown />
                    </div>
                </div>
            </nav>

            <main className={styles.main}>
                <div className={styles.pageHeaderRow}>
                    <div className={styles.pageTitleIcon}>
                        <Megaphone className={styles.pageTitleIconInner} />
                    </div>
                    <div>
                        <h1 className={styles.pageTitle}>Marketing Pipeline</h1>
                        <p className={styles.pageSubtitle}>Create campaign-ready posts for Reddit, X, LinkedIn & Bluesky from your company knowledge base</p>
                    </div>
                </div>

            {!platform ? (
                <section className={styles.mainContent}>
                    <section className={styles.platformShell}>
                        <h2 className={styles.platformShellTitle}>Choose platform</h2>
                        <div className={styles.platformGrid}>
                            {PLATFORM_OPTIONS.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={styles.platformCard}
                                    onClick={() => {
                                        setPlatform(option.id);
                                        setError(null);
                                        setResult(null);
                                    }}
                                >
                                    <span
                                        className={`${styles.platformLogo} ${
                                            logoClassNames[option.id]
                                        } ${option.logoImg ? styles.platformLogoImgContainer : ""}`}
                                    >
                                        {option.logoImg ? (
                                            <Image src={option.logoImg} alt="" width={64} height={64} className={styles.platformLogoImg} />
                                        ) : (
                                            option.logoText
                                        )}
                                    </span>
                                    <span className={styles.platformName}>{option.label}</span>
                                    <span className={styles.platformSubtitle}>{option.subtitle}</span>
                                </button>
                            ))}
                        </div>
                        {error && <p className={styles.errorInline}>{error}</p>}
                    </section>
                </section>
            ) : (
                <section className={styles.mainContent}>
                    <section className={styles.workspaceShell}>
                        <div className={styles.workspaceLeft}>
                            <header className={styles.workspaceLeftHeader}>
                                <div className={styles.selectedPlatformPill}>
                                    <span
                                        className={`${styles.selectedPlatformLogo} ${
                                            selectedPlatform ? logoClassNames[selectedPlatform.id] : ""
                                        } ${selectedPlatform?.logoImg ? styles.platformLogoImgContainer : ""}`}
                                    >
                                        {selectedPlatform?.logoImg ? (
                                            <Image src={selectedPlatform.logoImg} alt="" width={64} height={64} className={styles.platformLogoImg} />
                                        ) : (
                                            selectedPlatform?.logoText
                                        )}
                                    </span>
                                    <span className={styles.selectedPlatformLabel}>{selectedPlatform?.label}</span>
                                </div>
                                <button
                                    type="button"
                                    className={styles.changePlatformButton}
                                    onClick={() => {
                                        setPlatform(null);
                                        setPrompt("");
                                        setResult(null);
                                        setError(null);
                                    }}
                                >
                                    Change platform
                                </button>
                            </header>

                            <div className={styles.promptCard}>
                                <div className={styles.promptHeaderRow}>
                                    <h2 className={styles.promptTitle}>Describe what you want to promote</h2>
                                    <span className={styles.promptHint}>1–3 sentences is perfect.</span>
                                </div>
                                <textarea
                                    className={styles.textarea}
                                    value={prompt}
                                    onChange={(event) => setPrompt(event.target.value)}
                                    placeholder="Example: Promote our AI-powered document workflow for startup operations teams this month."
                                />
                                {error && (
                                    <div className={styles.inlineAlert}>
                                        <span>{error}</span>
                                    </div>
                                )}
                                <button
                                    type="button"
                                    className={styles.generateButton}
                                    onClick={runPipeline}
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 size={16} className={styles.spinIcon} />
                                            Generating campaign...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={16} />
                                            Generate campaign draft
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        <aside className={styles.workspaceRight}>
                            <div className={styles.assistantCard}>
                                <header className={styles.assistantHeader}>
                                    <MessageSquareText size={18} className={styles.assistantIcon} />
                                    <h2 className={styles.assistantTitle}>AI Assistant</h2>
                                </header>

                                {!result && !loading && (
                                    <p className={styles.assistantEmptyState}>
                                        Enter a prompt and click Generate.
                                    </p>
                                )}

                                {loading && (
                                    <div className={styles.assistantLoading}>
                                        <Loader2 size={18} className={styles.spinIcon} />
                                        <span>Researching trends and drafting your message...</span>
                                    </div>
                                )}

                                {result && !loading && (
                                    <div className={styles.assistantResult}>
                                        <div className={styles.assistantSectionHeader}>Campaign draft</div>
                                        <div className={styles.outputBlock}>
                                            {`platform: ${result.platform}
message: ${result.message}
image/video: ${result["image/video"]}`}
                                        </div>

                                        {result.research.length > 0 && (
                                            <>
                                                <div className={styles.assistantSectionHeader}>Trend references</div>
                                                <div className={styles.researchList}>
                                                    {result.research.map((item) => (
                                                        <article
                                                            key={`${item.url}-${item.source}`}
                                                            className={styles.researchItem}
                                                        >
                                                            <div className={styles.researchTitle}>{item.title}</div>
                                                            <a
                                                                className={styles.researchLink}
                                                                href={item.url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                            >
                                                                {item.url}
                                                            </a>
                                                            <p className={styles.researchSnippet}>{item.snippet}</p>
                                                        </article>
                                                    ))}
                                                </div>
                                            </>
                                        )}

                                        {isDebug && result.dnaDebug && (
                                            <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border-color, #e5e7eb)", paddingTop: "0.75rem" }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setDebugOpen((prev) => !prev)}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "0.375rem",
                                                        background: "none",
                                                        border: "none",
                                                        cursor: "pointer",
                                                        padding: 0,
                                                        fontSize: "0.75rem",
                                                        fontWeight: 600,
                                                        color: "var(--text-muted, #6b7280)",
                                                    }}
                                                >
                                                    {debugOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    Debug: DNA Source
                                                    <span style={{
                                                        marginLeft: "0.5rem",
                                                        padding: "0.125rem 0.5rem",
                                                        borderRadius: "9999px",
                                                        fontSize: "0.625rem",
                                                        fontWeight: 700,
                                                        textTransform: "uppercase",
                                                        letterSpacing: "0.05em",
                                                        background: result.dnaDebug.source === "metadata" ? "#dcfce7" : "#fef3c7",
                                                        color: result.dnaDebug.source === "metadata" ? "#166534" : "#92400e",
                                                    }}>
                                                        {result.dnaDebug.source}
                                                    </span>
                                                </button>

                                                {debugOpen && (
                                                    <div style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                                                        <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-muted, #6b7280)" }}>
                                                            CompanyDNA
                                                        </div>
                                                        <pre style={{
                                                            background: "var(--bg-secondary, #f9fafb)",
                                                            padding: "0.5rem",
                                                            borderRadius: "0.375rem",
                                                            overflow: "auto",
                                                            maxHeight: "12rem",
                                                            fontSize: "0.6875rem",
                                                            lineHeight: 1.5,
                                                        }}>
                                                            {JSON.stringify(result.dnaDebug.dna, null, 2)}
                                                        </pre>

                                                        <div style={{ fontWeight: 600, marginTop: "0.5rem", marginBottom: "0.25rem", color: "var(--text-muted, #6b7280)" }}>
                                                            Raw context sent to LLM
                                                        </div>
                                                        <pre style={{
                                                            background: "var(--bg-secondary, #f9fafb)",
                                                            padding: "0.5rem",
                                                            borderRadius: "0.375rem",
                                                            overflow: "auto",
                                                            maxHeight: "16rem",
                                                            fontSize: "0.6875rem",
                                                            lineHeight: 1.5,
                                                            whiteSpace: "pre-wrap",
                                                            wordBreak: "break-word",
                                                        }}>
                                                            {result.dnaDebug.contextUsed}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </aside>
                    </section>
                </section>
            )}
            </main>
        </div>
    );
}

