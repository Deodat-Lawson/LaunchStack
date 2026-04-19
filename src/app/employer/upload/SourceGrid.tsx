"use client";

import React from "react";
import { Upload, Github, ClipboardPaste, Globe, Youtube } from "lucide-react";

export type SourceType = "github" | "paste" | "website" | "youtube";

interface SourceGridProps {
    onSelectSource: (source: SourceType) => void;
    onFileClick: () => void;
    onFolderClick: () => void;
}

const cardClasses =
    "flex flex-col items-center gap-2 p-5 rounded-xl border border-gray-200 dark:border-purple-500/20 bg-white dark:bg-slate-800/60 hover:border-purple-400 dark:hover:border-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-all cursor-pointer text-center";

export function SourceGrid({ onSelectSource, onFileClick, onFolderClick }: SourceGridProps) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl mx-auto">
            <button type="button" onClick={onFileClick} className={cardClasses}>
                <Upload className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Files &amp; Folders
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                    PDF, DOCX, images, ZIP
                </span>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onFolderClick();
                    }}
                    className="text-xs text-purple-600 dark:text-purple-400 hover:underline"
                >
                    or select folder
                </button>
            </button>

            <button type="button" onClick={() => onSelectSource("github")} className={cardClasses}>
                <Github className="w-6 h-6 text-gray-900 dark:text-white" />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    GitHub Repo
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                    Clone &amp; index a repository
                </span>
            </button>

            <button type="button" onClick={() => onSelectSource("paste")} className={cardClasses}>
                <ClipboardPaste className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Paste Text
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                    Markdown or plain text
                </span>
            </button>

            <button type="button" onClick={() => onSelectSource("website")} className={cardClasses}>
                <Globe className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Website
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">Coming soon</span>
            </button>

            <button type="button" onClick={() => onSelectSource("youtube")} className={cardClasses}>
                <Youtube className="w-6 h-6 text-red-600 dark:text-red-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    YouTube &amp; Video
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                    Transcribe a video URL
                </span>
            </button>
        </div>
    );
}
