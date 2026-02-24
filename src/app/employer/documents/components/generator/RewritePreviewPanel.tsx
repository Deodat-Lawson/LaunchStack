"use client";

import React, { useState } from "react";
import { diffWords } from "diff";
import { Button } from "../ui/button";
import { Check, X, RotateCw, Eye, EyeOff, ArrowLeftRight } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Card } from "../ui/card";

export interface RewritePreviewProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  onTryAgain: () => void;
  isRetrying?: boolean;
}

export function RewritePreviewPanel({
  originalText,
  proposedText,
  onAccept,
  onReject,
  onTryAgain,
  isRetrying = false,
}: RewritePreviewProps) {
  const [viewMode, setViewMode] = useState<"diff" | "sidebyside" | "clean">("sidebyside");
  const safeOriginal = typeof originalText === "string" ? originalText : "";
  const safeProposed = typeof proposedText === "string" ? proposedText : "";
  const changes = diffWords(safeOriginal, safeProposed);
  
  const stats = {
    wordsOriginal: safeOriginal.trim() ? safeOriginal.split(/\s+/).length : 0,
    wordsRewritten: safeProposed.trim() ? safeProposed.split(/\s+/).length : 0,
    charactersOriginal: safeOriginal.length,
    charactersRewritten: safeProposed.length,
    changes: changes.filter(part => part.added || part.removed).length
  };

  const renderDiffView = () => (
    <div className="p-4 rounded-lg bg-muted/50 border border-border font-mono text-sm leading-relaxed max-h-96 overflow-y-auto">
      {changes.map((part, i) => (
        <span
          key={i}
          className={cn(
            part.added && "bg-green-500/20 text-green-800 dark:text-green-200 font-medium",
            part.removed && "bg-red-500/20 text-red-800 dark:text-red-200 line-through",
            !part.added && !part.removed && "text-foreground"
          )}
        >
          {part.value}
        </span>
      ))}
    </div>
  );

  const renderSideBySideView = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <p className="text-sm font-semibold text-foreground">Original</p>
          <span className="text-xs text-muted-foreground">
            ({stats.wordsOriginal} words, {stats.charactersOriginal} chars)
          </span>
        </div>
        <div className="p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200/50 dark:border-red-900/50 text-sm leading-relaxed max-h-80 overflow-y-auto">
          {safeOriginal}
        </div>
      </Card>
      
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <p className="text-sm font-semibold text-foreground">Rewritten</p>
          <span className="text-xs text-muted-foreground">
            ({stats.wordsRewritten} words, {stats.charactersRewritten} chars)
          </span>
        </div>
        <div className="p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200/50 dark:border-green-900/50 text-sm leading-relaxed max-h-80 overflow-y-auto">
          {safeProposed}
        </div>
      </Card>
    </div>
  );

  const renderCleanView = () => (
    <div className="p-4 rounded-lg bg-background border border-border text-sm leading-relaxed max-h-96 overflow-y-auto">
      {safeProposed}
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-6 border border-border rounded-xl bg-card shadow-lg">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-semibold text-foreground">Rewrite Preview</h4>
          <p className="text-sm text-muted-foreground">
            {stats.changes} changes • 
            {stats.wordsRewritten > stats.wordsOriginal 
              ? `+${stats.wordsRewritten - stats.wordsOriginal}` 
              : `${stats.wordsRewritten - stats.wordsOriginal}`
            } words
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReject}
            disabled={isRetrying}
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <X className="w-3 h-3 mr-1.5" />
            Reject
          </Button>
          <Button variant="outline" size="sm" onClick={onTryAgain} disabled={isRetrying}>
            <RotateCw className={cn("w-3 h-3 mr-1.5", isRetrying && "animate-spin")} />
            Try Again
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            disabled={isRetrying}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Check className="w-3 h-3 mr-1.5" />
            Accept
          </Button>
        </div>
      </div>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sidebyside" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            <ArrowLeftRight className="w-4 h-4 mr-2" />
            Side by Side
          </TabsTrigger>
          <TabsTrigger value="diff" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            <Eye className="w-4 h-4 mr-2" />
            Show Changes
          </TabsTrigger>
          <TabsTrigger value="clean" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            <EyeOff className="w-4 h-4 mr-2" />
            Clean View
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="sidebyside" className="mt-4">
          {renderSideBySideView()}
        </TabsContent>
        
        <TabsContent value="diff" className="mt-4">
          <div>
            <p className="text-sm font-medium mb-2 text-muted-foreground">Changes highlighted</p>
            {renderDiffView()}
          </div>
        </TabsContent>
        
        <TabsContent value="clean" className="mt-4">
          <div>
            <p className="text-sm font-medium mb-2 text-muted-foreground">Final result</p>
            {renderCleanView()}
          </div>
        </TabsContent>
      </Tabs>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
        <div className="text-center">
          <div className="text-lg font-semibold text-foreground">{stats.wordsOriginal}</div>
          <div className="text-xs text-muted-foreground">Original Words</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-foreground">{stats.wordsRewritten}</div>
          <div className="text-xs text-muted-foreground">New Words</div>
        </div>
        <div className="text-center">
          <div className={cn(
            "text-lg font-semibold",
            stats.wordsRewritten > stats.wordsOriginal ? "text-green-600" : 
            stats.wordsRewritten < stats.wordsOriginal ? "text-red-600" : "text-foreground"
          )}>
            {stats.wordsRewritten > stats.wordsOriginal ? '+' : ''}{stats.wordsRewritten - stats.wordsOriginal}
          </div>
          <div className="text-xs text-muted-foreground">Word Difference</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-amber-600">{stats.changes}</div>
          <div className="text-xs text-muted-foreground">Changes Made</div>
        </div>
      </div>
    </div>
  );
}
