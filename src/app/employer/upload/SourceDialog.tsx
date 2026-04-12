"use client";

import React from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "~/app/employer/documents/components/ui/dialog";
import { GitHubSourceTab } from "./GitHubSourceTab";
import { PasteSourceTab } from "./PasteSourceTab";
import { WebsiteSourceTab } from "./WebsiteSourceTab";

import type { SourceType } from "./SourceGrid";

interface SourceDialogProps {
    open: SourceType | null;
    onClose: () => void;
    categories: { id: string; name: string }[];
    defaultCategory?: string;
    onFilesAdded: (files: File[]) => void;
}

const titles: Record<SourceType, { title: string; description: string }> = {
    github: {
        title: "Index a GitHub Repository",
        description: "Enter a repository URL to clone and index it into your knowledge base.",
    },
    paste: {
        title: "Paste Text",
        description: "Paste markdown or plain text to add as a document.",
    },
    website: {
        title: "Import from Website",
        description: "Crawl a web page and add its content to your knowledge base.",
    },
};

export function SourceDialog({
    open,
    onClose,
    categories,
    defaultCategory,
    onFilesAdded,
}: SourceDialogProps) {
    const info = open ? titles[open] : null;

    return (
        <Dialog open={!!open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className={`max-h-[85vh] overflow-y-auto ${open === "github" ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
                {info && (
                    <DialogHeader>
                        <DialogTitle>{info.title}</DialogTitle>
                        <DialogDescription>{info.description}</DialogDescription>
                    </DialogHeader>
                )}

                {open === "github" && (
                    <GitHubSourceTab
                        categories={categories}
                        defaultCategory={defaultCategory}
                    />
                )}

                {open === "paste" && (
                    <PasteSourceTab
                        onFilesAdded={(files) => {
                            onFilesAdded(files);
                            onClose();
                        }}
                    />
                )}

                {open === "website" && <WebsiteSourceTab />}
            </DialogContent>
        </Dialog>
    );
}
