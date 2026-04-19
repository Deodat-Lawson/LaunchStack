"use client";

import React from "react";
import {
    FileText,
    X,
    Check,
    AlertCircle,
    Loader2,
    ChevronDown,
    ChevronUp,
    Trash2,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/app/employer/documents/components/ui/select";
import { Progress } from "~/app/employer/documents/components/ui/progress";

interface DocumentFile {
    id: string;
    file: File;
    title: string;
    category: string;
    uploadDate: string;
    processingMethod: string;
    storageMethod: string;
    status: "pending" | "uploading" | "success" | "error";
    progress: number;
    error?: string;
}

interface FileQueueProps {
    documents: DocumentFile[];
    categories: { id: string; name: string }[];
    expandedDocId: string | null;
    errors: Record<string, string>;
    onRemove: (id: string) => void;
    onUpdate: (id: string, updates: Partial<DocumentFile>) => void;
    onClearAll: () => void;
    onToggleExpand: (id: string) => void;
    formatFileSize: (bytes: number) => string;
}

export function FileQueue({
    documents,
    categories,
    expandedDocId,
    errors,
    onRemove,
    onUpdate,
    onClearAll,
    onToggleExpand,
    formatFileSize,
}: FileQueueProps) {
    return (
        <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200">
                    Upload Queue ({documents.length}{" "}
                    {documents.length === 1 ? "file" : "files"})
                </h3>
                <Button variant="outline" size="sm" onClick={onClearAll}>
                    Clear All
                </Button>
            </div>

            <div className="space-y-2">
                {documents.map((doc, index) => (
                    <div
                        key={doc.id}
                        className="border border-gray-200 dark:border-purple-500/20 rounded-lg overflow-hidden"
                    >
                        <div
                            className="p-4 bg-gray-50 dark:bg-slate-800/60 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/60 transition-colors"
                            onClick={() => onToggleExpand(doc.id)}
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex-shrink-0">
                                    {doc.status === "success" ? (
                                        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                                            <Check className="h-4 w-4 text-green-600" />
                                        </div>
                                    ) : doc.status === "error" ? (
                                        <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                                            <AlertCircle className="h-4 w-4 text-red-600" />
                                        </div>
                                    ) : doc.status === "uploading" ? (
                                        <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center">
                                            <Loader2 className="h-4 w-4 text-purple-600 dark:text-purple-400 animate-spin" />
                                        </div>
                                    ) : (
                                        <div className="w-8 h-8 bg-gray-200 dark:bg-slate-700 rounded-full flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-400">
                                            {index + 1}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 dark:text-gray-200 truncate">
                                        {doc.title}
                                    </p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        {formatFileSize(doc.file.size)}
                                        {doc.status === "error" && doc.error && (
                                            <span className="text-red-600 ml-2">
                                                &bull; {doc.error}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {doc.status === "uploading" && (
                                        <span className="text-sm text-purple-600 dark:text-purple-400 font-medium">
                                            {doc.progress}%
                                        </span>
                                    )}
                                    {doc.status === "pending" && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemove(doc.id);
                                            }}
                                            aria-label="Remove file"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    )}
                                    {expandedDocId === doc.id ? (
                                        <ChevronUp className="h-5 w-5 text-gray-400" />
                                    ) : (
                                        <ChevronDown className="h-5 w-5 text-gray-400" />
                                    )}
                                </div>
                            </div>

                            {doc.status === "uploading" && (
                                <div className="mt-3">
                                    <Progress value={doc.progress} className="h-1" />
                                </div>
                            )}
                        </div>

                        {expandedDocId === doc.id && doc.status === "pending" && (
                            <div className="p-4 border-t border-gray-200 dark:border-purple-500/20 space-y-4 bg-white dark:bg-slate-900/50">
                                <div>
                                    <Label htmlFor={`title-${doc.id}`}>
                                        Document Title{" "}
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id={`title-${doc.id}`}
                                        value={doc.title}
                                        onChange={(e) =>
                                            onUpdate(doc.id, { title: e.target.value })
                                        }
                                        placeholder="Enter document title"
                                        className={
                                            errors[`title-${doc.id}`] ? "border-red-500" : ""
                                        }
                                    />
                                    {errors[`title-${doc.id}`] && (
                                        <p className="text-sm text-red-600 mt-1">
                                            {errors[`title-${doc.id}`]}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <Label htmlFor={`category-${doc.id}`}>Category</Label>
                                    <Select
                                        value={doc.category || undefined}
                                        onValueChange={(value) =>
                                            onUpdate(doc.id, { category: value })
                                        }
                                    >
                                        <SelectTrigger id={`category-${doc.id}`}>
                                            <SelectValue placeholder="Select a category (optional)" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {categories.map((c) => (
                                                <SelectItem key={c.id} value={c.name}>
                                                    {c.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => onRemove(doc.id)}
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Remove from queue
                                </Button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
