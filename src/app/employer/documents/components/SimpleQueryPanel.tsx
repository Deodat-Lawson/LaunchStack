"use client";

import React, { useState } from 'react';
import dynamic from "next/dynamic";
import { 
  Send, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  FileText, 
  Building2, 
  Zap,
  BookOpen,
  GraduationCap,
  List,
  MessageSquare
} from 'lucide-react';
import { Button } from '~/app/employer/documents/components/ui/button';
import { Textarea } from '~/app/employer/documents/components/ui/textarea';
import { ScrollArea } from '~/app/employer/documents/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/app/employer/documents/components/ui/select';
import { cn } from "~/lib/utils";
import type { DocumentType } from '../types';
import type { AIModelType } from '~/app/api/agents/documentQ&A/services/types';

const MarkdownMessage = dynamic(
  () => import("~/app/_components/MarkdownMessage"),
  {
    loading: () => (
      <div className="text-sm text-muted-foreground">Rendering response...</div>
    ),
  }
);

interface SimpleQueryPanelProps {
  selectedDoc: DocumentType | null;
  companyId: number | null;
  aiQuestion: string;
  setAiQuestion: (q: string) => void;
  aiAnswer: string;
  setAiAnswer: (a: string) => void;
  aiError: string;
  setAiError: (e: string) => void;
  aiLoading: boolean;
  handleAiSearch: (e: React.FormEvent) => Promise<void>;
  searchScope: 'document' | 'company';
  setSearchScope: (s: 'document' | 'company') => void;
  aiStyle: string;
  setAiStyle: (s: string) => void;
  aiModel: AIModelType;
  setAiModel: (m: AIModelType) => void;
  modelAvailability?: Partial<Record<AIModelType, boolean>>;
  styleOptions: Record<string, string>;
  referencePages: number[];
  setPdfPageNumber: (p: number) => void;
  userRole?: 'employer' | 'employee';
}

const styleIcons: Record<string, React.ReactNode> = {
  concise: <Zap className="w-3.5 h-3.5" />,
  detailed: <BookOpen className="w-3.5 h-3.5" />,
  academic: <GraduationCap className="w-3.5 h-3.5" />,
  organized: <List className="w-3.5 h-3.5" />,
  "bullet-points": <List className="w-3.5 h-3.5" />, // Backwards compat just in case
};

const modelConfig: Array<{ key: AIModelType; label: string }> = [
  { key: "gpt-5.2", label: "GPT-5.2" },
  { key: "gpt-5-mini", label: "GPT-5 Mini" },
  { key: "gpt-5-nano", label: "GPT-5 Nano" },
  { key: "claude-opus-4.5", label: "Claude Opus 4.5" },
  { key: "gemini-3-flash", label: "Gemini 3 Flash" },
  { key: "gemini-3-pro", label: "Gemini 3 Pro" },
  { key: "gpt-5.1", label: "GPT-5.1" },
  { key: "gpt-4o", label: "GPT-4o" },
  { key: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { key: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

export function SimpleQueryPanel({
  selectedDoc,
  companyId,
  aiQuestion,
  setAiQuestion,
  aiAnswer,
  setAiAnswer,
  aiError,
  setAiError: _setAiError,
  aiLoading,
  handleAiSearch,
  searchScope,
  setSearchScope,
  aiStyle,
  setAiStyle,
  aiModel,
  setAiModel,
  modelAvailability = {},
  styleOptions,
  referencePages: _referencePages,
  setPdfPageNumber: _setPdfPageNumber,
  userRole = 'employer',
}: SimpleQueryPanelProps) {
  const showCompanyScope = userRole === 'employer';
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="bg-gradient-to-b from-slate-50/50 to-white dark:from-slate-900/50 dark:to-slate-950 flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-base text-foreground">Quick Query</h2>
            <p className="text-[11px] text-muted-foreground">
              Ask once, get instant answers
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 space-y-5">
          {/* Search Scope Toggle - only show company scope for employers */}
          {showCompanyScope && (
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-violet-500" />
                Search In
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSearchScope('document')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                    searchScope === 'document'
                      ? "bg-violet-600 text-white shadow-lg shadow-violet-500/25"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  )}
                >
                  <FileText className="w-3.5 h-3.5" />
                  This Document
                </button>
                <button
                  onClick={() => setSearchScope('company')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                    searchScope === 'company'
                      ? "bg-violet-600 text-white shadow-lg shadow-violet-500/25"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700",
                    !companyId && "opacity-80"
                  )}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  All Documents
                </button>
              </div>
            </div>
          )}

          {/* Response Style Pills */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-violet-500" />
              Response Style
            </span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(styleOptions).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setAiStyle(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200",
                    aiStyle === key
                      ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700"
                      : "bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  )}
                >
                  {styleIcons[key]}
                  {label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Model Selector */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-violet-500" />
              AI Model
            </span>
            <Select
              value={aiModel}
              onValueChange={(value) => setAiModel(value as AIModelType)}
            >
              <SelectTrigger
                size="sm"
                className="h-9 bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700 text-xs font-semibold"
              >
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelConfig.map((model) => (
                  <SelectItem
                    key={model.key}
                    value={model.key}
                    disabled={modelAvailability[model.key] === false}
                  >
                    {model.label}{modelAvailability[model.key] === false ? " (Unavailable)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Question Input */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-violet-500" />
              Your Question
            </span>
            <div className={cn(
              "relative rounded-2xl transition-all duration-300",
              isFocused 
                ? "ring-2 ring-violet-500/30 shadow-xl shadow-violet-500/10" 
                : "ring-1 ring-slate-200 dark:ring-slate-800"
            )}>
              <Textarea
                placeholder={
                  searchScope === 'company'
                    ? "What would you like to know about your documents?"
                    : selectedDoc
                    ? `Ask about "${selectedDoc.title}"...`
                    : "Select a document to start asking questions..."
                }
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className="min-h-[100px] resize-none bg-white dark:bg-slate-900 border-none rounded-2xl p-4 pb-14 text-sm focus-visible:ring-0 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleAiSearch(e as unknown as React.FormEvent);
                  }
                }}
              />
              
              {/* Input Footer */}
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-t from-white via-white dark:from-slate-900 dark:via-slate-900 rounded-b-2xl">
                <div className="flex items-center gap-2">
                  {selectedDoc && searchScope === 'document' && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-md">
                      <FileText className="w-3 h-3 text-violet-600" />
                      <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 max-w-[120px] truncate">
                        {selectedDoc.title}
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-medium hidden sm:block">
                    ↵ Enter
                  </span>
                  <Button
                    onClick={(e) => { void handleAiSearch(e); }}
                    disabled={!aiQuestion.trim() || aiLoading || (searchScope === 'document' && !selectedDoc)}
                    size="sm"
                    className={cn(
                      "h-8 px-4 rounded-lg text-xs font-semibold transition-all duration-300",
                      aiLoading 
                        ? "bg-slate-200 dark:bg-slate-700 text-slate-500" 
                        : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25"
                    )}
                  >
                    {aiLoading ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        Ask
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Response Section */}
          <div className="space-y-3 pt-2">
            {aiError && (
              <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-0.5">
                    File is still processing... Please try again later.
                  </p>
                </div>
              </div>
            )}

            {aiAnswer ? (
              <div className="space-y-3 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Response</span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 px-2.5 text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-lg" 
                    onClick={() => {
                      setAiAnswer('');
                      setAiQuestion('');
                    }}
                  >
                    Clear
                  </Button>
                </div>
                
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm min-w-0 overflow-hidden">
                  <MarkdownMessage
                    content={aiAnswer}
                    className="text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none break-words"
                  />
                </div>
              </div>
            ) : !aiLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="relative mb-5">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/30 dark:to-indigo-900/30 flex items-center justify-center">
                    <Sparkles className="w-9 h-9 text-violet-500/60 dark:text-violet-400/50" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg">
                    <Zap className="w-3.5 h-3.5 text-white" />
                  </div>
                </div>
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">Ready to help</h4>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
                  Ask a question above and get instant AI-powered insights from your documents.
                </p>
              </div>
            )}

            {aiLoading && (
              <div className="space-y-4 py-8">
                <div className="flex justify-center">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/30 dark:to-indigo-900/30 flex items-center justify-center animate-pulse">
                      <Sparkles className="w-7 h-7 text-violet-500/60 dark:text-violet-400/50" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-20 h-20 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
                    </div>
                  </div>
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Analyzing documents...</p>
                  <p className="text-[11px] text-muted-foreground">This may take a moment</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
