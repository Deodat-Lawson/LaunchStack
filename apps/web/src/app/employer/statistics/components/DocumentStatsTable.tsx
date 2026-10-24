"use client";

import React, { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { FileText, Search, ChevronRight } from "lucide-react";
import type { DocumentStat } from "../types";
import { DocumentDetailsSheet } from "./DocumentDetailsSheet";
import { cn } from "~/lib/utils";

interface DocumentStatsTableProps {
    documents: DocumentStat[];
}

type TimeT = ReturnType<typeof useTranslations<"statistics.time">>;

/** "Just now", "5 min ago", "3 hr ago", "2 days ago"; a date after a week. */
function formatRelativeTime(
    dateString: string | null,
    t: TimeT,
    format: ReturnType<typeof useFormatter>
): string {
    if (!dateString) return t("never");

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return t("minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("daysAgo", { count: diffDays });
    return format.dateTime(date, { year: "numeric", month: "numeric", day: "numeric" });
}

const HEAD = "text-ink-3 h-9 text-xs font-medium";

/** The table sits flush in its section's card; the section heading names it. */
export function DocumentStatsTable({ documents }: DocumentStatsTableProps) {
    const t = useTranslations("statistics.documents");
    const tTime = useTranslations("statistics.time");
    const format = useFormatter();
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedDoc, setSelectedDoc] = useState<DocumentStat | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);

    const filteredDocuments = documents.filter(
        doc =>
            doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            doc.category.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleRowClick = (doc: DocumentStat) => {
        setSelectedDoc(doc);
        setIsSheetOpen(true);
    };

    return (
        <>
            {/* Toolbar */}
            <div className="border-line flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
                <p className="text-ink-3 m-0 text-[13px]">{t("hint")}</p>
                <div className="@max-sm:w-full flex items-center gap-2">
                    <div className="@max-sm:flex-1 relative">
                        <Search
                            aria-hidden
                            className="text-ink-3 pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
                        />
                        <Input
                            aria-label={t("searchPlaceholder")}
                            placeholder={t("searchPlaceholder")}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="bg-panel @max-sm:w-full h-9 w-[220px] pl-9 text-sm"
                        />
                    </div>
                    <Badge variant="secondary" className="tabular-nums">
                        {t("shown", {
                            shown: format.number(filteredDocuments.length),
                            total: format.number(documents.length),
                        })}
                    </Badge>
                </div>
            </div>

            <div className="max-h-[450px] overflow-auto">
                <Table aria-label={t("title")}>
                    <TableHeader className="bg-panel-2 sticky top-0 z-10">
                        <TableRow className="border-line hover:bg-transparent">
                            <TableHead className={cn(HEAD, "pl-4")}>
                                {t("columns.document")}
                            </TableHead>
                            <TableHead className={cn(HEAD, "@max-sm:hidden")}>
                                {t("columns.category")}
                            </TableHead>
                            <TableHead className={cn(HEAD, "text-right")}>
                                {t("columns.views")}
                            </TableHead>
                            <TableHead className={cn(HEAD, "text-right")}>
                                {t("columns.lastViewed")}
                            </TableHead>
                            <TableHead className="@max-sm:hidden w-10 pr-4" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredDocuments.length > 0 ? (
                            filteredDocuments.map(doc => (
                                <TableRow
                                    key={doc.id}
                                    tabIndex={0}
                                    className="border-line-2 hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:ring-brand/50 group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset"
                                    onClick={() => handleRowClick(doc)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            handleRowClick(doc);
                                        }
                                    }}
                                >
                                    {/* Takes whatever width is left and truncates into it. */}
                                    <TableCell className="w-full max-w-0 py-2.5 pl-4">
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            <FileText
                                                aria-hidden
                                                className="text-ink-3 size-4 shrink-0"
                                            />
                                            <span
                                                className="text-ink min-w-0 truncate text-sm font-medium"
                                                title={doc.title}
                                            >
                                                {doc.title}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="@max-sm:hidden py-2.5">
                                        <Badge variant="secondary">{doc.category}</Badge>
                                    </TableCell>
                                    <TableCell className="text-ink py-2.5 text-right text-sm tabular-nums">
                                        {format.number(doc.views)}
                                    </TableCell>
                                    <TableCell className="text-ink-3 py-2.5 text-right text-sm">
                                        {formatRelativeTime(doc.lastViewedAt, tTime, format)}
                                    </TableCell>
                                    <TableCell className="@max-sm:hidden py-2.5 pr-4">
                                        <ChevronRight
                                            aria-hidden
                                            className="text-ink-4 group-hover:text-ink-2 size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                                        />
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={5} className="h-32 whitespace-normal">
                                    <div className="text-ink-3 flex flex-col items-center justify-center gap-2 text-center">
                                        <FileText aria-hidden className="text-ink-4 size-8" />
                                        <p className="text-ink-2 m-0 text-sm font-medium">
                                            {t("empty")}
                                        </p>
                                        {searchTerm && (
                                            <p className="m-0 text-xs">{t("emptyHint")}</p>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <DocumentDetailsSheet
                document={selectedDoc}
                isOpen={isSheetOpen}
                onClose={() => setIsSheetOpen(false)}
            />
        </>
    );
}
