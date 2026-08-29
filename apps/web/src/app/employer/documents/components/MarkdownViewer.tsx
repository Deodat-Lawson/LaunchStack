"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark-dimmed.min.css";
import type { ElementContent } from "hast";
import { Loader2, AlertTriangle, RotateCw, Copy, Check, List, Code2, BookOpen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { CodeViewer } from "./CodeViewer";

interface MarkdownViewerProps {
    url: string;
    title: string;
}

interface TocItem {
    id: string;
    text: string;
    level: number;
}

/** GitHub-style anchor slugs: lowercase, drop punctuation, spaces → hyphens. */
function slugify(text: string): string {
    return (
        text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, "")
            .replace(/\s+/g, "-") || "section"
    );
}

/** Collect the plain text under a hast node (for pulling code out of <pre>). */
function hastText(node: ElementContent): string {
    if (node.type === "text") return node.value;
    if (node.type === "element") return node.children.map(hastText).join("");
    return "";
}

/**
 * Fenced code block with highlight.js colors, a language label, and a copy
 * button. Highlighting is best-effort: until (or unless) hljs loads, the block
 * shows plain escaped text.
 */
function CodeBlock({ code, language }: { code: string; language: string }) {
    const [html, setHtml] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const hljs = (await import("highlight.js/lib/common")).default;
                const result =
                    language && hljs.getLanguage(language)
                        ? hljs.highlight(code, { language })
                        : hljs.highlightAuto(code);
                if (!cancelled) setHtml(result.value);
            } catch {
                /* plain text fallback is already on screen */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [code, language]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard unavailable */
        }
    };

    return (
        <div className="md-codeblock">
            <div className="md-codeblock-head">
                <span className="md-codeblock-lang">{language || "text"}</span>
                <button
                    type="button"
                    className="md-codeblock-copy"
                    onClick={() => void copy()}
                    aria-label={copied ? "Copied" : "Copy code"}
                >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
            </div>
            {html !== null ? (
                <pre>
                    <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
                </pre>
            ) : (
                <pre>
                    <code className="hljs">{code}</code>
                </pre>
            )}
        </div>
    );
}

/**
 * ```mermaid fences render as diagrams. `securityLevel: "strict"` because the
 * source is an uploaded file; if the diagram doesn't parse, fall back to
 * showing it as a code block rather than an error wall.
 */
function MermaidBlock({ code }: { code: string }) {
    const [svg, setSvg] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const idRef = useRef(`md-mermaid-${Math.random().toString(36).slice(2)}`);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const mermaid = (await import("mermaid")).default;
                const dark = document.documentElement.getAttribute("data-theme") === "dark";
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "strict",
                    theme: dark ? "dark" : "neutral",
                });
                const rendered = await mermaid.render(idRef.current, code);
                if (!cancelled) setSvg(rendered.svg);
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [code]);

    if (failed) return <CodeBlock code={code} language="mermaid" />;
    if (svg === null) {
        return (
            <div className="md-mermaid md-mermaid-loading">
                <Loader2 className="h-4 w-4 animate-spin" /> Rendering diagram…
            </div>
        );
    }
    return <div className="md-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function MarkdownViewer({ url, title }: MarkdownViewerProps) {
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
    const [tocOpen, setTocOpen] = useState(true);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [activeHeading, setActiveHeading] = useState<string | null>(null);
    const articleRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchContent = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            setContent(await res.text());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load file");
        } finally {
            setLoading(false);
        }
    }, [url]);

    useEffect(() => {
        void fetchContent();
    }, [fetchContent]);

    // Assign heading ids and build the outline from the rendered DOM (rather
    // than re-parsing the source) so the outline always matches what's on
    // screen, inline formatting and all.
    useEffect(() => {
        if (loading || viewMode !== "rendered") return;
        const root = articleRef.current;
        if (!root) return;
        const seen = new Map<string, number>();
        const items: TocItem[] = [];
        root.querySelectorAll<HTMLElement>("h1, h2, h3, h4").forEach(el => {
            const text = el.textContent ?? "";
            const base = slugify(text);
            const n = seen.get(base) ?? 0;
            seen.set(base, n + 1);
            const id = n === 0 ? base : `${base}-${n}`;
            el.id = id;
            items.push({ id, text, level: Number(el.tagName.slice(1)) });
        });
        setToc(items);
    }, [content, loading, viewMode]);

    // Scroll spy: light up the outline entry for the heading in view.
    useEffect(() => {
        if (toc.length === 0 || typeof IntersectionObserver === "undefined") return;
        const root = articleRef.current;
        if (!root) return;
        const observer = new IntersectionObserver(
            entries => {
                const visible = entries.filter(e => e.isIntersecting);
                if (visible.length > 0 && visible[0]?.target.id) {
                    setActiveHeading(visible[0].target.id);
                }
            },
            { root: scrollRef.current, rootMargin: "0px 0px -70% 0px" }
        );
        toc.forEach(item => {
            const el = root.querySelector(`#${CSS.escape(item.id)}`);
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [toc]);

    const scrollToId = useCallback((id: string) => {
        const el = articleRef.current?.querySelector(`#${CSS.escape(id)}`);
        el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, []);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard unavailable */
        }
    }, [content]);

    const stats = useMemo(() => {
        const words = content.split(/\s+/).filter(Boolean).length;
        const minutes = Math.max(1, Math.ceil(words / 220));
        const kb = new Blob([content]).size / 1024;
        return { words, minutes, kb };
    }, [content]);

    if (loading) {
        return (
            <div className="bg-panel-2/30 flex h-full flex-col items-center justify-center gap-3">
                <Loader2 className="text-brand-ink h-8 w-8 animate-spin" />
                <p className="text-ink-3 text-sm font-medium">Loading document...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-panel-2/30 flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-900/20">
                    <AlertTriangle className="h-7 w-7 text-red-500" />
                </div>
                <div>
                    <p className="text-ink mb-1 text-sm font-medium">Failed to load document</p>
                    <p className="text-ink-3 mb-4 text-xs">{error}</p>
                    <button
                        onClick={() => void fetchContent()}
                        className="bg-brand hover:bg-brand-hi inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                    >
                        <RotateCw className="h-4 w-4" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (viewMode === "source") {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="border-line bg-panel flex flex-shrink-0 items-center justify-between border-b px-4 py-2">
                    <span className="text-ink-3 font-mono text-[10px]">
                        Markdown source &middot; {stats.kb.toFixed(1)} KB
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-brand-ink hover:bg-brand-soft h-7 gap-1.5 rounded-md px-2 text-[11px] font-semibold"
                        onClick={() => setViewMode("rendered")}
                    >
                        <BookOpen className="h-3.5 w-3.5" />
                        Rendered view
                    </Button>
                </div>
                <div className="min-h-0 flex-1">
                    <CodeViewer url={url} title={title} mimeType="text/markdown" />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-surface flex h-full flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="border-line bg-panel flex flex-shrink-0 items-center justify-between border-b px-4 py-2">
                <span className="text-ink-3 font-mono text-[10px]">
                    {stats.words.toLocaleString()} words &middot; {stats.minutes} min read &middot;{" "}
                    {stats.kb.toFixed(1)} KB
                </span>
                <div className="flex items-center gap-1">
                    <TooltipProvider delayDuration={300}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Toggle outline"
                                    className={`h-7 w-7 rounded-md ${tocOpen && toc.length > 0 ? "bg-brand-soft text-brand-ink" : "text-ink-3"} hover:bg-brand-soft hover:text-brand-ink`}
                                    onClick={() => setTocOpen(o => !o)}
                                >
                                    <List className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p className="text-xs">Toggle outline</p>
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="View source"
                                    className="text-ink-3 hover:bg-brand-soft hover:text-brand-ink h-7 w-7 rounded-md"
                                    onClick={() => setViewMode("source")}
                                >
                                    <Code2 className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p className="text-xs">View source</p>
                            </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Copy markdown"
                                    className="text-ink-3 hover:bg-brand-soft hover:text-brand-ink h-7 w-7 rounded-md"
                                    onClick={() => void handleCopy()}
                                >
                                    {copied ? (
                                        <Check className="text-ok h-3.5 w-3.5" />
                                    ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                <p className="text-xs">{copied ? "Copied!" : "Copy markdown"}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Content + outline */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
                <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
                    <div ref={articleRef} className="md-doc">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                pre: ({ node }) => {
                                    // <pre><code class="language-x">…</code></pre>
                                    const codeNode = node?.children[0];
                                    if (
                                        !codeNode ||
                                        codeNode.type !== "element" ||
                                        codeNode.tagName !== "code"
                                    ) {
                                        return null;
                                    }
                                    const cls = codeNode.properties.className;
                                    const classes = Array.isArray(cls) ? cls.map(String) : [];
                                    const lang =
                                        classes
                                            .find(c => c.startsWith("language-"))
                                            ?.slice("language-".length) ?? "";
                                    const code = hastText(codeNode).replace(/\n$/, "");
                                    return lang === "mermaid" ? (
                                        <MermaidBlock code={code} />
                                    ) : (
                                        <CodeBlock code={code} language={lang} />
                                    );
                                },
                                a: ({ href, children, ...props }) => {
                                    if (href?.startsWith("#")) {
                                        const id = href.slice(1);
                                        return (
                                            <a
                                                {...props}
                                                href={href}
                                                onClick={e => {
                                                    e.preventDefault();
                                                    scrollToId(id);
                                                }}
                                            >
                                                {children}
                                            </a>
                                        );
                                    }
                                    return (
                                        <a
                                            {...props}
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {children}
                                        </a>
                                    );
                                },
                                table: ({ children, ...props }) => (
                                    <div className="md-table-wrap">
                                        <table {...props}>{children}</table>
                                    </div>
                                ),
                                img: ({ alt, ...props }) => (
                                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote/user content, next/image needs configured domains
                                    <img alt={alt ?? ""} loading="lazy" {...props} />
                                ),
                            }}
                        >
                            {content}
                        </ReactMarkdown>
                    </div>
                </div>

                {tocOpen && toc.length > 0 && (
                    <nav aria-label="Document outline" className="md-toc">
                        <div className="md-toc-title">On this page</div>
                        {toc.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                className={`md-toc-item ${activeHeading === item.id ? "md-toc-item-active" : ""}`}
                                style={{ paddingLeft: 10 + (item.level - 1) * 12 }}
                                onClick={() => scrollToId(item.id)}
                            >
                                {item.text}
                            </button>
                        ))}
                    </nav>
                )}
            </div>

            <style jsx global>{`
                /* ── Document typography ─────────────────────────────── */
                .md-doc {
                    max-width: 780px;
                    margin: 0 auto;
                    padding: 40px 48px 96px;
                    font-size: 15px;
                    line-height: 1.75;
                    color: var(--ink-2);
                    overflow-wrap: break-word;
                }
                .md-doc h1,
                .md-doc h2,
                .md-doc h3,
                .md-doc h4,
                .md-doc h5,
                .md-doc h6 {
                    font-family: var(--font-serif);
                    color: var(--ink);
                    font-weight: 600;
                    line-height: 1.3;
                    margin: 1.8em 0 0.6em;
                    scroll-margin-top: 16px;
                }
                .md-doc h1 {
                    font-size: 28px;
                    margin-top: 0.4em;
                    padding-bottom: 0.35em;
                    border-bottom: 1px solid var(--line);
                }
                .md-doc h2 {
                    font-size: 22px;
                    padding-bottom: 0.3em;
                    border-bottom: 1px solid var(--line);
                }
                .md-doc h3 {
                    font-size: 18px;
                }
                .md-doc h4 {
                    font-size: 16px;
                }
                .md-doc h5,
                .md-doc h6 {
                    font-size: 14px;
                }
                .md-doc p {
                    margin: 0 0 1em;
                }
                .md-doc a {
                    color: var(--accent-ink);
                    text-decoration: underline;
                    text-underline-offset: 3px;
                    text-decoration-color: color-mix(in oklch, var(--accent-ink) 40%, transparent);
                }
                .md-doc a:hover {
                    text-decoration-color: var(--accent-ink);
                }
                .md-doc strong {
                    color: var(--ink);
                    font-weight: 600;
                }
                .md-doc ul,
                .md-doc ol {
                    margin: 0 0 1em;
                    padding-left: 1.6em;
                }
                .md-doc li {
                    margin: 0.3em 0;
                }
                .md-doc li > ul,
                .md-doc li > ol {
                    margin-bottom: 0;
                }
                .md-doc ul {
                    list-style: disc;
                }
                .md-doc ul ul {
                    list-style: circle;
                }
                .md-doc ol {
                    list-style: decimal;
                }
                .md-doc li.task-list-item {
                    list-style: none;
                    margin-left: -1.4em;
                }
                .md-doc li.task-list-item input[type="checkbox"] {
                    accent-color: var(--accent);
                    margin-right: 0.5em;
                    vertical-align: -0.1em;
                }
                .md-doc blockquote {
                    margin: 0 0 1em;
                    padding: 10px 18px;
                    border-left: 3px solid var(--accent);
                    border-radius: 0 8px 8px 0;
                    background: var(--panel-2);
                    color: var(--ink-3);
                }
                .md-doc blockquote > :last-child {
                    margin-bottom: 0;
                }
                .md-doc hr {
                    border: none;
                    border-top: 1px solid var(--line);
                    margin: 2em 0;
                }
                .md-doc img {
                    max-width: 100%;
                    border-radius: 8px;
                    border: 1px solid var(--line);
                }
                .md-doc code {
                    font-family: var(--font-mono);
                }
                .md-doc :not(pre) > code {
                    background: var(--panel-2);
                    border: 1px solid var(--line);
                    border-radius: 5px;
                    padding: 1px 6px;
                    font-size: 0.85em;
                    color: var(--ink);
                }
                .md-doc .katex-display {
                    overflow-x: auto;
                    overflow-y: hidden;
                    padding: 4px 0;
                }
                .md-doc section[data-footnotes] {
                    margin-top: 2.5em;
                    font-size: 13px;
                    color: var(--ink-3);
                }

                /* ── Tables ──────────────────────────────────────────── */
                .md-doc .md-table-wrap {
                    overflow-x: auto;
                    margin: 0 0 1em;
                    border: 1px solid var(--line);
                    border-radius: 10px;
                }
                .md-doc table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13.5px;
                }
                .md-doc th {
                    text-align: left;
                    font-weight: 600;
                    color: var(--ink);
                    background: var(--panel-2);
                    padding: 8px 14px;
                    border-bottom: 1px solid var(--line);
                }
                .md-doc td {
                    padding: 8px 14px;
                    border-bottom: 1px solid var(--line-2);
                    vertical-align: top;
                }
                .md-doc tbody tr:last-child td {
                    border-bottom: none;
                }
                .md-doc tbody tr:hover td {
                    background: var(--panel-2);
                }

                /* ── Code blocks ─────────────────────────────────────── */
                .md-doc .md-codeblock {
                    margin: 0 0 1em;
                    border-radius: 10px;
                    overflow: hidden;
                    border: 1px solid var(--code-line);
                    background: var(--code-bg);
                }
                .md-doc .md-codeblock-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 6px 12px;
                    background: var(--code-bg-2);
                    border-bottom: 1px solid var(--code-line);
                }
                .md-doc .md-codeblock-lang {
                    font-family: var(--font-mono);
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--code-accent);
                }
                .md-doc .md-codeblock-copy {
                    display: inline-flex;
                    align-items: center;
                    padding: 4px;
                    border-radius: 5px;
                    color: var(--code-ink-muted);
                }
                .md-doc .md-codeblock-copy:hover {
                    color: var(--code-accent);
                    background: var(--code-accent-soft);
                }
                .md-doc .md-codeblock pre {
                    margin: 0;
                    padding: 14px 16px;
                    overflow-x: auto;
                }
                .md-doc .md-codeblock code {
                    background: transparent;
                    font-size: 13px;
                    line-height: 1.6;
                    color: var(--code-ink);
                }

                /* ── Mermaid ─────────────────────────────────────────── */
                .md-doc .md-mermaid {
                    margin: 0 0 1em;
                    padding: 20px;
                    border: 1px solid var(--line);
                    border-radius: 10px;
                    background: var(--panel);
                    display: flex;
                    justify-content: center;
                }
                .md-doc .md-mermaid svg {
                    max-width: 100%;
                    height: auto;
                }
                .md-doc .md-mermaid-loading {
                    gap: 8px;
                    align-items: center;
                    color: var(--ink-3);
                    font-size: 13px;
                }

                /* ── Outline ─────────────────────────────────────────── */
                .md-toc {
                    width: 224px;
                    flex-shrink: 0;
                    overflow-y: auto;
                    border-left: 1px solid var(--line);
                    background: var(--panel);
                    padding: 18px 10px 24px;
                }
                .md-toc-title {
                    font-family: var(--font-mono);
                    font-size: 9.5px;
                    font-weight: 700;
                    letter-spacing: 0.1em;
                    text-transform: uppercase;
                    color: var(--ink-3);
                    padding: 0 10px 8px;
                }
                .md-toc-item {
                    display: block;
                    width: 100%;
                    text-align: left;
                    font-size: 12px;
                    line-height: 1.4;
                    padding: 5px 10px;
                    border-radius: 6px;
                    color: var(--ink-3);
                    border-left: 2px solid transparent;
                }
                .md-toc-item:hover {
                    color: var(--ink);
                    background: var(--panel-2);
                }
                .md-toc-item-active {
                    color: var(--accent-ink);
                    border-left-color: var(--accent);
                    background: var(--accent-soft);
                }
                @media (max-width: 860px) {
                    .md-toc {
                        display: none;
                    }
                    .md-doc {
                        padding: 28px 20px 72px;
                    }
                }
            `}</style>
        </div>
    );
}
