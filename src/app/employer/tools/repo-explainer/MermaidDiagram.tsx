"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon } from "lucide-react";

export interface MermaidDiagramProps {
  code: string;
  repoName?: string;
}

function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    setIsDark(html.classList.contains("dark"));

    const observer = new MutationObserver(() => {
      setIsDark(html.classList.contains("dark"));
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

export function MermaidDiagram({ code, repoName }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isDark = useDarkMode();

  const filePrefix = repoName
    ? sanitizeFilename(repoName) + "-diagram"
    : "diagram";

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
          theme: isDark ? "dark" : "neutral",
          securityLevel: "strict",
          themeVariables: isDark
            ? {
                primaryColor: "#7c3aed",
                primaryTextColor: "#f5f3ff",
                primaryBorderColor: "#6d28d9",
                lineColor: "#8b5cf6",
                secondaryColor: "#4c1d95",
                tertiaryColor: "#1e1b4b",
                fontFamily: "Inter, system-ui, sans-serif",
              }
            : {
                primaryColor: "#ede9fe",
                primaryTextColor: "#1e1b4b",
                primaryBorderColor: "#7c3aed",
                lineColor: "#6d28d9",
                secondaryColor: "#f5f3ff",
                tertiaryColor: "#faf5ff",
                fontFamily: "Inter, system-ui, sans-serif",
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
          throw new Error("Mermaid returned empty result");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[repo-explainer] Mermaid render error:", err);
        setError(err instanceof Error ? err.message : "Failed to render diagram");
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

      // White background for PNG
      ctx.fillStyle = isDark ? "#0f172a" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
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
  }, [filePrefix, isDark]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
        <p className="font-semibold">Diagram render error</p>
        <p className="mt-1">{error}</p>
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-600 dark:text-slate-400">
            Raw Mermaid code
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-[10px] dark:bg-slate-900">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-gradient-to-b from-background to-muted/20 shadow-sm overflow-hidden">
      {/* Download toolbar */}
      {!loading && (
        <div className="flex items-center justify-end gap-1.5 px-4 py-2 border-b border-border bg-muted/30">
          <button
            onClick={handleDownloadSvg}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
            title="Download as SVG"
          >
            <Download className="h-3 w-3" />
            SVG
          </button>
          <button
            onClick={handleDownloadPng}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
            title="Download as PNG"
          >
            <ImageIcon className="h-3 w-3" />
            PNG
          </button>
        </div>
      )}

      {/* Diagram container */}
      <div className="p-6 overflow-x-auto">
        {loading && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Rendering diagram...
          </p>
        )}
        <div ref={containerRef} />
      </div>
    </div>
  );
}
