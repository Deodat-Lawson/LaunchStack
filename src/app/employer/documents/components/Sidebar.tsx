"use client";

import React, { useState, useEffect } from 'react';
import { 
  Search, 
  FileText, 
  ChevronRight, 
  ChevronDown, 
  ChevronLeft, 
  ShieldCheck, 
  Trash2, 
  MoreVertical, 
  MessageCircle,
  PenTool,
  PenLine,
  StickyNote,
  Clock,
  Brain,
  Upload,
  LayoutDashboard,
  Plus,
  FolderOpen,
  Layers,
  TrendingUp,
  Users,
  Settings,
  Building2,
  Megaphone,
  Archive,
} from 'lucide-react';
import { UserButton, useUser } from '@clerk/nextjs';
import { Input } from '~/app/employer/documents/components/ui/input';
import { Button } from '~/app/employer/documents/components/ui/button';
import { cn } from "~/lib/utils";
import { ThemeToggle } from '~/app/_components/ThemeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/app/employer/documents/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/app/employer/documents/components/ui/tooltip';
import { ChatSelector } from './ChatSelector';
import { DISPLAY_TYPE_ICONS } from './DocumentViewer';
import type { ViewMode, DocumentType, CategoryGroup } from '../types';
import { getDocumentDisplayType, type DocumentDisplayType } from '../types/document';

interface SidebarProps {
  categories: CategoryGroup[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  fileTypeFilter?: DocumentDisplayType | "all";
  setFileTypeFilter?: (filter: DocumentDisplayType | "all") => void;
  selectedDoc: DocumentType | null;
  setSelectedDoc: (doc: DocumentType | null) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleCategory?: (categoryName: string) => void;
  deleteDocument?: (docId: number) => void;
  isCollapsed?: boolean;
  onCollapseToggle?: (collapsed: boolean) => void;
  userId?: string;
  currentChatId?: string | null;
  onSelectChat?: (chatId: string | null) => void;
  onNewChat?: () => void;
  userRole?: 'employer' | 'employee';
  totalDocuments?: number;
}

interface NavItem {
  id: ViewMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  employerOnly?: boolean;
  badge?: string;
  description?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  employerOnly?: boolean;
}

const NAV_GROUPS = (isEmployer: boolean): NavGroup[] => [
  ...(isEmployer ? [{
    label: "Workspace",
    items: [
      { id: "dashboard" as ViewMode, label: "Home", icon: LayoutDashboard, employerOnly: true, description: "Dashboard overview with document stats and quick actions" },
    ],
  }] : []),
  {
    label: "Knowledge",
    items: [
      { id: "with-ai-qa" as ViewMode, label: "Ask AI", icon: MessageCircle, description: "Chat with AI about your uploaded documents" },
      { id: "predictive-analysis" as ViewMode, label: "Audit", icon: ShieldCheck, description: "AI-powered compliance and gap analysis" },
      { id: "notes" as ViewMode, label: "Notes", icon: StickyNote, description: "Create and manage notes about your documents" },
    ],
  },
  {
    label: "Create",
    items: [
      ...(isEmployer ? [
        { id: "generator" as ViewMode, label: "Draft", icon: PenTool, employerOnly: true, badge: "Beta", description: "Generate new documents with AI assistance" },
      ] : []),
      { id: "rewrite" as ViewMode, label: "Rewrite", icon: PenLine, description: "Improve and edit existing document content" },
      ...(isEmployer ? [
        { id: "marketing-pipeline" as ViewMode, label: "Marketing", icon: Megaphone, employerOnly: true, description: "Create marketing content from your documents" },
      ] : []),
    ],
  },
  ...(isEmployer ? [{
    label: "Company",
    employerOnly: true,
    items: [
      { id: "employees" as ViewMode, label: "Team", icon: Users, description: "View and manage employee accounts" },
      { id: "metadata" as ViewMode, label: "Company Profile", icon: Building2, description: "AI-extracted company intelligence from documents" },
      { id: "analytics" as ViewMode, label: "Analytics", icon: TrendingUp, description: "Usage statistics and document insights" },
      { id: "settings" as ViewMode, label: "Settings", icon: Settings, description: "Configure company settings and preferences" },
    ],
  }] : []),
];

const allNavItems = (isEmployer: boolean): NavItem[] =>
  NAV_GROUPS(isEmployer).flatMap((g) => g.items);

export function Sidebar({
  categories,
  searchTerm,
  setSearchTerm,
  fileTypeFilter: _fileTypeFilter = "all",
  setFileTypeFilter: _setFileTypeFilter,
  selectedDoc,
  setSelectedDoc,
  viewMode,
  setViewMode,
  toggleCategory,
  deleteDocument,
  isCollapsed = false,
  onCollapseToggle,
  userId,
  currentChatId,
  onSelectChat,
  onNewChat,
  userRole = 'employer',
  totalDocuments = 0,
}: SidebarProps) {
  const isEmployer = userRole === 'employer';
  const showDelete = isEmployer && !!deleteDocument;
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const navGroups = NAV_GROUPS(isEmployer);
  const flatNavItems = allNavItems(isEmployer);

  const { user } = useUser();
  const [companyName, setCompanyName] = useState<string>("");
  const [openArchives, setOpenArchives] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const fetchCompany = async () => {
      try {
        const res = await fetch("/api/fetchCompany");
        if (!res.ok) return;
        const data = (await res.json()) as { name?: string };
        if (!cancelled && data.name) setCompanyName(data.name);
      } catch {
        // silent — company name is cosmetic
      }
    };
    void fetchCompany();
    return () => { cancelled = true; };
  }, []);

  const displayName = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "User";

  /* ── COLLAPSED STATE ── */
  if (isCollapsed) {
    return (
      <TooltipProvider delayDuration={0}>
      <div className="w-full h-full bg-background border-r border-border flex flex-col items-center py-3 overflow-hidden">
        {/* Logo / Expand */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapseToggle?.(false)}
          className="w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/25 transition-all hover:scale-105 active:scale-95 mb-4"
          title="Expand Sidebar"
        >
          <Brain className="w-5 h-5" />
        </Button>

        {/* Nav Items */}
        <div className="flex flex-col gap-1 w-full px-2 flex-1">
          {navGroups.map((group, gi) => (
            <React.Fragment key={group.label}>
              {gi > 0 && <div className="w-8 h-px bg-border mx-auto my-1" />}
              {group.items.map((item) => (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setViewMode(item.id)}
                      className={cn(
                        "w-full h-10 rounded-xl transition-all duration-200",
                        viewMode === item.id
                          ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                          : "text-muted-foreground hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                      )}
                    >
                      <item.icon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[200px]">
                    <p className="font-semibold">{item.label}</p>
                    {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                  </TooltipContent>
                </Tooltip>
              ))}
            </React.Fragment>
          ))}
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-col items-center gap-1.5 px-2 w-full">
          <ThemeToggle />
          <div className="w-10 flex items-center justify-center">
            <UserButton />
          </div>
        </div>
      </div>
      </TooltipProvider>
    );
  }

  /* ── EXPANDED STATE ── */
  return (
    <div className="bg-background flex flex-col h-full w-full overflow-hidden">
      {/* ── HEADER ── */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        {/* Logo row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center shadow-md shadow-purple-500/20">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-400 dark:to-indigo-400">
                Launchstack
              </span>
              <div className="text-[10px] text-muted-foreground font-medium -mt-0.5">Workspace</div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onCollapseToggle?.(true)}
              className="h-7 w-7 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all"
              title="Collapse Sidebar"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-purple-600" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className={cn(
            "absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 transition-colors",
            isSearchFocused ? "text-purple-600" : "text-muted-foreground"
          )} />
          <Input
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className="pl-8 h-8 text-xs bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-purple-500 rounded-lg"
          />
        </div>
      </div>

      {/* ── GROUPED NAVIGATION ── */}
      {navGroups.map((group) => (
        <div key={group.label} className="px-3 py-2.5 border-b border-border">
          <div className="text-[9px] font-black text-muted-foreground mb-1.5 px-1 tracking-[0.15em] uppercase">
            {group.label}
          </div>
          <TooltipProvider delayDuration={400}>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-2.5 h-8 rounded-lg px-2.5 text-xs font-medium transition-all duration-150",
                      viewMode === item.id
                        ? "bg-purple-600 hover:bg-purple-700 text-white shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => setViewMode(item.id)}
                  >
                    <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge && (
                      <span className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                        viewMode === item.id
                          ? "bg-white/20 text-white"
                          : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                      )}>
                        {item.badge}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                {item.description && (
                  <TooltipContent side="right">
                    {item.description}
                  </TooltipContent>
                )}
              </Tooltip>
            ))}
          </div>
          </TooltipProvider>
        </div>
      ))}

      {/* ── DOCUMENTS SECTION ── */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-0 custom-scrollbar">
        <div className="px-3 pt-3 pb-1">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <div className="flex items-center gap-1.5">
              <div className="text-[9px] font-black text-muted-foreground tracking-[0.15em] uppercase">
                Library
              </div>
              {totalDocuments > 0 && (
                <span className="text-[9px] font-mono font-bold bg-muted text-muted-foreground rounded px-1 py-0.5">
                  {totalDocuments}
                </span>
              )}
            </div>
            {isEmployer && (
              <button
                onClick={() => setViewMode('upload')}
                className={cn(
                  "flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider rounded-md px-2 py-1 transition-all",
                  viewMode === 'upload'
                    ? "bg-purple-600 text-white"
                    : "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                )}
                title="Upload Documents"
              >
                <Plus className="w-2.5 h-2.5" />
                Upload
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {/* All Documents option */}
            {viewMode === "with-ai-qa" && (
              <button
                onClick={() => setSelectedDoc(null)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all duration-150 group relative",
                  !selectedDoc
                    ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {!selectedDoc && (
                  <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-purple-600 rounded-r-full" />
                )}
                <Layers className={cn(
                  "w-3.5 h-3.5 flex-shrink-0 transition-colors",
                  !selectedDoc ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"
                )} />
                <span className="truncate">All Documents</span>
              </button>
            )}

            {categories.map(category => (
              <div key={category.name} className="group/cat">
                <button
                  onClick={() => toggleCategory?.(category.name)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-muted/70 rounded-md text-[10px] font-bold text-muted-foreground transition-all uppercase tracking-wider"
                >
                  {category.isOpen
                    ? <ChevronDown className="w-2.5 h-2.5 text-purple-500 flex-shrink-0" />
                    : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" />
                  }
                  <FolderOpen className="w-2.5 h-2.5 flex-shrink-0" />
                  <span className="truncate">{category.name}</span>
                  <span className="ml-auto font-mono text-[9px] opacity-60">{category.documents.length}</span>
                </button>

                {category.isOpen && (() => {
                  const standaloneDocs = category.documents.filter(d => !d.sourceArchiveName);
                  const archiveGroups: Record<string, typeof category.documents> = {};
                  category.documents.forEach(d => {
                    if (d.sourceArchiveName) {
                      (archiveGroups[d.sourceArchiveName] ??= []).push(d);
                    }
                  });

                  const renderDocItem = (doc: typeof category.documents[0]) => {
                    const docDisplayType = getDocumentDisplayType(doc);
                    const DocIcon = DISPLAY_TYPE_ICONS[docDisplayType];
                    const isSelected = selectedDoc?.id === doc.id;
                    return (
                      <div
                        key={doc.id}
                        className={cn(
                          "group/doc flex items-center rounded-lg transition-all duration-150 relative",
                          isSelected
                            ? "bg-purple-50 dark:bg-purple-900/20"
                            : "hover:bg-muted/50"
                        )}
                      >
                        {isSelected && (
                          <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-purple-600 rounded-r-full" />
                        )}
                        <button
                          onClick={() => setSelectedDoc(doc)}
                          className={cn(
                            "flex-1 flex items-center gap-2 px-2.5 py-2 text-xs transition-all",
                            isSelected
                              ? "text-purple-700 dark:text-purple-300 font-semibold"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <DocIcon className={cn(
                            "w-3.5 h-3.5 flex-shrink-0 transition-colors",
                            isSelected ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"
                          )} />
                          <span className="flex-1 text-left truncate">{doc.title}</span>
                          {doc.ocrProcessed === false && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" title="Processing" />
                          )}
                          {doc.ocrProcessed === true && doc.ocrMetadata?.error && (
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title={`Failed: ${doc.ocrMetadata.errorMessage ?? doc.ocrMetadata.error}`} />
                          )}
                        </button>

                        {showDelete && deleteDocument && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover/doc:opacity-100 transition-opacity mr-1 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 flex-shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem
                                className="text-red-600 dark:text-red-400 cursor-pointer focus:bg-red-50 dark:focus:bg-red-900/20 focus:text-red-600 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteDocument(doc.id);
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" />
                                Delete Document
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    );
                  };

                  return (
                    <div className="ml-3 border-l border-border pl-1 space-y-0.5 animate-in slide-in-from-left-1 duration-150">
                      {standaloneDocs.map(renderDocItem)}

                      {Object.entries(archiveGroups).map(([archiveName, docs]) => {
                        const isOpen = openArchives.has(archiveName);
                        return (
                          <div key={`archive-${archiveName}`}>
                            <button
                              onClick={() => setOpenArchives(prev => {
                                const next = new Set(prev);
                                if (next.has(archiveName)) next.delete(archiveName);
                                else next.add(archiveName);
                                return next;
                              })}
                              className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-muted/70 rounded-md text-[10px] font-semibold text-muted-foreground transition-all"
                            >
                              {isOpen
                                ? <ChevronDown className="w-2.5 h-2.5 text-purple-500 flex-shrink-0" />
                                : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" />
                              }
                              <Archive className="w-2.5 h-2.5 flex-shrink-0 text-purple-500" />
                              <span className="truncate flex-1 text-left">{archiveName}</span>
                              <span className="font-mono text-[9px] opacity-60">{docs.length}</span>
                            </button>
                            {isOpen && (
                              <div className="ml-3 border-l border-purple-200 dark:border-purple-800/40 pl-1 space-y-0.5 animate-in slide-in-from-left-1 duration-150">
                                {docs.map(renderDocItem)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            ))}

            {categories.length === 0 && !searchTerm && (
              <div className="px-2 py-6 text-center">
                <FileText className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-[10px] text-muted-foreground font-medium">No documents yet</p>
                {isEmployer && (
                  <button
                    onClick={() => setViewMode('upload')}
                    className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold mt-1 hover:underline"
                  >
                    Upload your first document →
                  </button>
                )}
              </div>
            )}

            {categories.length === 0 && searchTerm && (
              <div className="px-2 py-4 text-center">
                <p className="text-[10px] text-muted-foreground">No results for &quot;{searchTerm}&quot;</p>
              </div>
            )}
          </div>
        </div>

        {/* AI Chat History */}
        {viewMode === "with-ai-qa" && userId && onSelectChat && onNewChat && (
          <div className="border-t border-border pt-3 px-3 pb-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-[9px] font-black text-muted-foreground tracking-[0.15em] uppercase flex items-center gap-1.5">
                <Clock className="w-2.5 h-2.5" />
                Chat History
              </div>
            </div>
            <ChatSelector
              userId={userId}
              currentChatId={currentChatId ?? null}
              onSelectChat={onSelectChat}
              onNewChat={onNewChat}
            />
          </div>
        )}
      </div>

      {/* ── BOTTOM USER PROFILE ── */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-border bg-background">
        <div className="flex items-center gap-2.5">
          <UserButton />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold text-foreground truncate">{displayName}</div>
            {companyName && (
              <div className="text-[9px] text-muted-foreground truncate">{companyName}</div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.4); }
      `}</style>
    </div>
  );
}
