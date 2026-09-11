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

            const parsed: SheetData[] = workbook.SheetNames.map(name => {
                const sheet = workbook.Sheets[name];
                if (!sheet) return { name, html: "<p>Empty sheet</p>" };

                const html = XLSX.utils.sheet_to_html(sheet, {
                    id: `sheet-${name}`,
                    editable: false,
                });
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
            <div className="bg-panel-2/30 flex h-full flex-col items-center justify-center gap-3">
                <Loader2 className="text-brand-ink h-8 w-8 animate-spin" />
                <p className="text-ink-3 text-sm font-medium">Loading spreadsheet...</p>
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
                    <p className="text-ink mb-1 text-sm font-medium">
                        Failed to render spreadsheet
                    </p>
                    <p className="text-ink-3 mb-4 text-xs">{error}</p>
                    <button
                        onClick={() => void loadSpreadsheet()}
                        className="bg-brand hover:bg-brand-hi inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                    >
                        <RotateCw className="h-4 w-4" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const currentSheet = sheets[activeSheet];

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-white dark:bg-zinc-900">
            {/* Sheet Tabs */}
            {sheets.length > 1 && (
                <div className="border-line bg-panel-2/30 flex-shrink-0 overflow-x-auto border-b px-2 pt-2">
                    <div className="flex gap-1">
                        {sheets.map((sheet, idx) => (
                            <button
                                key={sheet.name}
                                onClick={() => setActiveSheet(idx)}
                                className={cn(
                                    "whitespace-nowrap rounded-t-lg px-4 py-2 text-xs font-medium transition-all",
                                    idx === activeSheet
                                        ? "border-line text-brand-ink border border-b-0 bg-white shadow-sm dark:bg-zinc-900"
                                        : "text-ink-3 hover:text-ink hover:bg-panel-2/50"
                                )}
                            >
                                {sheet.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Sheet Content */}
            <div className="xlsx-viewer-content flex-1 overflow-auto p-4">
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
                {currentSheet && <div dangerouslySetInnerHTML={{ __html: currentSheet.html }} />}
            </div>
        </div>
    );
}
