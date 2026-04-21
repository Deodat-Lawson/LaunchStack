"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "~/lib/utils";

interface SheetData {
  name: string;
  html: string;
}

interface XlsxViewerProps {
  url: string;
  title: string;
}

/**
 * Client-side XLSX/XLS viewer that converts spreadsheets to HTML tables using SheetJS.
 * Shows a tabbed interface for multi-sheet workbooks.
 */
export function XlsxViewer({ url, title: _title }: XlsxViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSpreadsheet = async () => {
    setLoading(true);
    setError(null);
    setSheets([]);
    setActiveSheet(0);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch spreadsheet (${response.status})`);

      const arrayBuffer = await response.arrayBuffer();

      // Dynamically import SheetJS for client-side use
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(arrayBuffer, { type: "array" });

      const parsed: SheetData[] = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        if (!sheet) return { name, html: "<p>Empty sheet</p>" };

        const html = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${name}`, editable: false });
        return { name, html };
      });

      if (parsed.length === 0) {
        throw new Error("No sheets found in the workbook");
      }

      setSheets(parsed);
    } catch (err) {
      console.error("[XlsxViewer] Error converting spreadsheet:", err);
      setError(err instanceof Error ? err.message : "Failed to render spreadsheet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSpreadsheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 bg-muted/30">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Loading spreadsheet...</p>
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
          <p className="text-sm font-medium text-foreground mb-1">Failed to render spreadsheet</p>
          <p className="text-xs text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => void loadSpreadsheet()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
          >
            <RotateCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const currentSheet = sheets[activeSheet];

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Sheet Tabs */}
      {sheets.length > 1 && (
        <div className="flex-shrink-0 border-b border-border bg-muted/30 px-2 pt-2 overflow-x-auto">
          <div className="flex gap-1">
            {sheets.map((sheet, idx) => (
              <button
                key={sheet.name}
                onClick={() => setActiveSheet(idx)}
                className={cn(
                  "px-4 py-2 text-xs font-medium rounded-t-lg transition-all whitespace-nowrap",
                  idx === activeSheet
                    ? "bg-white dark:bg-zinc-900 text-purple-600 dark:text-purple-400 border border-b-0 border-border shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sheet Content */}
      <div className="flex-1 overflow-auto p-4 xlsx-viewer-content">
        <style>{`
          .xlsx-viewer-content table {
            border-collapse: collapse;
            width: auto;
            min-width: 100%;
            font-size: 0.8125rem;
            line-height: 1.4;
          }
          .xlsx-viewer-content th,
          .xlsx-viewer-content td {
            border: 1px solid #e5e7eb;
            padding: 0.375rem 0.625rem;
            text-align: left;
            white-space: nowrap;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .dark .xlsx-viewer-content th,
          .dark .xlsx-viewer-content td {
            border-color: #374151;
          }
          .xlsx-viewer-content th {
            background: #f3f4f6;
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1;
          }
          .dark .xlsx-viewer-content th {
            background: #1f2937;
          }
          .xlsx-viewer-content tr:nth-child(even) td {
            background: #f9fafb;
          }
          .dark .xlsx-viewer-content tr:nth-child(even) td {
            background: #111827;
          }
          .xlsx-viewer-content tr:hover td {
            background: #ede9fe;
          }
          .dark .xlsx-viewer-content tr:hover td {
            background: #1e1b4b;
          }
        `}</style>
        {currentSheet && (
          <div dangerouslySetInnerHTML={{ __html: currentSheet.html }} />
        )}
      </div>
    </div>
  );
}
