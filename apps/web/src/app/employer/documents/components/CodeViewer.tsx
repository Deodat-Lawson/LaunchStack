"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import "highlight.js/styles/github-dark-dimmed.min.css";
import { Loader2, AlertTriangle, RotateCw, Copy, Check, WrapText, Hash } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";

interface CodeViewerProps {
    url: string;
    title: string;
    mimeType?: string;
}

const EXTENSION_TO_HLJS: Record<string, string> = {
    py: "python",
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    ini: "ini",
    cfg: "ini",
    env: "bash",
    log: "plaintext",
    rst: "plaintext",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    go: "go",
    rs: "rust",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    sh: "bash",
    bash: "bash",
    sql: "sql",
    r: "r",
    lua: "lua",
    pl: "perl",
    scala: "scala",
    md: "markdown",
    html: "xml",
    htm: "xml",
    geojson: "json",
};

function detectLanguage(title: string, url: string): string {
    const combined = `${title} ${url}`;
    const match = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(combined);
    if (match?.[1]) {
        return EXTENSION_TO_HLJS[match[1].toLowerCase()] ?? "plaintext";
    }
    return "plaintext";
}

function detectExtension(title: string, url: string): string {
    const combined = `${title} ${url}`;
    const match = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(combined);
    return match?.[1]?.toLowerCase() ?? "";
}

export function CodeViewer({ url, title, mimeType: _mimeType }: CodeViewerProps) {
    const [code, setCode] = useState<string>("");
    const [highlightedHtml, setHighlightedHtml] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [wordWrap, setWordWrap] = useState(false);
    const [showLineNumbers, setShowLineNumbers] = useState(true);
    const codeRef = useRef<HTMLPreElement>(null);

    const language = detectLanguage(title, url);
    const extension = detectExtension(title, url);

    const fetchCode = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const text = await res.text();
            setCode(text);

            const hljs = (await import("highlight.js/lib/common")).default;
            let result: { value: string };
            try {
                result = hljs.highlight(text, { language });
            } catch {
                result = hljs.highlightAuto(text);
            }
            setHighlightedHtml(result.value);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load file");
        } finally {
            setLoading(false);
        }
    }, [url, language]);

    useEffect(() => {
        void fetchCode();
    }, [fetchCode]);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback
        }
    }, [code]);

    if (loading) {
        return (
            <div className="bg-muted/30 flex h-full flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                <p className="text-muted-foreground text-sm font-medium">Loading source code...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-muted/30 flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-900/20">
                    <AlertTriangle className="h-7 w-7 text-red-500" />
                </div>
                <div>
                    <p className="text-foreground mb-1 text-sm font-medium">
                        Failed to load source code
                    </p>
                    <p className="text-muted-foreground mb-4 text-xs">{error}</p>
                    <button
                        onClick={() => void fetchCode()}
                        className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                    >
                        <RotateCw className="h-4 w-4" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const lineCount = code.split("\n").length;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[var(--code-bg)] text-[var(--code-ink)]">
            {/* Toolbar */}
            <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--code-line)] bg-[var(--code-bg-2)] px-4 py-2">
                <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-semibold text-[var(--code-accent)]">
                        {extension ? `.${extension}` : language}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--code-ink-muted)]">
                        {lineCount} lines &middot; {(new Blob([code]).size / 1024).toFixed(1)} KB
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    <TooltipProvider delayDuration={300}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={`h-7 w-7 rounded-md ${showLineNumbers ? "bg-[var(--code-accent-soft)] text-[var(--code-accent)]" : "text-[var(--code-ink-muted)]"} hover:bg-[var(--code-accent-soft)] hover:text-[var(--code-accent)]`}
                                    onClick={() => setShowLineNumbers(!showLineNumbers)}
                                >
                                    <Hash className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p className="text-xs">Toggle line numbers</p>
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={`h-7 w-7 rounded-md ${wordWrap ? "bg-[var(--code-accent-soft)] text-[var(--code-accent)]" : "text-[var(--code-ink-muted)]"} hover:bg-[var(--code-accent-soft)] hover:text-[var(--code-accent)]`}
                                    onClick={() => setWordWrap(!wordWrap)}
                                >
                                    <WrapText className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p className="text-xs">Toggle word wrap</p>
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 rounded-md text-[var(--code-ink-muted)] hover:bg-[var(--code-accent-soft)] hover:text-[var(--code-accent)]"
                                    onClick={() => void handleCopy()}
                                >
                                    {copied ? (
                                        <Check className="h-3.5 w-3.5 text-green-400" />
                                    ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p className="text-xs">{copied ? "Copied!" : "Copy code"}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Code content */}
            <div className="custom-code-scrollbar flex-1 overflow-auto">
                <pre
                    ref={codeRef}
                    className={`m-0 p-0 font-mono text-[13px] leading-[1.6] ${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
                >
                    <code className={`hljs language-${language}`}>
                        {code.split("\n").map((line, i) => (
                            <div
                                key={i}
                                className="flex transition-colors duration-75 hover:bg-[var(--code-bg-2)]"
                            >
                                {showLineNumbers && (
                                    <span className="inline-block min-w-[3.5rem] flex-shrink-0 select-none border-r border-[var(--code-line)] pl-4 pr-4 text-right text-[var(--code-ink-muted)]">
                                        {i + 1}
                                    </span>
                                )}
                                <span
                                    className="flex-1 pl-4 pr-4"
                                    dangerouslySetInnerHTML={{
                                        __html: highlightedHtml
                                            ? (highlightedHtml.split("\n")[i] ?? "")
                                            : line
                                                  .replace(/&/g, "&amp;")
                                                  .replace(/</g, "&lt;")
                                                  .replace(/>/g, "&gt;"),
                                    }}
                                />
                            </div>
                        ))}
                    </code>
                </pre>
            </div>

            <style jsx global>{`
                .custom-code-scrollbar::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                .custom-code-scrollbar::-webkit-scrollbar-track {
                    background: var(--code-bg);
                }
                .custom-code-scrollbar::-webkit-scrollbar-thumb {
                    background: var(--code-line);
                    border-radius: 4px;
                }
                .custom-code-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: var(--code-ink-muted);
                }
                .custom-code-scrollbar::-webkit-scrollbar-corner {
                    background: var(--code-bg);
                }
            `}</style>
        </div>
    );
}
