"use client";

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  FileText,
  Upload,
  PenTool,
  MessageCircle,
  BarChart3,
  FolderOpen,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowRight,
  Layers,
  Zap,
  FileSearch,
  PenLine,
  Tag,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/app/employer/documents/components/ui/button";
import type { DocumentType, CategoryGroup } from "../types";
import type { ViewMode } from "../types";
import { getDocumentDisplayType } from "../types/document";
import { DISPLAY_TYPE_ICONS } from "./DocumentViewer";

interface EmployerDashboardProps {
  documents: DocumentType[];
  categories: CategoryGroup[];
  setViewMode: (mode: ViewMode) => void;
  setSelectedDoc: (doc: DocumentType | null) => void;
  companyName?: string;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  image: "Image",
  docx: "Word",
  xlsx: "Excel",
  pptx: "PowerPoint",
  text: "Text",
  unknown: "Unknown",
};

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  image: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  docx: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  xlsx: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  pptx: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  text: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  unknown: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-500",
};

export function EmployerDashboard({
  documents,
  categories,
  setViewMode,
  setSelectedDoc,
  companyName,
}: EmployerDashboardProps) {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/company/onboarding");
        if (!res.ok) return;
        const data = (await res.json()) as { description: string | null };
        if (!cancelled && !data.description) {
          setProfileIncomplete(true);
        }
      } catch {
        // silently ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const total = documents.length;
    const processing = documents.filter((d) => d.ocrProcessed === false).length;
    const processed = documents.filter((d) => d.ocrProcessed === true).length;
    const categoryCount = categories.length;
    const typeBreakdown = documents.reduce<Record<string, number>>((acc, doc) => {
      const t = getDocumentDisplayType(doc);
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});

    return { total, processing, processed, categoryCount, typeBreakdown };
  }, [documents, categories]);

  const recentDocs = useMemo(
    () => documents.slice(0, 8),
    [documents]
  );

  const topCategories = useMemo(() => {
    return [...categories]
      .sort((a, b) => b.documents.length - a.documents.length)
      .slice(0, 6);
  }, [categories]);

  const quickActions = [
    {
      icon: Upload,
      label: "Upload Documents",
      description: "Add files to your document library",
      accent: "purple",
      onClick: () => setViewMode("upload"),
    },
    {
      icon: MessageCircle,
      label: "AI Q&A",
      description: "Ask questions about your documents",
      accent: "indigo",
      onClick: () => setViewMode("with-ai-qa"),
    },
    {
      icon: PenTool,
      label: "Document Generator",
      description: "Create AI-powered documents",
      accent: "violet",
      onClick: () => setViewMode("generator"),
    },
    {
      icon: BarChart3,
      label: "Predictive Analysis",
      description: "Analyze trends and insights",
      accent: "purple",
      onClick: () => setViewMode("predictive-analysis"),
    },
    {
      icon: PenLine,
      label: "Rewrite",
      description: "Edit and improve document content",
      accent: "indigo",
      onClick: () => setViewMode("rewrite"),
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">
        {/* Page Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-2 uppercase tracking-widest">
              <Layers className="w-3.5 h-3.5" />
              <span>Workspace</span>
              <span className="text-border">/</span>
              <span className="text-foreground">{companyName ?? "Company"}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Document Management</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Overview of your document library, activity, and AI tools.
            </p>
          </div>
          <Button
            onClick={() => setViewMode("upload")}
            className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/20 gap-2 h-9"
            size="sm"
          >
            <Upload className="w-4 h-4" />
            Upload Documents
          </Button>
        </div>

        {/* Profile Completion Banner */}
        {profileIncomplete && !bannerDismissed && (
          <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-800/50">
            <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">
                Complete your company profile
              </p>
              <p className="text-xs text-purple-700 dark:text-purple-400 mt-0.5">
                Help AI better understand your documents by adding a company description.
              </p>
            </div>
            <Link
              href="/employer/onboarding"
              className="flex-shrink-0 px-4 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
            >
              Complete Setup
            </Link>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              className="flex-shrink-0 p-1 text-purple-400 hover:text-purple-600 dark:text-purple-500 dark:hover:text-purple-300 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Total Documents",
              value: stats.total,
              icon: FileText,
              color: "text-purple-600 dark:text-purple-400",
              bg: "bg-purple-50 dark:bg-purple-900/20",
              trend: stats.total > 0 ? `${stats.total} files` : "No files yet",
            },
            {
              label: "Categories",
              value: stats.categoryCount,
              icon: FolderOpen,
              color: "text-indigo-600 dark:text-indigo-400",
              bg: "bg-indigo-50 dark:bg-indigo-900/20",
              trend: stats.categoryCount > 0 ? `${stats.categoryCount} active` : "Create one",
            },
            {
              label: "Processing",
              value: stats.processing,
              icon: Clock,
              color: "text-amber-600 dark:text-amber-400",
              bg: "bg-amber-50 dark:bg-amber-900/20",
              trend: stats.processing > 0 ? "OCR in progress" : "All ready",
            },
            {
              label: "Ready",
              value: stats.processed + (documents.filter(d => d.ocrProcessed === undefined).length),
              icon: CheckCircle2,
              color: "text-emerald-600 dark:text-emerald-400",
              bg: "bg-emerald-50 dark:bg-emerald-900/20",
              trend: "Documents indexed",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3 hover:border-purple-200 dark:hover:border-purple-900/60 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {stat.label}
                </span>
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", stat.bg)}>
                  <stat.icon className={cn("w-4 h-4", stat.color)} />
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold tabular-nums">{stat.value}</div>
                <div className={cn("text-xs mt-1 font-medium", stat.color)}>{stat.trend}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Documents — takes 2 cols */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <FileSearch className="w-3.5 h-3.5" />
                Recent Documents
              </h2>
              <button
                onClick={() => setViewMode("with-ai-qa")}
                className="text-xs text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1 hover:underline"
              >
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {recentDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-4">
                    <FileText className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">No documents yet</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Upload your first document to get started
                  </p>
                  <Button
                    size="sm"
                    onClick={() => setViewMode("upload")}
                    className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload Document
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {/* Table header */}
                  <div className="grid grid-cols-12 px-4 py-2.5 bg-muted/50">
                    <div className="col-span-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Name
                    </div>
                    <div className="col-span-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Category
                    </div>
                    <div className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Type
                    </div>
                    <div className="col-span-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-right">
                      Status
                    </div>
                  </div>

                  {recentDocs.map((doc) => {
                    const displayType = getDocumentDisplayType(doc);
                    const DocIcon = DISPLAY_TYPE_ICONS[displayType];
                    return (
                      <button
                        key={doc.id}
                        onClick={() => {
                          setSelectedDoc(doc);
                          setViewMode("with-ai-qa");
                        }}
                        className="w-full grid grid-cols-12 px-4 py-3 items-center hover:bg-muted/40 transition-colors text-left group"
                      >
                        <div className="col-span-6 flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                            <DocIcon className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                          </div>
                          <span className="text-sm font-medium truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                            {doc.title}
                          </span>
                        </div>
                        <div className="col-span-3 min-w-0 pr-2">
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate max-w-full">
                            <Tag className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{doc.category}</span>
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span
                            className={cn(
                              "inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                              FILE_TYPE_COLORS[displayType]
                            )}
                          >
                            {FILE_TYPE_LABELS[displayType]}
                          </span>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          {doc.ocrProcessed === false ? (
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Processing" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-emerald-400" title="Ready" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-4">
                <Zap className="w-3.5 h-3.5" />
                Quick Actions
              </h2>
              <div className="space-y-2">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.onClick}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:border-purple-300 dark:hover:border-purple-800 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-all group text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-600 transition-colors">
                      <action.icon className="w-4 h-4 text-purple-600 dark:text-purple-400 group-hover:text-white transition-colors" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                        {action.label}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {action.description}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-purple-600 dark:group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            {/* Categories Breakdown */}
            {topCategories.length > 0 && (
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-4">
                  <FolderOpen className="w-3.5 h-3.5" />
                  Categories
                </h2>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  {topCategories.map((cat, idx) => {
                    const pct = stats.total > 0 ? (cat.documents.length / stats.total) * 100 : 0;
                    return (
                      <div
                        key={cat.name}
                        className={cn(
                          "px-4 py-3",
                          idx < topCategories.length - 1 ? "border-b border-border" : ""
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold truncate max-w-[160px]">
                            {cat.name}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono ml-2">
                            {cat.documents.length}
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-600 to-indigo-600 rounded-full transition-all duration-700"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* File Type Breakdown */}
            {stats.total > 0 && (
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 mb-4">
                  <TrendingUp className="w-3.5 h-3.5" />
                  File Types
                </h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.typeBreakdown).map(([type, count]) => (
                    <div
                      key={type}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-transparent",
                        FILE_TYPE_COLORS[type] ?? FILE_TYPE_COLORS.unknown
                      )}
                    >
                      <span>{FILE_TYPE_LABELS[type] ?? type.toUpperCase()}</span>
                      <span className="opacity-70 font-mono">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Processing Status */}
            {stats.processing > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                      {stats.processing} document{stats.processing !== 1 ? "s" : ""} processing
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      OCR and indexing in progress. Documents will be ready for AI queries shortly.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
