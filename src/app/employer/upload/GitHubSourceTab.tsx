"use client";

import React, { useState } from "react";
import {
    Github,
    Loader2,
    ChevronDown,
    ChevronUp,
    Lock,
    CheckCircle,
    AlertCircle,
} from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "~/app/employer/documents/components/ui/collapsible";

interface GitHubSourceTabProps {
    categories: { id: string; name: string }[];
    defaultCategory?: string;
}

export function GitHubSourceTab({ categories, defaultCategory }: GitHubSourceTabProps) {
    const { userId } = useAuth();
    const router = useRouter();

    const [repoUrl, setRepoUrl] = useState("");
    const [branch, setBranch] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [category, setCategory] = useState(defaultCategory ?? "");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);

    const isValidGitHubUrl = (url: string) => {
        try {
            const parsed = new URL(url);
            return (
                (parsed.hostname === "github.com" ||
                    parsed.hostname === "www.github.com") &&
                parsed.pathname.split("/").filter(Boolean).length >= 2
            );
        } catch {
            return false;
        }
    };

    const handleSubmit = async () => {
        if (!userId || !repoUrl.trim()) return;

        if (!isValidGitHubUrl(repoUrl)) {
            toast.error("Please enter a valid GitHub repository URL");
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
                    userId,
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

            if (!response.ok) {
                throw new Error(data.error ?? "Failed to index repository");
            }

            setStatus("success");
            toast.success(data.message ?? "Repository indexing started!");

            setTimeout(() => {
                router.push("/employer/documents");
            }, 2000);
        } catch (err) {
            setStatus("error");
            const msg = err instanceof Error ? err.message : "Unknown error";
            setErrorMessage(msg);
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-gray-900 dark:bg-white/10 flex items-center justify-center">
                        <Github className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            Index a GitHub Repository
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            We&apos;ll clone, extract, and index all supported files from the repo
                        </p>
                    </div>
                </div>

                <div className="space-y-4">
                    {/* Repo URL */}
                    <div>
                        <Label htmlFor="github-url">Repository URL</Label>
                        <Input
                            id="github-url"
                            type="url"
                            placeholder="https://github.com/owner/repository"
                            value={repoUrl}
                            onChange={(e) => setRepoUrl(e.target.value)}
                            className="mt-1"
                            disabled={isSubmitting}
                        />
                        {repoUrl && !isValidGitHubUrl(repoUrl) && (
                            <p className="text-xs text-red-500 mt-1">
                                Enter a valid GitHub URL (e.g., https://github.com/owner/repo)
                            </p>
                        )}
                    </div>

                    {/* Branch (optional) */}
                    <div>
                        <Label htmlFor="github-branch">Branch (optional)</Label>
                        <Input
                            id="github-branch"
                            type="text"
                            placeholder="main (default)"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            className="mt-1"
                            disabled={isSubmitting}
                        />
                    </div>

                    {/* Private repo token */}
                    <div>
                        <button
                            type="button"
                            onClick={() => setShowToken(!showToken)}
                            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                        >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Private repository? Add access token</span>
                            {showToken ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                            )}
                        </button>
                        {showToken && (
                            <div className="mt-2">
                                <Input
                                    type="password"
                                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                                    value={accessToken}
                                    onChange={(e) => setAccessToken(e.target.value)}
                                    disabled={isSubmitting}
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    A personal access token with <code>repo</code> scope.
                                    Not stored permanently.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Status messages */}
                    {status === "success" && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/30">
                            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                            <span className="text-sm text-green-800 dark:text-green-200">
                                Repository submitted for indexing! Redirecting...
                            </span>
                        </div>
                    )}

                    {status === "error" && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30">
                            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5" />
                            <span className="text-sm text-red-800 dark:text-red-200">
                                {errorMessage}
                            </span>
                        </div>
                    )}

                    {/* Submit */}
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !repoUrl.trim() || !isValidGitHubUrl(repoUrl)}
                        className="w-full"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Downloading &amp; Processing...
                            </>
                        ) : (
                            <>
                                <Github className="w-4 h-4 mr-2" />
                                Index Repository
                            </>
                        )}
                    </Button>
                </div>

                {/* What gets indexed */}
                <div className="mt-6 p-4 rounded-lg bg-gray-50 dark:bg-slate-800/40 border border-gray-200 dark:border-purple-500/10">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                        What gets indexed
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <span>Markdown (.md)</span>
                        <span>Python (.py)</span>
                        <span>TypeScript (.ts, .tsx)</span>
                        <span>JavaScript (.js, .jsx)</span>
                        <span>HTML, CSS, JSON</span>
                        <span>Go, Rust, Java, C++</span>
                        <span>YAML, TOML, .env</span>
                        <span>README, Dockerfile, etc.</span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        Binary files, node_modules, .git, and other non-text files are automatically skipped.
                    </p>
                </div>
            </div>

            {/* Advanced: Manual Issues/PRs import */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                    <button className="w-full px-4 py-3 flex items-center gap-3 rounded-lg border border-dashed border-gray-300 dark:border-purple-500/30 hover:border-purple-400 dark:hover:border-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors text-left">
                        <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                                Advanced: Import Issues &amp; Pull Requests
                            </span>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                Use the GitHub CLI to export issues/PRs as JSON, then upload them via the Files tab
                            </p>
                        </div>
                        {showAdvanced ? (
                            <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        )}
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="mt-3 p-4 bg-gray-50 dark:bg-slate-800/40 rounded-lg border border-gray-200 dark:border-purple-500/20 text-sm text-gray-700 dark:text-gray-300 space-y-4">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            Requires the <code className="px-1 py-0.5 bg-gray-200 dark:bg-slate-700 rounded text-[11px]">gh</code> CLI. Run these in your terminal:
                        </p>
                        <div>
                            <p className="font-medium text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wide mb-1.5">
                                Issues
                            </p>
                            <pre className="bg-gray-200 dark:bg-slate-700 text-xs p-3 rounded-md overflow-x-auto"><code className="whitespace-pre-wrap break-all">gh issue list --state all --limit 1000 --json number,title,body,state,labels,author,createdAt,closedAt,comments &gt; issues.json</code></pre>
                        </div>
                        <div>
                            <p className="font-medium text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wide mb-1.5">
                                Pull Requests
                            </p>
                            <pre className="bg-gray-200 dark:bg-slate-700 text-xs p-3 rounded-md overflow-x-auto"><code className="whitespace-pre-wrap break-all">gh pr list --state all --limit 1000 --json number,title,body,state,labels,author,createdAt,mergedAt,comments &gt; prs.json</code></pre>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-200 dark:border-slate-700">
                            Then upload the resulting JSON files via the <strong>Files &amp; Folders</strong> tab.
                        </p>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
