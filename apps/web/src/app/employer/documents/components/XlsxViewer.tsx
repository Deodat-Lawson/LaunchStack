"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "~/lib/utils";
import { ViewerNotice } from "./ViewerNotice";
import { Button } from "~/components/ui/button";

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
    const t = useTranslations("viewers.xlsx");
    const tc = useTranslations("common");
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
            if (!response.ok) throw new Error(t("fetchFailed", { status: response.status }));

            const arrayBuffer = await response.arrayBuffer();

            // Dynamically import SheetJS for client-side use
            const XLSX = await import("xlsx");
            const workbook = XLSX.read(arrayBuffer, { type: "array" });

            const parsed: SheetData[] = workbook.SheetNames.map(name => {
                const sheet = workbook.Sheets[name];
                if (!sheet) {
                    const empty = document.createElement("p");
                    empty.textContent = t("emptySheet");
                    return { name, html: empty.outerHTML };
                }

                const html = XLSX.utils.sheet_to_html(sheet, {
                    id: `sheet-${name}`,
                    editable: false,
                });
                return { name, html };
            });

            if (parsed.length === 0) {
                throw new Error(t("noSheets"));
            }

            setSheets(parsed);
        } catch (err) {
            console.error("[XlsxViewer] Error converting spreadsheet:", err);
            setError(err instanceof Error ? err.message : t("renderFailed"));
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
                <p className="text-ink-3 text-sm font-medium">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        return (
            <ViewerNotice
                icon={<AlertTriangle />}
                title={t("renderFailed")}
                detail={error}
                action={
                    <Button onClick={() => void loadSpreadsheet()}>
                        <RotateCw />
                        {tc("actions.retry")}
                    </Button>
                }
            />
        );
    }

    const currentSheet = sheets[activeSheet];

    return (
        <div className="bg-panel flex h-full w-full flex-col overflow-hidden">
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
                                        ? "border-line text-brand-ink bg-panel border border-b-0 shadow-sm"
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
            border: 1px solid var(--line);
            padding: 0.375rem 0.625rem;
            text-align: left;
            white-space: nowrap;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            font-variant-numeric: tabular-nums;
          }
          .xlsx-viewer-content th {
            background: var(--panel-2);
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1;
          }
          .xlsx-viewer-content tr:nth-child(even) td {
            background: var(--bg-2);
          }
          .xlsx-viewer-content tr:hover td {
            background: var(--accent-soft);
          }
        `}</style>
                {currentSheet && <div dangerouslySetInnerHTML={{ __html: currentSheet.html }} />}
            </div>
        </div>
    );
}
