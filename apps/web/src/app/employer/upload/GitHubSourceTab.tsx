"use client";

import React, { useState } from "react";
import { Loader2, ChevronDown, ChevronUp, Lock, CheckCircle, AlertCircle } from "lucide-react";
import { IconGithub } from "~/components/icons/brand";
import { useAuth } from "~/lib/auth-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface GitHubSourceTabProps {
    categories: { id: string; name: string }[];
    defaultCategory?: string;
}

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--ink-2)",
    marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 9,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    fontSize: 14,
    color: "var(--ink)",
    outline: "none",
    fontFamily: "inherit",
};

const codeBlockStyle: React.CSSProperties = {
    background: "var(--line-2)",
    color: "var(--ink-2)",
    fontSize: 11.5,
    padding: "10px 12px",
    borderRadius: 8,
    overflowX: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: 1.5,
    wordBreak: "break-all",
    whiteSpace: "pre-wrap",
    margin: 0,
};

export function GitHubSourceTab({
    categories: _categories,
    defaultCategory,
}: GitHubSourceTabProps) {
    const t = useTranslations("upload.github");
    const { userId } = useAuth();
    const router = useRouter();

    const [repoUrl, setRepoUrl] = useState("");
    const [branch, setBranch] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [category] = useState(defaultCategory ?? "");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);

    const isValidGitHubUrl = (url: string) => {
        try {
            const parsed = new URL(url);
            return (
                (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") &&
                parsed.pathname.split("/").filter(Boolean).length >= 2
            );
        } catch {
            return false;
        }
    };

    const handleSubmit = async () => {
        if (!userId || !repoUrl.trim()) return;
        if (!isValidGitHubUrl(repoUrl)) {
            toast.error(t("invalidUrlToast"));
            return;
        }

        setIsSubmitting(true);
        setStatus("idle");
        setErrorMessage("");

        try {
            const response = await fetch("/api/upload/github-repo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    repoUrl: repoUrl.trim(),
                    branch: branch.trim() || undefined,
                    accessToken: accessToken.trim() || undefined,
                    category: category || undefined,
                }),
            });

            const data = (await response.json()) as {
                success?: boolean;
                error?: string;
                message?: string;
                jobId?: string;
            };

            if (!response.ok) throw new Error(data.error ?? t("indexFailed"));

            setStatus("success");
            toast.success(data.message ?? t("indexStarted"));
            setTimeout(() => router.push("/employer/documents"), 2000);
        } catch (err) {
            setStatus("error");
            const msg = err instanceof Error ? err.message : t("unknownError");
            setErrorMessage(msg);
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const disabled = isSubmitting || !repoUrl.trim() || !isValidGitHubUrl(repoUrl);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                    <label htmlFor="github-url" style={labelStyle}>
                        {t("urlLabel")}
                    </label>
                    <input
                        id="github-url"
                        type="url"
                        placeholder="https://github.com/owner/repository"
                        value={repoUrl}
                        onChange={e => setRepoUrl(e.target.value)}
                        disabled={isSubmitting}
                        style={inputStyle}
                    />
                    {repoUrl && !isValidGitHubUrl(repoUrl) && (
                        <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 4 }}>
                            {t("invalidUrl")}
                        </div>
                    )}
                </div>

                <div>
                    <label htmlFor="github-branch" style={labelStyle}>
                        {t("branchLabel")}
                    </label>
                    <input
                        id="github-branch"
                        type="text"
                        placeholder={t("branchPlaceholder")}
                        value={branch}
                        onChange={e => setBranch(e.target.value)}
                        disabled={isSubmitting}
                        style={inputStyle}
                    />
                </div>

                <div>
                    <button
                        type="button"
                        onClick={() => setShowToken(v => !v)}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            background: "transparent",
                            border: "none",
                            color: "var(--ink-2)",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                            padding: 0,
                        }}
                    >
                        <Lock size={12} />
                        {t("tokenToggle")}
                        {showToken ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    {showToken && (
                        <div style={{ marginTop: 8 }}>
                            <input
                                type="password"
                                placeholder={`<${t("tokenPlaceholder")}>`}
                                value={accessToken}
                                onChange={e => setAccessToken(e.target.value)}
                                disabled={isSubmitting}
                                style={inputStyle}
                            />
                            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                                {t.rich("tokenHint", { code: chunks => <code>{chunks}</code> })}
                            </div>
                        </div>
                    )}
                </div>

                {status === "success" && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "10px 14px",
                            borderRadius: 10,
                            background: "oklch(0.95 0.05 155)",
                            color: "oklch(0.4 0.14 155)",
                            fontSize: 13,
                        }}
                    >
                        <CheckCircle size={14} />
                        {t("submitted")}
                    </div>
                )}

                {status === "error" && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "10px 14px",
                            borderRadius: 10,
                            background: "oklch(0.96 0.04 25)",
                            color: "var(--danger)",
                            fontSize: 13,
                        }}
                    >
                        <AlertCircle size={14} style={{ marginTop: 2 }} />
                        <span>{errorMessage}</span>
                    </div>
                )}

                <button
                    onClick={() => void handleSubmit()}
                    disabled={disabled}
                    style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: 10,
                        background: disabled ? "var(--line)" : "var(--accent)",
                        color: disabled ? "var(--ink-3)" : "white",
                        fontSize: 13.5,
                        fontWeight: 600,
                        border: "none",
                        cursor: disabled ? "not-allowed" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        boxShadow: disabled ? "none" : "0 1px 4px var(--accent-glow)",
                    }}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 size={14} className="animate-spin" />
                            {t("submitting")}
                        </>
                    ) : (
                        <>
                            <IconGithub size={14} />
                            {t("submit")}
                        </>
                    )}
                </button>
            </div>

            <div
                style={{
                    padding: 14,
                    borderRadius: 10,
                    background: "var(--line-2)",
                    fontSize: 12,
                    color: "var(--ink-3)",
                    lineHeight: 1.55,
                }}
            >
                <div style={{ fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>
                    {t("indexedTitle")}
                </div>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "2px 12px",
                        fontSize: 11.5,
                    }}
                >
                    <span>Markdown (.md)</span>
                    <span>Python (.py)</span>
                    <span>TypeScript (.ts, .tsx)</span>
                    <span>JavaScript (.js, .jsx)</span>
                    <span>HTML, CSS, JSON</span>
                    <span>Go, Rust, Java, C++</span>
                    <span>YAML, TOML, .env</span>
                    <span>{t("indexedMore")}</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 11 }}>{t("skipped")}</div>
            </div>

            <div>
                <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    style={{
                        width: "100%",
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        borderRadius: 10,
                        border: "1px dashed var(--line)",
                        background: "transparent",
                        color: "var(--ink-2)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                    }}
                >
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                            {t("advancedTitle")}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                            {t("advancedBody")}
                        </div>
                    </div>
                    {showAdvanced ? (
                        <ChevronUp size={14} color="var(--ink-3)" />
                    ) : (
                        <ChevronDown size={14} color="var(--ink-3)" />
                    )}
                </button>
                {showAdvanced && (
                    <div
                        style={{
                            marginTop: 10,
                            padding: 14,
                            borderRadius: 10,
                            background: "var(--line-2)",
                            fontSize: 12,
                            color: "var(--ink-2)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                            {t.rich("requiresCli", {
                                code: chunks => (
                                    <code
                                        style={{
                                            padding: "1px 5px",
                                            background: "var(--line)",
                                            borderRadius: 4,
                                            fontSize: 10.5,
                                        }}
                                    >
                                        {chunks}
                                    </code>
                                ),
                            })}
                        </div>
                        <div>
                            <div
                                className="mono"
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: "0.1em",
                                    color: "var(--ink-3)",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                }}
                            >
                                {t("issues")}
                            </div>
                            <pre style={codeBlockStyle}>
                                <code>
                                    gh issue list --state all --limit 1000 --json
                                    number,title,body,state,labels,author,createdAt,closedAt,comments
                                    &gt; issues.json
                                </code>
                            </pre>
                        </div>
                        <div>
                            <div
                                className="mono"
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: "0.1em",
                                    color: "var(--ink-3)",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                }}
                            >
                                {t("pullRequests")}
                            </div>
                            <pre style={codeBlockStyle}>
                                <code>
                                    gh pr list --state all --limit 1000 --json
                                    number,title,body,state,labels,author,createdAt,mergedAt,comments
                                    &gt; prs.json
                                </code>
                            </pre>
                        </div>
                        <div
                            style={{
                                fontSize: 11,
                                color: "var(--ink-3)",
                                paddingTop: 8,
                                borderTop: "1px solid var(--line)",
                            }}
                        >
                            {t.rich("thenUpload", { strong: chunks => <strong>{chunks}</strong> })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
