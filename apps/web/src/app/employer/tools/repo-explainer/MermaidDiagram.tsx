"use client";

import { useContextTarget } from "~/components/context-menu";
import { copyText } from "~/lib/context-menu";
import { resolveFontStack } from "~/lib/fonts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";

export interface MermaidDiagramProps {
    code: string;
    repoName?: string;
}

function useDarkMode(): boolean {
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        // next-themes stamps data-theme on <html>. Mermaid bakes colours into
        // the SVG it returns, so the diagram has to re-render when the theme
        // flips; the colours themselves come from the tokens (see tokenHex).
        const html = document.documentElement;
        const read = () => setIsDark(html.getAttribute("data-theme") === "dark");
        read();

        const observer = new MutationObserver(read);
        observer.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
        return () => observer.disconnect();
    }, []);

    return isDark;
}

/** A design token's current value, e.g. `oklch(0.54 0.24 285)`. */
function tokenValue(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

/**
 * Design tokens as hex, for mermaid's themeVariables: mermaid derives shades
 * from them with khroma, which parses neither `var()` nor `oklch()`. A 1x1
 * canvas does the conversion (and the gamut mapping) for us.
 */
function tokenHexes<K extends string>(names: Record<K, string>): Record<K, string> {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const out = {} as Record<K, string>;
    for (const key of Object.keys(names) as K[]) {
        const value = tokenValue(names[key]);
        let hex = value;
        if (ctx) {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = "transparent";
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
            hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`;
        }
        out[key] = hex;
    }
    return out;
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

export function MermaidDiagram({ code, repoName }: MermaidDiagramProps) {
    const t = useTranslations("tools.repoExplainer.diagram");
    const tRef = useRef(t);
    tRef.current = t;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const isDark = useDarkMode();

    const filePrefix = repoName ? sanitizeFilename(repoName) + "-diagram" : "diagram";
    const ctxTarget = useContextTarget({
        kind: "diagram",
        label: t("menuLabel"),
        items: () => [
            {
                type: "item",
                id: "copy-source",
                label: t("copySource"),
                icon: "code",
                onSelect: () => {
                    void copyText(code);
                },
            },
            {
                type: "item",
                id: "copy-svg",
                label: t("copySvg"),
                icon: "image",
                disabled: !containerRef.current?.querySelector("svg"),
                disabledReason: t("notRendered"),
                onSelect: () => {
                    const svg = containerRef.current?.querySelector("svg");
                    if (svg) void copyText(svg.outerHTML);
                },
            },
        ],
    });

    useEffect(() => {
        if (!code.trim()) {
            setLoading(false);
            return;
        }

        setError(null);
        setLoading(true);
        let cancelled = false;
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;

        async function renderDiagram() {
            try {
                const mermaid = (await import("mermaid")).default;
                mermaid.initialize({
                    startOnLoad: false,
                    // "base" is the one mermaid theme that derives every
                    // colour from these variables ("dark" and "neutral" hard-
                    // code their node fills), so the same token names give
                    // the right diagram in either app theme.
                    theme: "base",
                    securityLevel: "strict",
                    themeVariables: {
                        darkMode: isDark,
                        ...tokenHexes({
                            background: "panel",
                            primaryColor: "accent-soft",
                            primaryTextColor: "ink",
                            primaryBorderColor: "accent",
                            lineColor: "accent-2",
                            secondaryColor: "panel-2",
                            tertiaryColor: "panel-2",
                            tertiaryBorderColor: "line",
                            edgeLabelBackground: "panel",
                            noteBkgColor: "warn-soft",
                            noteTextColor: "ink",
                            noteBorderColor: "warn",
                        }),
                        fontFamily: resolveFontStack("sans"),
                    },
                });

                const normalized = code
                    .trim()
                    .replace(/^\n+/, "")
                    .replace(/\\n/g, "\n")
                    .replace(/\\"/g, '"');
                const result = await mermaid.render(id, normalized);

                if (cancelled) return;

                if (result?.svg && containerRef.current) {
                    containerRef.current.innerHTML = result.svg;
                    // Center the SVG and add some breathing room
                    const svgEl = containerRef.current.querySelector("svg");
                    if (svgEl) {
                        svgEl.style.maxWidth = "100%";
                        svgEl.style.height = "auto";
                        svgEl.style.display = "block";
                        svgEl.style.margin = "0 auto";
                    }
                } else {
                    throw new Error(tRef.current("emptyResult"));
                }
            } catch (err) {
                if (cancelled) return;
                console.error("[repo-explainer] Mermaid render error:", err);
                setError(err instanceof Error ? err.message : tRef.current("renderFailed"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void renderDiagram();

        return () => {
            cancelled = true;
        };
    }, [code, isDark]);

    const handleDownloadSvg = useCallback(() => {
        if (!containerRef.current) return;
        const svgData = containerRef.current.innerHTML;
        if (!svgData) return;

        const blob = new Blob([svgData], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filePrefix}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [filePrefix]);

    const handleDownloadPng = useCallback(() => {
        const svgEl = containerRef.current?.querySelector("svg");
        if (!svgEl) return;

        const svgData = new XMLSerializer().serializeToString(svgEl);
        const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl = URL.createObjectURL(svgBlob);

        const img = new window.Image();
        img.onload = () => {
            const scale = 2; // 2x for high-DPI
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth * scale;
            canvas.height = img.naturalHeight * scale;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // The PNG has no page behind it: paint the panel the diagram sat on.
            ctx.fillStyle = tokenValue("panel");
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0);

            canvas.toBlob(blob => {
                if (!blob) return;
                const pngUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = pngUrl;
                a.download = `${filePrefix}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(pngUrl);
            }, "image/png");

            URL.revokeObjectURL(svgUrl);
        };
        img.src = svgUrl;
    }, [filePrefix]);

    if (error) {
        return (
            <div className="border-danger/40 bg-danger-soft text-danger-ink rounded-xl border p-4 text-xs">
                <p className="font-semibold">{t("renderError")}</p>
                <p className="mt-1">{error}</p>
                <details className="mt-2">
                    <summary className="text-ink-2 cursor-pointer">{t("rawCode")}</summary>
                    <pre className="bg-panel text-ink-2 mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg p-3 text-xs">
                        {code}
                    </pre>
                </details>
            </div>
        );
    }

    return (
        <div className="border-line bg-panel shadow-1 overflow-hidden rounded-xl border">
            {/* Download toolbar */}
            {!loading && (
                <div className="border-line bg-panel-2/30 flex items-center justify-end gap-1.5 border-b px-4 py-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadSvg}
                        className="h-7 text-xs"
                        title={t("downloadSvg")}
                        aria-label={t("downloadSvg")}
                    >
                        <Download className="size-3.5" />
                        SVG
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadPng}
                        className="h-7 text-xs"
                        title={t("downloadPng")}
                        aria-label={t("downloadPng")}
                    >
                        <ImageIcon className="size-3.5" />
                        PNG
                    </Button>
                </div>
            )}

            {/* Diagram container */}
            <div className="overflow-x-auto p-6">
                {loading && (
                    <p className="text-ink-3 py-12 text-center text-sm">{t("rendering")}</p>
                )}
                <div {...ctxTarget} ref={containerRef} />
            </div>
        </div>
    );
}
