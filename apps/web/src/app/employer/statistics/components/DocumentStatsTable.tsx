"use client";

import React, { useState } from "react";
import { Card } from "~/app/employer/documents/components/ui/card";
import { Badge } from "~/app/employer/documents/components/ui/badge";
import { Input } from "~/app/employer/documents/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/app/employer/documents/components/ui/table";
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

    const filteredDocuments = documents.filter(doc => 
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.category.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleRowClick = (doc: DocumentStat) => {
        setSelectedDoc(doc);
        setIsSheetOpen(true);
    };

    return (
        <>
            <Card className="p-6 border-none shadow-sm flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                            <FileText className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">
                                Document Statistics
                            </h2>
                            <p className="text-xs text-muted-foreground mt-0.5">Click a row to view details</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input 
                                placeholder="Search documents..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9 h-9 w-[220px] text-sm"
                            />
                        </div>
                        <Badge
                            variant="outline"
                            className="rounded-full px-3 py-1.5 border-blue-200 dark:border-blue-900/30 text-blue-600 dark:text-blue-400 font-bold"
                        >
                            {filteredDocuments.length} / {documents.length}
                        </Badge>
                    </div>
                </div>

                {/* Scrollable Table Container */}
                <div className="relative rounded-xl border border-border overflow-hidden bg-card">
                    <div className="overflow-auto max-h-[450px] scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                        <Table>
                            <TableHeader className="sticky top-0 z-20">
                                <TableRow className="bg-muted/80 backdrop-blur-sm border-b">
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider w-[45%] py-3">
                                        Document
                                    </TableHead>
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider py-3">
                                        Category
                                    </TableHead>
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right py-3">
                                        Views
                                    </TableHead>
                                    <TableHead className="font-bold text-[11px] uppercase tracking-wider text-right py-3">
                                        Last Viewed
                                    </TableHead>
                                    <TableHead className="w-[40px] py-3"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredDocuments.length > 0 ? filteredDocuments.map((doc, index) => (
                                    <TableRow 
                                        key={doc.id} 
                                        className={cn(
                                            "cursor-pointer transition-all duration-150 group",
                                            "hover:bg-blue-50/50 dark:hover:bg-blue-950/20",
                                            index % 2 === 0 ? "bg-background" : "bg-muted/20"
                                        )}
                                        onClick={() => handleRowClick(doc)}
                                    >
                                        <TableCell className="py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="p-1.5 bg-muted rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                                                    <FileText className="w-4 h-4 text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
                                                </div>
                                                <span className="font-medium text-sm truncate max-w-[280px] group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors" title={doc.title}>
                                                    {doc.title}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-3">
                                            <Badge variant="secondary" className="text-[10px] font-bold px-2 py-0.5">
                                                {doc.category}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right py-3">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                                                <span className="font-mono text-sm font-medium">{doc.views}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground text-sm py-3">
                                            {formatRelativeTime(doc.lastViewedAt)}
                                        </TableCell>
                                        <TableCell className="py-3">
                                            <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32">
                                            <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                                <FileText className="w-10 h-10 text-muted-foreground/30" />
                                                <p className="text-sm font-medium">No documents found</p>
                                                {searchTerm && (
                                                    <p className="text-xs">Try adjusting your search</p>
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
                        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent pointer-events-none" />
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
