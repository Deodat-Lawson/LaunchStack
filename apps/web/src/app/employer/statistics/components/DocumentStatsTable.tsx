"use client";

import React, { useState } from "react";
import { Card } from "~/components/ui/card";
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
import { FileText, Search, Eye, ChevronRight } from "lucide-react";
import type { DocumentStat } from "../types";
import { DocumentDetailsSheet } from "./DocumentDetailsSheet";
import { cn } from "~/lib/utils";

interface DocumentStatsTableProps {
    documents: DocumentStat[];
}

function formatRelativeTime(dateString: string | null): string {
    if (!dateString) return "Never";

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
}

export function DocumentStatsTable({ documents }: DocumentStatsTableProps) {
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
            <Card className="flex flex-col border-none p-6 shadow-sm">
                {/* Header */}
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            <FileText className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-foreground text-sm font-bold uppercase tracking-widest">
                                Document Statistics
                            </h2>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                                Click a row to view details
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                            <Input
                                placeholder="Search documents..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="h-9 w-[220px] pl-9 text-sm"
                            />
                        </div>
                        <Badge
                            variant="outline"
                            className="rounded-full border-blue-200 px-3 py-1.5 font-bold text-blue-600 dark:border-blue-900/30 dark:text-blue-400"
                        >
                            {filteredDocuments.length} / {documents.length}
                        </Badge>
                    </div>
                </div>

                {/* Scrollable Table Container */}
                <div className="border-border bg-card relative overflow-hidden rounded-xl border">
                    <div className="scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent max-h-[450px] overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 z-20">
                                <TableRow className="bg-muted/80 border-b backdrop-blur-sm">
                                    <TableHead className="w-[45%] py-3 text-[11px] font-bold uppercase tracking-wider">
                                        Document
                                    </TableHead>
                                    <TableHead className="py-3 text-[11px] font-bold uppercase tracking-wider">
                                        Category
                                    </TableHead>
                                    <TableHead className="py-3 text-right text-[11px] font-bold uppercase tracking-wider">
                                        Views
                                    </TableHead>
                                    <TableHead className="py-3 text-right text-[11px] font-bold uppercase tracking-wider">
                                        Last Viewed
                                    </TableHead>
                                    <TableHead className="w-[40px] py-3"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredDocuments.length > 0 ? (
                                    filteredDocuments.map((doc, index) => (
                                        <TableRow
                                            key={doc.id}
                                            className={cn(
                                                "group cursor-pointer transition-all duration-150",
                                                "hover:bg-blue-50/50 dark:hover:bg-blue-950/20",
                                                index % 2 === 0 ? "bg-background" : "bg-muted/20"
                                            )}
                                            onClick={() => handleRowClick(doc)}
                                        >
                                            <TableCell className="py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="bg-muted rounded-lg p-1.5 transition-colors group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30">
                                                        <FileText className="text-muted-foreground h-4 w-4 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                                                    </div>
                                                    <span
                                                        className="max-w-[280px] truncate text-sm font-medium transition-colors group-hover:text-blue-700 dark:group-hover:text-blue-300"
                                                        title={doc.title}
                                                    >
                                                        {doc.title}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                <Badge
                                                    variant="secondary"
                                                    className="px-2 py-0.5 text-[10px] font-bold"
                                                >
                                                    {doc.category}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="py-3 text-right">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <Eye className="text-muted-foreground h-3.5 w-3.5" />
                                                    <span className="font-mono text-sm font-medium">
                                                        {doc.views}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground py-3 text-right text-sm">
                                                {formatRelativeTime(doc.lastViewedAt)}
                                            </TableCell>
                                            <TableCell className="py-3">
                                                <ChevronRight className="text-muted-foreground/50 h-4 w-4 transition-all group-hover:translate-x-0.5 group-hover:text-blue-500" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32">
                                            <div className="text-muted-foreground flex flex-col items-center justify-center gap-2">
                                                <FileText className="text-muted-foreground/30 h-10 w-10" />
                                                <p className="text-sm font-medium">
                                                    No documents found
                                                </p>
                                                {searchTerm && (
                                                    <p className="text-xs">
                                                        Try adjusting your search
                                                    </p>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Scroll fade indicator */}
                    {filteredDocuments.length > 8 && (
                        <div className="from-card pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t to-transparent" />
                    )}
                </div>
            </Card>

            <DocumentDetailsSheet
                document={selectedDoc}
                isOpen={isSheetOpen}
                onClose={() => setIsSheetOpen(false)}
            />
        </>
    );
}
