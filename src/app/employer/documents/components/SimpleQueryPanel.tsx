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
  MessageSquare,
  Loader2,
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
import type { AIModelType, LLMProvider } from '~/app/api/agents/documentQ&A/services/types';
import { ModelBadge } from './ModelBadge';

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
  searchScope: 'document' | 'company' | 'archive';
  setSearchScope: (s: 'document' | 'company' | 'archive') => void;
  aiStyle: string;
  setAiStyle: (s: string) => void;
  provider: LLMProvider;
  setProvider: (p: LLMProvider) => void;
  aiModel: AIModelType;
  setAiModel: (m: AIModelType) => void;
  aiAnswerModel?: AIModelType;
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
  "bullet-points": <List className="w-3.5 h-3.5" />,
};

const providerOptions: Array<{ key: LLMProvider; label: string }> = [
  { key: "openai", label: "OpenAI" },
  { key: "ollama", label: "Ollama" },
];

const modelConfig: Array<{ key: AIModelType; label: string; provider: LLMProvider }> = [
  { key: "gpt-5.2", label: "GPT-5.2", provider: "openai" },
  { key: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai" },
  { key: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai" },
  { key: "gpt-5.1", label: "GPT-5.1", provider: "openai" },
  { key: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { key: "llama3.1:8b", label: "Llama 3.1 8B", provider: "ollama" },
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
  provider,
  setProvider,
  aiModel,
  setAiModel,
  aiAnswerModel,
  modelAvailability = {},
  styleOptions,
  referencePages: _referencePages,
  setPdfPageNumber: _setPdfPageNumber,
  userRole = 'employer',
}: SimpleQueryPanelProps) {
  const showCompanyScope = userRole === 'employer';
  const [isFocused, setIsFocused] = useState(false);
  const availableModels = modelConfig.filter((model) => model.provider === provider);

  return (
    <div className="bg-background flex flex-col h-full border-l border-border">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-border flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/20">
          <MessageSquare className="w-3.5 h-3.5 text-white" />
        </div>
        <div>
          <h2 className="font-bold text-sm text-foreground leading-none">Quick Query</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">Ask once, get instant answers</p>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {/* Processing Warning */}
          {selectedDoc && selectedDoc.ocrProcessed === false && searchScope === 'document' && (
            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-0.5">Document still processing</p>
                <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80 leading-relaxed">
                  AI queries will be available once processing completes. Try switching to &quot;All Documents&quot; scope.
                </p>
              </div>
            </div>
          )}

          {/* Search Scope Toggle */}
          {showCompanyScope && (
            <div className="space-y-1.5">
              <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5">
                Search In
              </span>
              <div className="flex gap-1.5 p-1 bg-muted rounded-lg">
                <button
                  onClick={() => setSearchScope('document')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-semibold transition-all duration-150",
                    searchScope === 'document'
                      ? "bg-background text-purple-600 dark:text-purple-400 shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <FileText className="w-3 h-3" />
                  This Document
                </button>
                <button
                  onClick={() => setSearchScope('company')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-semibold transition-all duration-150",
                    searchScope === 'company'
                      ? "bg-background text-purple-600 dark:text-purple-400 shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                    !companyId && "opacity-70"
                  )}
                >
                  <Building2 className="w-3 h-3" />
                  All Documents
                </button>
              </div>
            </div>
          )}

          {/* Response Style */}
          <div className="space-y-1.5">
            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5">
              Response Style
            </span>
            <div className="flex flex-wrap gap-1">
              {Object.entries(styleOptions).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setAiStyle(key)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150",
                    aiStyle === key
                      ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700"
                      : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                  )}
                >
                  {styleIcons[key]}
                  {label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Provider & Model Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-violet-500" />
                Provider
              </span>
              <Select
                value={provider}
                onValueChange={(value) => setProvider(value as LLMProvider)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-9 bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700 text-xs font-semibold"
                >
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                  {availableModels.map((model) => (
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
          </div>

          {/* Question Input */}
          <div className="space-y-1.5">
            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5">
              Your Question
            </span>
            <div className={cn(
              "relative rounded-xl border transition-all duration-200",
              isFocused
                ? "border-purple-400 dark:border-purple-600 ring-2 ring-purple-500/15"
                : "border-border bg-muted/30"
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
                className="min-h-[90px] resize-none bg-transparent border-none rounded-xl p-3 pb-12 text-sm focus-visible:ring-0 placeholder:text-muted-foreground/60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleAiSearch(e as unknown as React.FormEvent);
                  }
                }}
              />
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2.5 rounded-b-xl">
                <div className="flex items-center gap-1.5">
                  {selectedDoc && searchScope === 'document' && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-purple-50 dark:bg-purple-900/30 rounded-md">
                      <FileText className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                      <span className="text-[10px] font-medium text-purple-700 dark:text-purple-300 max-w-[100px] truncate">
                        {selectedDoc.title}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground hidden sm:block">↵ Enter</span>
                  <Button
                    onClick={(e) => { void handleAiSearch(e); }}
                    disabled={!aiQuestion.trim() || aiLoading || (searchScope === 'document' && !selectedDoc) || (searchScope === 'document' && selectedDoc?.ocrProcessed === false)}
                    size="sm"
                    className={cn(
                      "h-7 px-3 rounded-lg text-xs font-semibold transition-all duration-200",
                      aiLoading
                        ? "bg-muted text-muted-foreground"
                        : "bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-500/20"
                    )}
                  >
                    {aiLoading ? (
                      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Send className="w-3 h-3 mr-1" />
                        Ask
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Response Section */}
          <div className="space-y-3 pt-1">
            {aiError && (
              <div className="p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 rounded-xl flex items-start gap-2.5 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                  File is still processing... Please try again later.
                </p>
              </div>
            )}

            {aiAnswer ? (
              <div className="space-y-2 animate-in fade-in zoom-in-95 duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em]">Response</span>
                    <ModelBadge model={aiAnswerModel} className="ml-0.5" />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-md"
                    onClick={() => {
                      setAiAnswer('');
                      setAiQuestion('');
                    }}
                  >
                    Clear
                  </Button>
                </div>

                <div className="bg-card p-4 rounded-xl border border-border shadow-sm min-w-0 overflow-hidden">
                  <MarkdownMessage
                    content={aiAnswer}
                    className="text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none break-words"
                  />
                </div>
              </div>
            ) : !aiLoading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="relative mb-4">
                  <div className="w-16 h-16 rounded-2xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-purple-400/60 dark:text-purple-500/40" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm">
                    <Zap className="w-3 h-3 text-white" />
                  </div>
                </div>
                <h4 className="text-sm font-bold text-foreground mb-1">Ready to help</h4>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[200px]">
                  Ask a question above to get AI-powered insights from your documents.
                </p>
              </div>
            )}

            {aiLoading && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="relative">
                  <div className="w-14 h-14 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-purple-400/60 animate-pulse" />
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-[68px] h-[68px] border-2 border-purple-200 dark:border-purple-800 border-t-purple-600 dark:border-t-purple-400 rounded-full animate-spin" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">Analyzing documents...</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">This may take a moment</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
