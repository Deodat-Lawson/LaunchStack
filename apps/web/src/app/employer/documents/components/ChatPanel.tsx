"use client";

import {
  FileText,
  Building2,
  Archive,
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
  CheckSquare,
} from 'lucide-react';
import { Button } from '~/app/employer/documents/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/app/employer/documents/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/app/employer/documents/components/ui/tooltip';
import { cn } from "~/lib/utils";
import { AgentChatInterface } from './AgentChatInterface';
import type { DocumentType } from '../types';
import type { AIModelType, LLMProvider } from '~/app/api/agents/documentQ&A/services/types';

interface ChatPanelProps {
  userId: string;
  selectedDoc: DocumentType | null;
  currentChatId: string | null;
  setCurrentChatId: (id: string | null) => void;
  aiStyle: string;
  setAiStyle: (s: string) => void;
  aiPersona: string;
  setAiPersona: (p: string) => void;
  provider: LLMProvider;
  setProvider: (p: LLMProvider) => void;
  aiModel: AIModelType;
  setAiModel: (m: AIModelType) => void;
  modelAvailability?: Partial<Record<AIModelType, boolean>>;
  providerAvailability?: Partial<Record<LLMProvider, boolean>>;
  searchScope: 'document' | 'company' | 'archive' | 'selected';
  setSearchScope: (s: 'document' | 'company' | 'archive' | 'selected') => void;
  /**
   * User-picked subset of documents from the sidebar checkboxes. When this
   * has ≥2 IDs the "Selected (N)" scope button appears and auto-activates;
   * empty/single means the button is hidden and scope falls back to Doc.
   */
  selectedDocumentIds?: number[];
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

const providerOptions: Array<{ key: LLMProvider; label: string }> = [
  { key: "openai", label: "OpenAI" },
  { key: "anthropic", label: "Anthropic" },
  { key: "google", label: "Google" },
  { key: "ollama", label: "Ollama" },
];

const modelConfig: Array<{ key: AIModelType; label: string; provider: LLMProvider }> = [
  { key: "gpt-5.2", label: "GPT-5.2", provider: "openai" },
  { key: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai" },
  { key: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai" },
  { key: "gpt-5.1", label: "GPT-5.1", provider: "openai" },
  { key: "claude-sonnet-4", label: "Claude Sonnet 4", provider: "anthropic" },
  { key: "claude-opus-4.5", label: "Claude Opus 4.5", provider: "anthropic" },
  { key: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
  { key: "gemini-3-flash", label: "Gemini 3 Flash", provider: "google" },
  { key: "gemini-3-pro", label: "Gemini 3 Pro", provider: "google" },
  { key: "llama3.1:8b", label: "Llama 3.1 8B", provider: "ollama" },
  { key: "llama3.2:3b", label: "Llama 3.2 3B", provider: "ollama" },
  { key: "mistral:7b", label: "Mistral 7B", provider: "ollama" },
  { key: "codellama:7b", label: "Code Llama 7B", provider: "ollama" },
  { key: "gemma2:9b", label: "Gemma 2 9B", provider: "ollama" },
  { key: "phi3:mini", label: "Phi-3 Mini", provider: "ollama" },
  { key: "qwen2.5:7b", label: "Qwen 2.5 7B", provider: "ollama" },
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
  provider,
  setProvider,
  aiModel,
  setAiModel,
  modelAvailability = {},
  providerAvailability = {},
  searchScope,
  setSearchScope,
  selectedDocumentIds,
  companyId,
  setPdfPageNumber,
  styleOptions: _styleOptions,
  onCreateChat,
  isPreviewCollapsed,
  onTogglePreview,
  userRole = 'employer',
}: ChatPanelProps) {
  const showCompanyScope = userRole === 'employer';
  const hasArchive = !!selectedDoc?.sourceArchiveName;
  const selectedCount = selectedDocumentIds?.length ?? 0;
  const showSelectedScope = selectedCount >= 2;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Toolbar Header */}
      <div className="flex-shrink-0 border-b border-border px-4 py-2.5 bg-background/90 backdrop-blur-sm z-20">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Status + Scope + Model */}
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Online Status */}
            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/30 rounded-md border border-emerald-200/60 dark:border-emerald-800/40 flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-[0.15em]">Online</span>
            </div>

            {/* Scope Toggle */}
            {showCompanyScope ? (
              <div className="flex items-center bg-muted rounded-md p-0.5 flex-shrink-0">
                <button
                  onClick={() => setSearchScope('document')}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all",
                    searchScope === 'document'
                      ? "bg-background text-purple-600 dark:text-purple-400 shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <FileText className="w-2.5 h-2.5" />
                  Doc
                </button>
                {hasArchive && (
                  <button
                    onClick={() => setSearchScope('archive')}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all",
                      searchScope === 'archive'
                        ? "bg-background text-purple-600 dark:text-purple-400 shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={`Search all files from ${selectedDoc?.sourceArchiveName}`}
                  >
                    <Archive className="w-2.5 h-2.5" />
                    Zip
                  </button>
                )}
                {showSelectedScope && (
                  <button
                    onClick={() => setSearchScope('selected')}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all",
                      searchScope === 'selected'
                        ? "bg-background text-purple-600 dark:text-purple-400 shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={`Search the ${selectedCount} checked documents`}
                  >
                    <CheckSquare className="w-2.5 h-2.5" />
                    Selected ({selectedCount})
                  </button>
                )}
                <button
                  onClick={() => setSearchScope('company')}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all",
                    searchScope === 'company'
                      ? "bg-background text-purple-600 dark:text-purple-400 shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                    !companyId && "opacity-70"
                  )}
                >
                  <Building2 className="w-2.5 h-2.5" />
                  All
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded-md flex-shrink-0">
                <FileText className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">Document</span>
              </div>
            )}

            {/* Provider & Model Selector */}
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={provider}
                onValueChange={(value) => setProvider(value as LLMProvider)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 w-[110px] bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700 text-[10px] font-semibold"
                >
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions
                    .filter((opt) => providerAvailability[opt.key] !== false)
                    .map((option) => (
                      <SelectItem key={option.key} value={option.key} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
                  {modelConfig
                    .filter((model) => model.provider === provider)
                    .map((model) => {
                      const unavailable = modelAvailability[model.key] === false;
                      return (
                        <SelectItem
                          key={model.key}
                          value={model.key}
                          disabled={unavailable}
                          className={cn("text-xs", unavailable && "opacity-50")}
                        >
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-1.5">
                                  <span className={cn(
                                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                    unavailable ? "bg-red-400" : "bg-emerald-500"
                                  )} />
                                  {model.label}
                                </span>
                              </TooltipTrigger>
                              {unavailable && (
                                <TooltipContent side="left" className="text-xs">
                                  API key not configured for this model
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </TooltipProvider>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Center: Style & Persona pills */}
          <div className="hidden md:flex items-center gap-3">
            {/* Style pills */}
            <div className="flex items-center gap-0.5">
              {styleConfig.map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setAiStyle(key)}
                  className={cn(
                    "w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150",
                    aiStyle === key
                      ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title={key.charAt(0).toUpperCase() + key.slice(1).replace('-', ' ')}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-border" />

            {/* Persona pills */}
            <div className="flex items-center gap-0.5">
              {personaConfig.map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onClick={() => setAiPersona(key)}
                  className={cn(
                    "h-7 px-2 rounded-md flex items-center gap-1 text-[10px] font-semibold transition-all duration-150",
                    aiPersona === key
                      ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
              "h-7 px-2 rounded-md transition-all flex-shrink-0",
              isPreviewCollapsed
                ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title={isPreviewCollapsed ? "Show Preview" : "Hide Preview"}
          >
            {isPreviewCollapsed
              ? <PanelRightOpen className="w-4 h-4" />
              : <PanelRightClose className="w-4 h-4" />
            }
          </Button>
        </div>
      </div>

      {/* Legal / Financial Persona Disclaimer */}
      {aiPersona === 'legal-expert' && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-start gap-2.5 animate-in fade-in">
          <Scale className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
            This is AI-generated analysis, not legal advice. Consult a qualified attorney for legal matters.
          </p>
        </div>
      )}
      {aiPersona === 'financial-expert' && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-start gap-2.5 animate-in fade-in">
          <Briefcase className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
            This is AI-generated analysis, not financial advice. Consult a qualified financial advisor.
          </p>
        </div>
      )}

      {/* Processing Warning */}
      {selectedDoc && selectedDoc.ocrProcessed === false && searchScope === 'document' && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-center gap-2.5 animate-in fade-in">
          <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin flex-shrink-0" />
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
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
          selectedDocumentIds={selectedDocumentIds}
          companyId={companyId}
          archiveName={selectedDoc?.sourceArchiveName}
          aiStyle={aiStyle}
          aiPersona={aiPersona}
          provider={provider}
          aiModel={aiModel}
          onPageClick={setPdfPageNumber}
          onCreateChat={onCreateChat}
          isDocumentProcessing={selectedDoc?.ocrProcessed === false && searchScope === 'document'}
        />
      </div>
    </div>
  );
}
