"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import type { Element, ElementContent, Root } from "hast";
import { Check, Copy, WrapText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { copyText } from "~/lib/context-menu";
import { ChatMediaGallery, type ChatMediaItem } from "./ChatMediaGallery";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark-dimmed.min.css";

/** Model output never gets a script, local-file, blob or data URL capability. */
export function safeChatUri(value: string | undefined, media = false): string | undefined {
    if (!value) return undefined;
    const uri = value.trim();
    if (media && uri.startsWith("#")) return undefined;
    if (!uri || /[\u0000-\u0020\u007f]/.test(uri) || uri.startsWith("//") || uri.includes("\\"))
        return undefined;
    if (/^https?:\/\//i.test(uri)) {
        try {
            const parsed = new URL(uri);
            return parsed.username || parsed.password ? undefined : uri;
        } catch {
            return undefined;
        }
    }
    if (!media && (/^mailto:[^<>]+$/i.test(uri) || uri.startsWith("#"))) return uri;
    if (uri.startsWith("/") && !uri.startsWith("//")) return uri;
    // Relative paths remain on this origin. A colon in the first segment is a scheme.
    if (!/^[^/]*:/.test(uri) && !uri.startsWith("?")) return uri;
    return undefined;
}

const SAFE_TAGS = new Set([
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "del",
    "s",
    "a",
    "blockquote",
    "ul",
    "ol",
    "li",
    "input",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "pre",
    "code",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
    "video",
    "audio",
    "source",
    "details",
    "summary",
    "sup",
    "sub",
    "div",
    "span",
    "kbd",
]);
const DROP_CONTENT = new Set([
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "form",
    "button",
    "textarea",
    "select",
    "svg",
    "math",
]);

/** A narrow HTML allowlist, before KaTeX introduces its own trusted markup. */
function safeHtml() {
    return (tree: Root) => {
        const walk = (parent: Root | Element) => {
            parent.children = parent.children.flatMap(child => {
                if (child.type !== "element") return child.type === "text" ? [child] : [];
                if (DROP_CONTENT.has(child.tagName)) return [];
                walk(child);
                if (!SAFE_TAGS.has(child.tagName)) return child.children;
                const props: Element["properties"] = {};
                for (const name of [
                    "alt",
                    "title",
                    "start",
                    "colSpan",
                    "rowSpan",
                    "align",
                    "open",
                ]) {
                    if (child.properties[name] !== undefined) props[name] = child.properties[name];
                }
                if (child.tagName === "code")
                    props.className = (
                        Array.isArray(child.properties.className) ? child.properties.className : []
                    ).filter(c => typeof c === "string" && /^language-[\w.+:-]+$/.test(c));
                if (child.tagName === "a")
                    props.href = safeChatUri(String(child.properties.href ?? ""));
                if (["img", "video", "audio", "source"].includes(child.tagName))
                    props.src = safeChatUri(String(child.properties.src ?? ""), true);
                if (child.tagName === "input") {
                    props.type = "checkbox";
                    props.checked = Boolean(child.properties.checked);
                    props.disabled = true;
                }
                child.properties = props;
                return [child];
            });
        };
        walk(tree);
    };
}

function nodeText(node: ElementContent): string {
    return node.type === "text"
        ? node.value
        : node.type === "element"
          ? node.children.map(nodeText).join("")
          : "";
}

export function markdownTableText(table: Element, format: "markdown" | "csv"): string {
    const rows: string[][] = [];
    const read = (node: Element) => {
        if (node.tagName === "tr")
            rows.push(
                node.children
                    .filter(
                        (n): n is Element =>
                            n.type === "element" && ["th", "td"].includes(n.tagName)
                    )
                    .map(nodeText)
            );
        else node.children.filter((n): n is Element => n.type === "element").forEach(read);
    };
    read(table);
    if (format === "csv")
        return rows
            .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(","))
            .join("\n");
    const escaped = rows.map(row =>
        row.map(cell => cell.replace(/\|/g, "\\|").replace(/\n/g, "<br>"))
    );
    return escaped
        .flatMap((row, i) => [
            `| ${row.join(" | ")} |`,
            ...(i === 0 ? [`| ${row.map(() => "---").join(" | ")} |`] : []),
        ])
        .join("\n");
}

async function copy(value: string, message: string) {
    if (await copyText(value)) toast.success(message);
    else toast.error("Clipboard unavailable. Select the text to copy it.");
}

function MermaidBlock({ code }: { code: string }) {
    const [svg, setSvg] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const id = useRef(`chat-mermaid-${Math.random().toString(36).slice(2)}`);
    useEffect(() => {
        let cancelled = false;
        setSvg(null);
        setFailed(false);
        void import("mermaid")
            .then(async ({ default: mermaid }) => {
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "strict",
                    theme:
                        document.documentElement.getAttribute("data-theme") === "dark"
                            ? "dark"
                            : "neutral",
                });
                // Keep the original source byte-for-byte; escaped labels must not change meaning.
                const result = await mermaid.render(id.current, code);
                if (!cancelled) setSvg(result.svg);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [code]);
    return (
        <div className="my-3 rounded-lg border border-[var(--line)] p-3">
            {svg && (
                <div
                    className="overflow-x-auto [&_svg]:max-w-full"
                    dangerouslySetInnerHTML={{ __html: svg }}
                />
            )}
            {!svg && (
                <p role="status" className="text-xs text-[var(--ink-3)]">
                    {failed
                        ? "Diagram unavailable. The original source is below."
                        : "Rendering diagram…"}
                </p>
            )}
            <details open={failed}>
                <summary className="cursor-pointer py-2 text-xs">Mermaid source</summary>
                <CodeBlock code={code} language="mermaid" diagram={false} />
            </details>
        </div>
    );
}

function CodeBlock({
    code,
    language,
    diagram = true,
}: {
    code: string;
    language: string;
    diagram?: boolean;
}) {
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const [wrap, setWrap] = useState(false);
    const [copied, setCopied] = useState(false);
    const lang = language.split(":")[0] ?? "text";
    useEffect(() => {
        setCopied(false);
    }, [code]);
    useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(timer);
    }, [copied]);
    useEffect(() => {
        try {
            setWrap(localStorage.getItem("launchstack.chat.wrapCode") === "true");
        } catch {
            /* storage is optional */
        }
    }, []);
    useEffect(() => {
        let cancelled = false;
        setHighlighted(null);
        void import("highlight.js/lib/common")
            .then(({ default: hljs }) => {
                if (hljs.getLanguage(lang)) {
                    const result = hljs.highlight(code, { language: lang });
                    if (!cancelled) setHighlighted(result.value);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [code, lang]);
    if (lang === "mermaid" && diagram) return <MermaidBlock code={code} />;
    return (
        <div className="my-3 min-w-0 overflow-hidden rounded-lg border border-[var(--line)]">
            <div className="flex flex-wrap items-center gap-2 bg-[var(--panel-2)] px-3 py-2 text-xs">
                <span className="mr-auto font-mono">{language || "text"}</span>
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label="Wrap code lines"
                    aria-pressed={wrap}
                    title="Wrap code lines"
                    className="rounded p-1 focus-visible:outline"
                    onClick={() => {
                        const next = !wrap;
                        setWrap(next);
                        try {
                            localStorage.setItem("launchstack.chat.wrapCode", String(next));
                        } catch {
                            /* storage is optional */
                        }
                    }}
                >
                    <WrapText size={14} />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label={copied ? "Code copied" : "Copy code"}
                    className="flex items-center gap-1 rounded p-1 focus-visible:outline"
                    onClick={() =>
                        void copyText(code).then(ok => {
                            setCopied(ok);
                            if (!ok) toast.error("Couldn't copy code");
                        })
                    }
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
            <pre
                className="overflow-x-auto bg-[var(--code-bg)] p-3 text-xs leading-relaxed text-[var(--code-ink)]"
                style={{
                    whiteSpace: wrap ? "pre-wrap" : "pre",
                    overflowWrap: wrap ? "anywhere" : undefined,
                }}
            >
                {highlighted ? (
                    <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
                ) : (
                    <code className="hljs">{code}</code>
                )}
            </pre>
        </div>
    );
}

function ChatTableCell({ node, children }: { node?: Element; children: React.ReactNode }) {
    const text = node ? nodeText(node) : "";
    if (text.length <= 80) return <td>{children}</td>;
    return (
        <td>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="View full table cell"
                        title={text}
                        className="h-auto max-w-[240px] justify-start truncate p-0 text-left font-normal"
                    >
                        <span className="truncate">{text}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-auto break-words"
                    aria-label="Full table cell"
                >
                    <div className="text-sm">{children}</div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void copy(text, "Cell copied")}
                    >
                        Copy cell
                    </Button>
                </PopoverContent>
            </Popover>
        </td>
    );
}

function ChatTable({ node, children }: { node: Element; children: React.ReactNode }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="my-3 min-w-0 rounded-lg border border-[var(--line)]">
            <div className="flex flex-wrap gap-3 px-3 py-2 text-xs">
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() =>
                        void copy(markdownTableText(node, "markdown"), "Table Markdown copied")
                    }
                >
                    Copy as Markdown
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => void copy(markdownTableText(node, "csv"), "Table CSV copied")}
                >
                    Copy as CSV
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-pressed={expanded}
                    onClick={() => setExpanded(v => !v)}
                >
                    {expanded ? "Compact cells" : "Expand cells"}
                </Button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" data-expanded={expanded}>
                    {children}
                </table>
            </div>
        </div>
    );
}

function removeAlertMarker(children: React.ReactNode): React.ReactNode {
    return React.Children.map(children, child => {
        if (typeof child === "string")
            return child.replace(/^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, "");
        if (React.isValidElement<{ children?: React.ReactNode }>(child))
            return React.cloneElement(child, { children: removeAlertMarker(child.props.children) });
        return child;
    });
}

export function ChatMarkdown({ text }: { text: string }) {
    const root = useRef<HTMLDivElement>(null);
    const [gallery, setGallery] = useState<{ items: ChatMediaItem[]; index: number } | null>(null);
    const plugins = useMemo<
        NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>
    >(() => [rehypeRaw, safeHtml, [rehypeKatex, { trust: false, strict: "ignore" }]], []);
    return (
        <div
            ref={root}
            className="chat-markdown min-w-0 break-words text-sm leading-[1.65] [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--accent)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--ink-3)] [&_h1]:my-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-semibold [&_img]:max-h-96 [&_img]:max-w-full [&_img]:rounded-lg [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table[data-expanded=false]_td]:max-w-[240px] [&_table[data-expanded=false]_td]:overflow-hidden [&_table[data-expanded=false]_td]:text-ellipsis [&_table[data-expanded=false]_td]:whitespace-nowrap [&_td]:border [&_td]:border-[var(--line)] [&_td]:p-2 [&_th]:border [&_th]:border-[var(--line)] [&_th]:bg-[var(--panel-2)] [&_th]:p-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={plugins}
                urlTransform={(url, key) => safeChatUri(url, key === "src") ?? ""}
                components={{
                    pre: ({ node }) => {
                        const code = node?.children.find(
                            (child): child is Element =>
                                child.type === "element" && child.tagName === "code"
                        );
                        if (!code) return null;
                        const classes = Array.isArray(code.properties.className)
                            ? code.properties.className
                            : [];
                        const language = String(
                            classes.find(c => typeof c === "string" && c.startsWith("language-")) ??
                                ""
                        ).replace(/^language-/, "");
                        return (
                            <CodeBlock
                                code={code.children.map(nodeText).join("").replace(/\n$/, "")}
                                language={language}
                            />
                        );
                    },
                    code: ({ children, node: _node, ...props }) => (
                        <code
                            {...props}
                            className="rounded bg-[var(--line-2)] px-1 py-0.5 text-[0.9em]"
                        >
                            {children}
                        </code>
                    ),
                    td: ({ node, children }) => (
                        <ChatTableCell node={node}>{children}</ChatTableCell>
                    ),
                    table: ({ node, children }) =>
                        node ? <ChatTable node={node}>{children}</ChatTable> : null,
                    blockquote: ({ node, children }) => {
                        const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(
                            node ? node.children.map(nodeText).join("").trimStart() : ""
                        );
                        return alert ? (
                            <aside
                                role="note"
                                aria-label={alert[1]?.toLowerCase()}
                                className="my-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1"
                            >
                                <p className="font-semibold capitalize">
                                    {alert[1]?.toLowerCase()}
                                </p>
                                {removeAlertMarker(children)}
                            </aside>
                        ) : (
                            <blockquote>{children}</blockquote>
                        );
                    },
                    a: ({ href, children, node: _node, ...props }) => {
                        const safe = safeChatUri(href);
                        return safe ? (
                            <a
                                {...props}
                                href={safe}
                                target={/^https?:/i.test(safe) ? "_blank" : undefined}
                                rel="noopener noreferrer"
                                className="text-[var(--accent)] underline underline-offset-2"
                            >
                                {children}
                            </a>
                        ) : (
                            <span>{children}</span>
                        );
                    },
                    // Uploaded/external image hosts are deliberately not proxied through Next Image.
                    img: ({ src, alt, node: _node }) =>
                        safeChatUri(typeof src === "string" ? src : undefined, true) ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                className="block max-w-full rounded text-left"
                                aria-label={`Preview image: ${alt?.trim() ? alt : "Chat image"}`}
                                onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const images = Array.from(
                                        root.current?.querySelectorAll<HTMLImageElement>("img") ??
                                            []
                                    );
                                    const clicked = e.currentTarget.querySelector("img");
                                    setGallery({
                                        items: images.map(img => ({
                                            src: img.getAttribute("src") ?? "",
                                            name: img.alt,
                                        })),
                                        index: Math.max(
                                            0,
                                            images.findIndex(img => img === clicked)
                                        ),
                                    });
                                }}
                            >
                                {/* Original uploaded/external URLs are not routed through the Next Image proxy. */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={safeChatUri(
                                        typeof src === "string" ? src : undefined,
                                        true
                                    )}
                                    alt={alt ?? "Chat image"}
                                    loading="lazy"
                                />
                            </Button>
                        ) : (
                            <span>{alt ?? "Image unavailable"}</span>
                        ),
                    video: ({ src, children }) => (
                        <video
                            src={safeChatUri(typeof src === "string" ? src : undefined, true)}
                            controls
                            preload="metadata"
                            className="max-w-full rounded-lg"
                        >
                            {children}
                        </video>
                    ),
                    audio: ({ src, children }) => (
                        <audio
                            src={safeChatUri(typeof src === "string" ? src : undefined, true)}
                            controls
                            preload="metadata"
                            className="max-w-full"
                        >
                            {children}
                        </audio>
                    ),
                    source: ({ src }) => (
                        <source
                            src={safeChatUri(typeof src === "string" ? src : undefined, true)}
                        />
                    ),
                }}
            >
                {text}
            </ReactMarkdown>
            {gallery && (
                <ChatMediaGallery
                    items={gallery.items}
                    initialIndex={gallery.index}
                    onClose={() => setGallery(null)}
                />
            )}
        </div>
    );
}
