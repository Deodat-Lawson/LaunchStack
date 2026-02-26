"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquareText, Rocket, Sparkles } from "lucide-react";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

type Platform = "x" | "linkedin" | "reddit";

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
    };
}

const PLATFORM_OPTIONS: Array<{ id: Platform; label: string; subtitle: string; logoText: string }> = [
    { id: "reddit", label: "Reddit", subtitle: "Community-first threads", logoText: "reddit" },
    { id: "x", label: "Twitter / X", subtitle: "Fast-moving trends", logoText: "𝕏" },
    { id: "linkedin", label: "LinkedIn", subtitle: "B2B + thought leadership", logoText: "in" },
];

function usePlatformLogoClassNames() {
    return useMemo(
        () => ({
            reddit: styles.platformLogoReddit,
            x: styles.platformLogoX,
            linkedin: styles.platformLogoLinkedin,
        }),
        [],
    );
}

export default function MarketingPipelinePage() {
    const router = useRouter();
    const [platform, setPlatform] = useState<Platform | null>(null);
    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PipelineResponse["data"] | null>(null);

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
            const response = await fetch("/api/marketing-pipeline", {
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
        <div className={styles.pageRoot}>
            <div className={styles.pageHeader}>
                <div className={styles.pageHeaderInner}>
                    <div className={styles.pageTitleRow}>
                        <div className={styles.pageTitleIcon}>
                            <Rocket className={styles.pageTitleIconInner} />
                        </div>
                        <div>
                            <h1 className={styles.pageTitle}>Marketing Pipeline</h1>
                            <p className={styles.pageSubtitle}>
                                Turn your company knowledge base into platform-ready marketing messages.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className={styles.pageHeaderSecondary}
                        onClick={() => router.push("/employer/home")}
                    >
                        Back to employer home
                    </button>
                </div>
            </div>

            {!platform ? (
                <main className={styles.mainShell}>
                    <section className={styles.platformShell}>
                        <div className={styles.platformShellHeader}>
                            <h2 className={styles.platformShellTitle}>Choose a channel to start</h2>
                            <p className={styles.platformShellSubtitle}>
                                Pick where this campaign will live. You can always come back and run again for a
                                different platform.
                            </p>
                        </div>
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
                                        }`}
                                    >
                                        {option.logoText}
                                    </span>
                                    <span className={styles.platformName}>{option.label}</span>
                                    <span className={styles.platformSubtitle}>{option.subtitle}</span>
                                </button>
                            ))}
                        </div>
                        {error && <p className={styles.errorInline}>{error}</p>}
                    </section>
                </main>
            ) : (
                <main className={styles.mainShell}>
                    <section className={styles.workspaceShell}>
                        <div className={styles.workspaceLeft}>
                            <header className={styles.workspaceLeftHeader}>
                                <div className={styles.selectedPlatformPill}>
                                    <span
                                        className={`${styles.selectedPlatformLogo} ${
                                            selectedPlatform ? logoClassNames[selectedPlatform.id] : ""
                                        }`}
                                    >
                                        {selectedPlatform?.logoText}
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
                                    className={styles.promptTextarea}
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
                                    <div className={styles.assistantIconWrap}>
                                        <MessageSquareText size={18} className={styles.assistantIcon} />
                                    </div>
                                    <div>
                                        <h2 className={styles.assistantTitle}>AI Assistant</h2>
                                        <p className={styles.assistantSubtitle}>
                                            Uses your company KB + live trends to shape the copy.
                                        </p>
                                    </div>
                                </header>

                                {!result && !loading && (
                                    <div className={styles.assistantEmptyState}>
                                        <p className={styles.assistantEmptyTitle}>
                                            Fill in the prompt and click &quot;Generate campaign draft&quot;.
                                        </p>
                                        <ul className={styles.assistantEmptyList}>
                                            <li>Aligns wording with your company documents and categories.</li>
                                            <li>Pulls recent trending angles for the selected platform.</li>
                                            <li>Returns a normalized block you can paste into your scheduler.</li>
                                        </ul>
                                    </div>
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
                                    </div>
                                )}
                            </div>
                        </aside>
                    </section>
                </main>
            )}
        </div>
    );
}

