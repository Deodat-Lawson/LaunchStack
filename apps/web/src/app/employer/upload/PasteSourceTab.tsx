"use client";

import React, { useState } from "react";
import { ClipboardPaste, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import { Textarea } from "~/app/employer/documents/components/ui/textarea";

interface PasteSourceTabProps {
    onFilesAdded: (files: File[]) => void;
}

export function PasteSourceTab({ onFilesAdded }: PasteSourceTabProps) {
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");

    const handleAddToQueue = () => {
        const trimmedTitle = title.trim() || "Untitled Document";
        const trimmedContent = content.trim();

        if (!trimmedContent) {
            toast.error("Please enter some content");
            return;
        }

        // Sanitize filename
        const sanitized = trimmedTitle
            .replace(/[^a-zA-Z0-9\s-_]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 100);
        const filename = `${sanitized || "document"}.md`;

        const file = new File([trimmedContent], filename, {
            type: "text/markdown",
        });

        onFilesAdded([file]);
        setTitle("");
        setContent("");
        toast.success(`"${trimmedTitle}" added to upload queue`);
    };

    const wordCount = content.trim()
        ? content.trim().split(/\s+/).length
        : 0;

    return (
        <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
                    <ClipboardPaste className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Paste Text or Markdown
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Paste any text content directly. Supports Markdown formatting.
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <div>
                    <Label htmlFor="paste-title">Document Title</Label>
                    <Input
                        id="paste-title"
                        type="text"
                        placeholder="e.g., Meeting Notes, Research Summary..."
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="mt-1"
                    />
                </div>

                <div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="paste-content">Content</Label>
                        {wordCount > 0 && (
                            <span className="text-xs text-gray-400">
                                {wordCount} word{wordCount !== 1 ? "s" : ""}
                            </span>
                        )}
                    </div>
                    <Textarea
                        id="paste-content"
                        placeholder="Paste your text or markdown content here..."
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        className="mt-1 min-h-[300px] font-mono text-sm"
                    />
                </div>

                <Button
                    onClick={handleAddToQueue}
                    disabled={!content.trim()}
                    className="w-full"
                >
                    <Plus className="w-4 h-4 mr-2" />
                    Add to Upload Queue
                </Button>
            </div>
        </div>
    );
}
