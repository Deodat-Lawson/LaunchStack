"use client";

import React, { useState } from "react";
import { Globe, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";

interface WebsiteSourceTabProps {
    categories: { id: string; name: string }[];
    defaultCategory?: string;
}

export function WebsiteSourceTab({ categories: _categories, defaultCategory }: WebsiteSourceTabProps) {
    const { userId } = useAuth();
    const router = useRouter();

    const [url, setUrl] = useState("");
    const [title, setTitle] = useState("");
    const [category] = useState(defaultCategory ?? "");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");

    // Crawl options
    const [crawlEnabled, setCrawlEnabled] = useState(false);
    const [maxDepth, setMaxDepth] = useState(2);
    const [maxPages, setMaxPages] = useState(20);
    const [jsRender, setJsRender] = useState(false);

    const isValidHttpUrl = (value: string) => {
        try {
            const parsed = new URL(value);
            return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
            return false;
        }
    };

    const handleSubmit = async () => {
        if (!userId || !url.trim()) return;

        if (!isValidHttpUrl(url)) {
            toast.error("Please enter a valid http(s) URL");
            return;
        }

        setIsSubmitting(true);
        setStatus("idle");
        setErrorMessage("");

        try {
            const response = await fetch("/api/upload/website", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId,
                    url: url.trim(),
                    title: title.trim() || undefined,
                    category: category || undefined,
                    ...(crawlEnabled && {
                        crawl: true,
                        maxDepth,
                        maxPages,
                    }),
                    ...(jsRender && { jsRender: true }),
                }),
            });

            const data = (await response.json()) as {
                success?: boolean;
                error?: string;
                message?: string;
                jobId?: string;
                pages?: { url: string; title: string }[];
            };

            if (!response.ok) {
                throw new Error(data.error ?? "Failed to index website");
            }

            setStatus("success");
            toast.success(data.message ?? "Website indexing started!");

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
                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                        <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            Index a Website
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Fetch and extract content from web pages into the knowledge base
                        </p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <Label htmlFor="website-url">Page URL</Label>
                        <Input
                            id="website-url"
                            type="url"
                            placeholder="https://example.com/article"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            className="mt-1"
                            disabled={isSubmitting}
                        />
                        {url && !isValidHttpUrl(url) && (
                            <p className="text-xs text-red-500 mt-1">
                                Enter a valid http(s) URL
                            </p>
                        )}
                    </div>

                    <div>
                        <Label htmlFor="website-title">Document Title (optional)</Label>
                        <Input
                            id="website-title"
                            type="text"
                            placeholder="Derived from <title> if left blank"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="mt-1"
                            disabled={isSubmitting}
                        />
                    </div>

                    {/* Crawl options */}
                    <div className="border border-gray-200 dark:border-purple-500/20 rounded-lg p-4 space-y-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={crawlEnabled}
                                onChange={(e) => setCrawlEnabled(e.target.checked)}
                                disabled={isSubmitting}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Crawl linked pages
                            </span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                                Follow same-domain links and index multiple pages
                            </span>
                        </label>

                        {crawlEnabled && (
                            <div className="ml-6 space-y-3 pt-2">
                                <div>
                                    <Label htmlFor="max-depth" className="text-xs">
                                        Max Depth: {maxDepth}
                                    </Label>
                                    <input
                                        id="max-depth"
                                        type="range"
                                        min={1}
                                        max={3}
                                        value={maxDepth}
                                        onChange={(e) => setMaxDepth(Number(e.target.value))}
                                        disabled={isSubmitting}
                                        className="w-full mt-1"
                                    />
                                    <div className="flex justify-between text-xs text-gray-400">
                                        <span>1 (shallow)</span>
                                        <span>3 (deep)</span>
                                    </div>
                                </div>

                                <div>
                                    <Label htmlFor="max-pages" className="text-xs">
                                        Max Pages
                                    </Label>
                                    <Input
                                        id="max-pages"
                                        type="number"
                                        min={1}
                                        max={50}
                                        value={maxPages}
                                        onChange={(e) => setMaxPages(Number(e.target.value))}
                                        disabled={isSubmitting}
                                        className="mt-1"
                                    />
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        Up to 50 pages per crawl
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* JS rendering option */}
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={jsRender}
                            onChange={(e) => setJsRender(e.target.checked)}
                            disabled={isSubmitting}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Enable JS rendering
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            For single-page apps that require JavaScript
                        </span>
                    </label>

                    {status === "success" && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/30">
                            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                            <span className="text-sm text-green-800 dark:text-green-200">
                                {crawlEnabled
                                    ? "Crawl submitted! Pages are being indexed. Redirecting..."
                                    : "Website submitted for indexing! Redirecting..."}
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

                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !url.trim() || !isValidHttpUrl(url)}
                        className="w-full"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                {crawlEnabled ? "Crawling & Processing..." : "Fetching & Processing..."}
                            </>
                        ) : (
                            <>
                                <Globe className="w-4 h-4 mr-2" />
                                {crawlEnabled ? "Crawl & Index Site" : "Index Page"}
                            </>
                        )}
                    </Button>
                </div>

                <div className="mt-6 p-4 rounded-lg bg-gray-50 dark:bg-slate-800/40 border border-gray-200 dark:border-purple-500/10">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                        How this works
                    </p>
                    <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1 list-disc list-inside">
                        <li>Pages are fetched server-side and cleaned with Readability (boilerplate, ads, and navigation are stripped)</li>
                        <li>Content is converted to Markdown preserving headings, lists, and tables</li>
                        <li>Chunks are split along heading boundaries for better semantic retrieval</li>
                        {crawlEnabled ? (
                            <>
                                <li>Same-domain links are followed up to depth {maxDepth} (max {maxPages} pages)</li>
                                <li>Each crawled page becomes a separate document in the knowledge base</li>
                            </>
                        ) : (
                            <li>Enable &quot;Crawl linked pages&quot; to index multiple pages from the same site</li>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}
