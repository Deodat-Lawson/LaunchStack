"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Brain, Copy, Loader2, MessageSquareText, Megaphone, Pencil, Sparkles } from "lucide-react";
import ProfileDropdown from "~/app/employer/_components/ProfileDropdown";
import { ThemeToggle } from "~/app/_components/ThemeToggle";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "~/app/employer/documents/components/ui/sheet";
import { RewriteWorkflow } from "~/app/employer/documents/components/generator/RewriteWorkflow";
import homeStyles from "~/styles/Employer/Home.module.css";
import styles from "~/styles/Employer/MarketingPipeline.module.css";

type Platform = "x" | "linkedin" | "reddit" | "bluesky";

/** Strip Markdown to plain text for platforms that don't render it (LinkedIn, X, Bluesky). */
function markdownToPlainText(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .trim();
}

/** Convert Markdown to HTML for rich-text paste (LinkedIn composer, etc.). */
function markdownToHtml(text: string): string {
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return escaped
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/_(.+?)_/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br/>");
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
    const [platform, setPlatform] = useState<Platform | null>(null);
    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PipelineResponse["data"] | null>(null);
    const [editableMessage, setEditableMessage] = useState("");
    const [showRewriteSheet, setShowRewriteSheet] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");

    const logoClassNames = usePlatformLogoClassNames();
    const selectedPlatform = PLATFORM_OPTIONS.find((option) => option.id === platform) ?? null;

    useEffect(() => {
        if (result?.message) {
            setEditableMessage(result.message);
            setViewMode("preview");
        }
    }, [result]);

    const handleRewriteComplete = useCallback((rewrittenText: string) => {
        setEditableMessage(rewrittenText);
        setShowRewriteSheet(false);
    }, []);

    const handleCopy = useCallback(async () => {
        if (!editableMessage.trim()) return;
        try {
            const targetPlatform = result?.platform;
            // Reddit renders Markdown in posts → keep **bold** in plain text
            // LinkedIn/X/Bluesky don't → strip to plain text for paste
            const plainText =
                targetPlatform === "reddit" ? editableMessage : markdownToPlainText(editableMessage);
            const html = markdownToHtml(editableMessage);

            if (typeof navigator.clipboard.write === "function") {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        "text/plain": new Blob([plainText], { type: "text/plain" }),
                        "text/html": new Blob([html], { type: "text/html" }),
                    }),
                ]);
            } else {
                await navigator.clipboard.writeText(plainText);
            }
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch {
            setCopySuccess(false);
        }
    }, [editableMessage, result?.platform]);

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
                                        <div className={styles.platformPreviewCard}>
                                            <div className={styles.platformPreviewHeader}>
                                                <span className={`${styles.platformPreviewBadge} ${result.platform === "reddit" ? styles.platformPreviewBadgeReddit : result.platform === "x" ? styles.platformPreviewBadgeX : result.platform === "linkedin" ? styles.platformPreviewBadgeLinkedin : styles.platformPreviewBadgeBluesky}`}>
                                                    {result.platform === "reddit" ? (
                                                        <Image src={REDDIT_SNOO_URL} alt="" width={18} height={18} className={styles.platformPreviewBadgeImg} />
                                                    ) : (
                                                        result.platform === "x" ? "𝕏" : result.platform === "linkedin" ? "in" : "🦋"
                                                    )}
                                                </span>
                                                <span className={styles.platformPreviewLabel}>
                                                    {PLATFORM_OPTIONS.find((p) => p.id === result.platform)?.label ?? result.platform} preview
                                                </span>
                                                <button
                                                    type="button"
                                                    className={styles.viewModeToggle}
                                                    onClick={() => setViewMode((m) => (m === "preview" ? "edit" : "preview"))}
                                                    title={viewMode === "preview" ? "Edit" : "Preview"}
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            </div>
                                            <div className={styles.platformPreviewBody}>
                                                {viewMode === "preview" ? (
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{editableMessage}</ReactMarkdown>
                                                ) : (
                                                    <textarea
                                                        className={styles.editableMessageTextarea}
                                                        value={editableMessage}
                                                        onChange={(e) => setEditableMessage(e.target.value)}
                                                        placeholder="Your campaign message..."
                                                    />
                                                )}
                                            </div>
                                        </div>

                                        <div className={styles.draftActions}>
                                            <button
                                                type="button"
                                                className={styles.refineInRewriteButton}
                                                onClick={() => setShowRewriteSheet(true)}
                                                disabled={!editableMessage.trim()}
                                            >
                                                <Sparkles size={14} />
                                                Refine in Rewrite
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.copyButton}
                                                onClick={handleCopy}
                                                disabled={!editableMessage.trim()}
                                            >
                                                <Copy size={14} />
                                                {copySuccess ? "Copied!" : "Copy to platform"}
                                            </button>
                                        </div>

                                        <Sheet open={showRewriteSheet} onOpenChange={(open) => !open && setShowRewriteSheet(false)}>
                                            <SheetContent
                                                side="right"
                                                className="w-full sm:max-w-2xl overflow-y-auto p-0 flex flex-col"
                                            >
                                                <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
                                                    <SheetTitle className="text-lg font-semibold">Refine your campaign</SheetTitle>
                                                    <p className="text-sm text-muted-foreground">
                                                        Use tone, length, and audience options to refine the message. Preview and accept when you&apos;re happy.
                                                    </p>
                                                </SheetHeader>
                                                <div className="flex-1 overflow-y-auto px-6 py-4">
                                                    <RewriteWorkflow
                                                        initialText={editableMessage}
                                                        onComplete={handleRewriteComplete}
                                                        onCancel={() => setShowRewriteSheet(false)}
                                                    />
                                                </div>
                                            </SheetContent>
                                        </Sheet>

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
                </section>
            )}
            </main>
        </div>
    );
}

