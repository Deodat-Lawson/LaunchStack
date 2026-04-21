"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SourceReference } from "~/app/api/agents/documentQ&A/services";

interface PdfModule {
  Document: React.ComponentType<{
    file: string;
    loading?: React.ReactNode;
    error?: React.ReactNode;
    children?: React.ReactNode;
  }>;
  Page: React.ComponentType<{
    pageNumber: number;
    renderAnnotationLayer?: boolean;
    renderTextLayer?: boolean;
    customTextRenderer?: (props: { str: string }) => string;
    width?: number;
  }>;
  pdfjs: { GlobalWorkerOptions: { workerSrc: string }; version: string };
}

interface PdfPageViewerProps {
  url: string;
  pageNumber: number;
  reference?: SourceReference | null;
}

function getHighlightTerms(reference?: SourceReference | null): string[] {
  if (!reference) return [];
  const candidates = [reference.matchText, reference.snippet]
    .filter((item): item is string => Boolean(item))
    .map((item) => item.replace(/\.\.\./g, " ").trim())
    .filter((item) => item.length > 2);
  return candidates.slice(0, 2);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function PdfPageViewer({ url, pageNumber, reference }: PdfPageViewerProps) {
  const terms = useMemo(() => getHighlightTerms(reference), [reference]);
  const [pdfModule, setPdfModule] = useState<PdfModule | null>(null);

  useEffect(() => {
    let mounted = true;

    import("react-pdf")
      .then((mod) => {
        const pdf = mod as PdfModule;
        // Use the worker that matches the loaded pdfjs API version to avoid
        // "API version does not match Worker version" runtime errors.
        pdf.pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdf.pdfjs.version}/build/pdf.worker.min.mjs`;
        if (mounted) setPdfModule(pdf);
      })
      .catch(() => {
        if (mounted) setPdfModule(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const customTextRenderer = React.useCallback(
    ({ str }: { str: string }) => {
      if (terms.length === 0 || str.trim().length === 0) {
        return escapeHtml(str);
      }

      for (const term of terms) {
        const regex = new RegExp(`(${escapeRegex(term)})`, "i");
        if (regex.test(str)) {
          const parts = str.split(new RegExp(`(${escapeRegex(term)})`, "gi"));
          return parts
            .map((part) =>
              new RegExp(`^${escapeRegex(term)}$`, "i").test(part)
                ? `<mark class="bg-yellow-300/80 text-inherit rounded px-0.5">${escapeHtml(part)}</mark>`
                : escapeHtml(part)
            )
            .join("");
        }
      }

      return escapeHtml(str);
    },
    [terms]
  );

  if (!pdfModule) {
    return (
      <div className="w-full h-full overflow-auto p-4">
        <div className="text-sm text-muted-foreground">Loading PDF viewer...</div>
      </div>
    );
  }

  const { Document, Page } = pdfModule;

  return (
    <div className="w-full h-full overflow-auto p-4">
      <Document
        file={url}
        loading={<div className="text-sm text-muted-foreground">Loading PDF...</div>}
        error={<div className="text-sm text-red-600">Failed to load PDF document.</div>}
      >
        <Page
          pageNumber={pageNumber}
          renderAnnotationLayer={false}
          renderTextLayer
          customTextRenderer={customTextRenderer}
          width={900}
        />
      </Document>
    </div>
  );
}
