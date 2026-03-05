"use client";

import React from "react";
import { FileText, Download } from "lucide-react";

interface DocxViewerProps {
  url: string;
  title: string;
}

export function DocxViewer({ url, title }: DocxViewerProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center bg-muted/40 rounded-lg">
      <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
        <FileText className="w-8 h-8 text-purple-600 dark:text-purple-300" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground mb-1">DOCX preview unavailable</p>
        <p className="text-xs text-muted-foreground">
          Download <span className="font-medium">{title}</span> to view the full document.
        </p>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
      >
        <Download className="w-4 h-4" />
        Download DOCX
      </a>
    </div>
  );
}
