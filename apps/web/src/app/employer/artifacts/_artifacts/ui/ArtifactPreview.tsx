"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import MarkdownMessage from "~/app/_components/MarkdownMessage";

/**
 * Renders an imported artifact.
 *
 * HTML and SVG go through a sandboxed `srcDoc` iframe. The sandbox
 * deliberately omits `allow-same-origin`: the artifact is untrusted code, and
 * an opaque origin means its scripts can run freely without ever reaching this
 * app's cookies, storage, or DOM. This is the app's first untrusted-HTML
 * surface — keep the sandbox list tight if you extend it.
 */
export function ArtifactPreview({ type, content }: { type: string; content: string }) {
    switch (type) {
        case "html":
            return <SandboxFrame content={content} allowScripts />;
        case "svg":
            return <SandboxFrame content={content} />;
        case "markdown":
            return (
                <div className="h-full overflow-auto px-6 py-5">
                    <MarkdownMessage content={content} className="text-ink text-[14px]" />
                </div>
            );
        case "mermaid":
            return <MermaidPreview code={content} />;
        default:
            return <SourceView content={content} />;
    }
}

/** Plain source text — the fallback view and the "Source" tab. */
export function SourceView({ content }: { content: string }) {
    return (
        <pre className="text-ink-2 h-full overflow-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed">
            {content}
        </pre>
    );
}

function SandboxFrame({
    content,
    allowScripts = false,
}: {
    content: string;
    allowScripts?: boolean;
}) {
    const [loading, setLoading] = useState(true);
    return (
        <div className="relative h-full w-full">
            {loading && (
                <div className="text-ink-3 absolute inset-0 flex items-center justify-center gap-2 text-[13px]">
                    <Loader2 className="size-4 animate-spin" />
                    Rendering…
                </div>
            )}
            <iframe
                srcDoc={content}
                title="Artifact preview"
                // No allow-same-origin: scripts run in an opaque origin, cut
                // off from this app's session. Do not add it.
                sandbox={
                    allowScripts
                        ? "allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                        : ""
                }
                className="h-full w-full border-0"
                onLoad={() => setLoading(false)}
            />
        </div>
    );
}

function useDarkMode(): boolean {
    const [isDark, setIsDark] = useState(false);
    useEffect(() => {
        // next-themes stamps data-theme on <html>; mermaid needs the theme
        // name in JS rather than CSS tokens because it renders to SVG text.
        const html = document.documentElement;
        const read = () => setIsDark(html.getAttribute("data-theme") === "dark");
        read();
        const observer = new MutationObserver(read);
        observer.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
        return () => observer.disconnect();
    }, []);
    return isDark;
}

function MermaidPreview({ code }: { code: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const isDark = useDarkMode();

    useEffect(() => {
        if (!code.trim()) {
            setLoading(false);
            return;
        }
        setError(null);
        setLoading(true);
        let cancelled = false;
        const id = `artifact-mermaid-${Math.random().toString(36).slice(2)}`;

        async function renderDiagram() {
            try {
                const mermaid = (await import("mermaid")).default;
                mermaid.initialize({
                    startOnLoad: false,
                    theme: isDark ? "dark" : "neutral",
                    securityLevel: "strict",
                });
                const { svg } = await mermaid.render(id, code);
                if (!cancelled && containerRef.current) {
                    containerRef.current.innerHTML = svg;
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Couldn't render the diagram");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void renderDiagram();
        return () => {
            cancelled = true;
        };
    }, [code, isDark]);

    if (error) {
        return (
            <div className="flex h-full flex-col gap-3 overflow-auto px-6 py-5">
                <p className="text-danger text-[13px]">{error}</p>
                <SourceView content={code} />
            </div>
        );
    }
    return (
        <div className="relative h-full overflow-auto p-6">
            {loading && (
                <div className="text-ink-3 absolute inset-0 flex items-center justify-center gap-2 text-[13px]">
                    <Loader2 className="size-4 animate-spin" />
                    Rendering…
                </div>
            )}
            <div ref={containerRef} className="flex min-h-full items-center justify-center" />
        </div>
    );
}
