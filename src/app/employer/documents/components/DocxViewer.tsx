"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCw, Download } from "lucide-react";

interface DocxViewerProps {
  url: string;
  title: string;
}

/**
 * Client-side DOCX viewer that converts Word documents to HTML using mammoth.
 * Fetches the DOCX as an ArrayBuffer, converts it in the browser, and renders
 * styled HTML — same pattern as XlsxViewer with SheetJS.
 */
export function DocxViewer({ url, title }: DocxViewerProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDocument = async () => {
    setLoading(true);
    setError(null);
    setHtml("");

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch document (${response.status})`);

      const arrayBuffer = await response.arrayBuffer();

      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer });

      if (!result.value || result.value.trim().length === 0) {
        throw new Error("Document appears to be empty");
      }

      setHtml(result.value);
    } catch (err) {
      console.error("[DocxViewer] Error converting document:", err);
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
        <p className="text-sm text-muted-foreground font-medium">Loading document...</p>
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
          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadDocument()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
            >
              <RotateCw className="w-4 h-4" />
              Retry
            </button>
            <a
              href={url}
              download
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex-shrink-0 border-b border-border bg-muted/30 px-4 py-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">Word Document Preview</span>
        <a
          href={url}
          download
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      </div>

      <div className="flex-1 overflow-auto p-8 docx-viewer-content">
        <style>{`
          .docx-viewer-content {
            max-width: 800px;
            margin: 0 auto;
            font-size: 0.9375rem;
            line-height: 1.7;
            color: #1f2937;
          }
          .dark .docx-viewer-content {
            color: #e5e7eb;
          }
          .docx-viewer-content h1 {
            font-size: 1.75rem;
            font-weight: 700;
            margin: 1.5rem 0 0.75rem;
            line-height: 1.3;
          }
          .docx-viewer-content h2 {
            font-size: 1.375rem;
            font-weight: 600;
            margin: 1.25rem 0 0.625rem;
            line-height: 1.35;
          }
          .docx-viewer-content h3 {
            font-size: 1.125rem;
            font-weight: 600;
            margin: 1rem 0 0.5rem;
            line-height: 1.4;
          }
          .docx-viewer-content p {
            margin: 0 0 0.75rem;
          }
          .docx-viewer-content ul,
          .docx-viewer-content ol {
            margin: 0 0 0.75rem;
            padding-left: 1.5rem;
          }
          .docx-viewer-content li {
            margin-bottom: 0.25rem;
          }
          .docx-viewer-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 1rem 0;
            font-size: 0.8125rem;
          }
          .docx-viewer-content th,
          .docx-viewer-content td {
            border: 1px solid #e5e7eb;
            padding: 0.5rem 0.75rem;
            text-align: left;
          }
          .dark .docx-viewer-content th,
          .dark .docx-viewer-content td {
            border-color: #374151;
          }
          .docx-viewer-content th {
            background: #f3f4f6;
            font-weight: 600;
          }
          .dark .docx-viewer-content th {
            background: #1f2937;
          }
          .docx-viewer-content img {
            max-width: 100%;
            height: auto;
            border-radius: 0.375rem;
            margin: 0.75rem 0;
          }
          .docx-viewer-content a {
            color: #7c3aed;
            text-decoration: underline;
          }
          .dark .docx-viewer-content a {
            color: #a78bfa;
          }
          .docx-viewer-content blockquote {
            border-left: 3px solid #d1d5db;
            padding-left: 1rem;
            margin: 0.75rem 0;
            color: #6b7280;
          }
          .dark .docx-viewer-content blockquote {
            border-color: #4b5563;
            color: #9ca3af;
          }
        `}</style>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
