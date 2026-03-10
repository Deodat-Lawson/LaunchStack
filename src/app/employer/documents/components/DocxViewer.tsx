"use client";

import React, { useEffect, useState, useRef } from "react";
import { Loader2, AlertTriangle, RotateCw } from "lucide-react";

interface DocxViewerProps {
  url: string;
  title: string;
}

/**
 * Client-side DOCX viewer that converts .docx files to HTML using mammoth.js.
 * Fetches the binary, converts to HTML, and renders in a sandboxed container.
 */
export function DocxViewer({ url, title: _title }: DocxViewerProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadDocument = async () => {
    setLoading(true);
    setError(null);
    setHtml("");

    try {
      // Fetch the raw binary
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch document (${response.status})`);

      const arrayBuffer = await response.arrayBuffer();

      // Dynamically import mammoth for client-side use
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer });

      if (result.messages.length > 0) {
        console.warn("[DocxViewer] Mammoth warnings:", result.messages);
      }

      setHtml(result.value);
    } catch (err) {
      console.error("[DocxViewer] Error converting DOCX:", err);
      setError(err instanceof Error ? err.message : "Failed to render document");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDocument();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-muted/30">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Converting document...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center bg-muted/30">
        <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-1">Failed to render document</p>
          <p className="text-xs text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => void loadDocument()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
          >
            <RotateCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto bg-white dark:bg-zinc-900 p-8 docx-viewer-content"
    >
      {/* Scoped styles for the converted HTML */}
      <style>{`
        .docx-viewer-content {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #1a1a1a;
        }
        .dark .docx-viewer-content {
          color: #e5e5e5;
        }
        .docx-viewer-content h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
        .docx-viewer-content h2 { font-size: 1.5rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
        .docx-viewer-content h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
        .docx-viewer-content h4, .docx-viewer-content h5, .docx-viewer-content h6 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
        .docx-viewer-content p { margin: 0.5rem 0; }
        .docx-viewer-content table {
          border-collapse: collapse;
          width: 100%;
          margin: 1rem 0;
        }
        .docx-viewer-content th, .docx-viewer-content td {
          border: 1px solid #d1d5db;
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .dark .docx-viewer-content th, .dark .docx-viewer-content td {
          border-color: #374151;
        }
        .docx-viewer-content th {
          background: #f3f4f6;
          font-weight: 600;
        }
        .dark .docx-viewer-content th {
          background: #1f2937;
        }
        .docx-viewer-content ul, .docx-viewer-content ol { margin: 0.5rem 0; padding-left: 1.5rem; }
        .docx-viewer-content li { margin: 0.25rem 0; }
        .docx-viewer-content img { max-width: 100%; height: auto; margin: 1rem 0; border-radius: 0.5rem; }
        .docx-viewer-content a { color: #7c3aed; text-decoration: underline; }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
