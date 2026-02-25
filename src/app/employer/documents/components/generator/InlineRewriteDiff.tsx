"use client";

import React from "react";
import { diffWords } from "diff";
import { Button } from "../ui/button";
import { Check, X, RotateCw } from "lucide-react";
import { cn } from "~/lib/utils";

export interface InlineRewriteDiffProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  onTryAgain: () => void;
  isRetrying?: boolean;
}

/** Inline before/after diff shown directly in the document at the selection. */
export function InlineRewriteDiff({
  originalText,
  proposedText,
  onAccept,
  onReject,
  onTryAgain,
  isRetrying = false,
}: InlineRewriteDiffProps) {
  const changes = diffWords(originalText, proposedText);

  return (
    <span className="inline-block align-baseline my-2 w-full">
      <span className="inline-flex flex-col gap-2 p-3 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20 w-full max-w-full">
        {/* Before (strikethrough) + After (highlight) */}
        <span className="text-sm leading-relaxed">
          {changes.map((part, i) => (
            <span
              key={i}
              className={cn(
                part.added && "bg-green-500/30 text-green-800 dark:text-green-200 rounded-sm",
                part.removed && "bg-red-500/20 text-red-700 dark:text-red-300 line-through rounded-sm",
                !part.added && !part.removed && "text-foreground"
              )}
            >
              {part.value}
            </span>
          ))}
        </span>
        {/* Controls */}
        <span className="flex gap-2">
          <Button size="sm" onClick={onAccept} disabled={isRetrying} className="h-7 text-xs bg-green-600 hover:bg-green-700">
            <Check className="w-3 h-3 mr-1" />
            Accept
          </Button>
          <Button size="sm" variant="outline" onClick={onReject} disabled={isRetrying} className="h-7 text-xs">
            <X className="w-3 h-3 mr-1" />
            Reject
          </Button>
          <Button size="sm" variant="ghost" onClick={onTryAgain} disabled={isRetrying} className="h-7 text-xs">
            <RotateCw className={cn("w-3 h-3 mr-1", isRetrying && "animate-spin")} />
            Try again
          </Button>
        </span>
      </span>
    </span>
  );
}
