"use client";

import React, { useState } from "react";
import { Loader2, AlertTriangle, ExternalLink, Monitor } from "lucide-react";

interface PptxViewerProps {
  url: string;
  title: string;
}

/**
 * Returns true if the URL is a publicly accessible HTTP(S) URL.
 * Database-stored files (e.g. /api/files/123) are not publicly accessible
 * and cannot be embedded via Office Online.
 */
function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "https:" && !parsed.pathname.startsWith("/api/files/");
  } catch {
    return false;
  }
}

/**
 * PPTX viewer that uses Microsoft Office Online viewer for publicly accessible
 * files and shows a download fallback for locally stored files.
 */
export function PptxViewer({ url, title }: PptxViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Build absolute URL for Office Online
  const absoluteUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
  const canEmbed = isPublicUrl(absoluteUrl);

  if (!canEmbed) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center bg-muted/30">
        <div className="w-16 h-16 rounded-2xl bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
          <Monitor className="w-8 h-8 text-orange-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-1">
            PowerPoint preview requires a publicly accessible URL
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            This file is stored locally and cannot be embedded in the Office Online viewer.
            You can download it and open it in PowerPoint or Google Slides.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Download presentation
          </a>
        </div>
      </div>
    );
  }

  const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`;

  return (
    <div className="relative w-full h-full bg-muted/30">
      {/* Loading indicator */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-muted/30">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
          <p className="text-sm text-muted-foreground font-medium">Loading presentation...</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center z-10 bg-muted/30">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">
              Office Online viewer failed to load
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              The file may not be accessible. Try downloading it instead.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Download presentation
            </a>
          </div>
        </div>
      )}

      <iframe
        src={officeViewerUrl}
        className="w-full h-full border-0"
        title={title}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}
