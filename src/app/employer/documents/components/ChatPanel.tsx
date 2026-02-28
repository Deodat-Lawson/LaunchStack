"use client";

import { 
  FileText,
  Building2,
  Zap,
  BookOpen,
  GraduationCap,
  List,
  User,
  Briefcase,
  Scale,
  Calculator,
  Sparkles,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
} from 'lucide-react';
import { Button } from '~/app/employer/documents/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/app/employer/documents/components/ui/select';
import { cn } from "~/lib/utils";
import { AgentChatInterface } from './AgentChatInterface';
import type { DocumentType } from '../types';
import type { AIModelType } from '~/app/api/agents/documentQ&A/services/types';

interface ChatPanelProps {
  userId: string;
  selectedDoc: DocumentType | null;
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  aiStyle: string;
  setAiStyle: (s: string) => void;
  aiPersona: string;
  setAiPersona: (p: string) => void;
  aiModel: AIModelType;
  setAiModel: (m: AIModelType) => void;
  modelAvailability?: Partial<Record<AIModelType, boolean>>;
  searchScope: 'document' | 'company';
  setSearchScope: (s: 'document' | 'company') => void;
  companyId: number | null;
  setPdfPageNumber: (p: number) => void;
  styleOptions: Record<string, string>;
  onCreateChat: () => Promise<string | null>;
  isPreviewCollapsed?: boolean;
  onTogglePreview?: () => void;
  userRole?: 'employer' | 'employee';
}

const styleConfig = [
  { key: 'concise', icon: Zap, label: 'Concise' },
  { key: 'detailed', icon: BookOpen, label: 'Detailed' },
  { key: 'academic', icon: GraduationCap, label: 'Academic' },
  { key: 'bullet-points', icon: List, label: 'Bullets' },
];

const personaConfig = [
  { key: 'general', icon: User, label: 'General' },
  { key: 'learning-coach', icon: Sparkles, label: 'Coach' },
  { key: 'financial-expert', icon: Briefcase, label: 'Finance' },
  { key: 'legal-expert', icon: Scale, label: 'Legal' },
  { key: 'math-reasoning', icon: Calculator, label: 'Math' },
];

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

export function ChatPanel({
  userId,
  selectedDoc,
  currentChatId,
  setCurrentChatId: _setCurrentChatId,
  aiStyle,
  setAiStyle,
  aiPersona,
  setAiPersona,
  aiModel,
  setAiModel,
  modelAvailability = {},
  searchScope,
  setSearchScope,
  companyId,
  setPdfPageNumber,
  styleOptions: _styleOptions,
  onCreateChat,
  isPreviewCollapsed,
  onTogglePreview,
  userRole = 'employer',
}: ChatPanelProps) {
  const showCompanyScope = userRole === 'employer';
  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-gradient-to-b from-slate-50/30 to-white dark:from-slate-950/30 dark:to-slate-900 transition-all duration-300">
      {/* Chat Header */}
      <div className="flex-shrink-0 border-b border-slate-200/60 dark:border-slate-800/60 px-5 py-3 z-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Status & Scope */}
          <div className="flex items-center gap-3">
            {/* Online Status */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200/50 dark:border-emerald-800/30">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Online</span>
            </div>

            {/* Scope Toggle - only show company scope for employers */}
            {showCompanyScope ? (
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => setSearchScope('document')}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                    searchScope === 'document'
                      ? "bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm"
                      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  )}
                >
                  <FileText className="w-3 h-3" />
                  Doc
                </button>
                <button
                  onClick={() => setSearchScope('company')}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                    searchScope === 'company'
                      ? "bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm"
                      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300",
                    !companyId && "opacity-80"
                  )}
                >
                  <Building2 className="w-3 h-3" />
                  All
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <FileText className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">Document</span>
              </div>
            )}

            {/* Model Selector */}
            <div className="shrink-0">
              <Select
                value={aiModel}
                onValueChange={(value) => setAiModel(value as AIModelType)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 w-[150px] bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700 text-[10px] font-semibold"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  {modelConfig.map((model) => (
                    <SelectItem
                      key={model.key}
                      value={model.key}
                      disabled={modelAvailability[model.key] === false}
                      className="text-xs"
                    >
                      {model.label}{modelAvailability[model.key] === false ? " (Unavailable)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Center: Style & Persona Pills */}
          <div className="hidden md:flex items-center gap-4">
            {/* Style Pills */}
            <div className="flex items-center gap-1">
              {styleConfig.map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setAiStyle(key)}
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200",
                    aiStyle === key
                      ? "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400"
                      : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  )}
                  title={key.charAt(0).toUpperCase() + key.slice(1).replace('-', ' ')}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />

            {/* Persona Pills */}
            <div className="flex items-center gap-1">
              {personaConfig.map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onClick={() => setAiPersona(key)}
                  className={cn(
                    "h-7 px-2 rounded-lg flex items-center gap-1 text-[10px] font-semibold transition-all duration-200",
                    aiPersona === key
                      ? "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400"
                      : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  )}
                  title={label}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">{label}</span>
                </button>
              ))}
            </div>

          </div>

          {/* Right: Preview Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onTogglePreview}
            className={cn(
              "h-8 px-2.5 rounded-lg transition-all",
              isPreviewCollapsed
                ? "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            )}
            title={isPreviewCollapsed ? "Show Preview" : "Hide Preview"}
          >
            {isPreviewCollapsed ? (
              <PanelRightOpen className="w-4 h-4" />
            ) : (
              <PanelRightClose className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {selectedDoc && selectedDoc.ocrProcessed === false && searchScope === 'document' && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
          <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin flex-shrink-0" />
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 leading-relaxed">
            This document is still being processed. AI chat will be available once indexing completes.
          </p>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 relative overflow-hidden">
        <AgentChatInterface
          chatId={currentChatId}
          userId={userId}
          selectedDocTitle={selectedDoc?.title}
          searchScope={searchScope}
          selectedDocId={selectedDoc?.id}
          companyId={companyId}
          aiStyle={aiStyle}
          aiPersona={aiPersona}
          aiModel={aiModel}
          onPageClick={setPdfPageNumber}
          onCreateChat={onCreateChat}
          isDocumentProcessing={selectedDoc?.ocrProcessed === false && searchScope === 'document'}
        />
      </div>
    </div>
  );
}
