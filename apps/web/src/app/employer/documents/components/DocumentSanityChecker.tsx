"use client";

import React, { useState, useMemo, useCallback } from 'react';
import {
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Sparkles,
  FileText,
  Shield,
  Lightbulb,
  Globe,
  Link2,
  Search,
  Clock,
  Play,
  BookMarked,
  ListChecks,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '~/app/employer/documents/components/ui/button';
import { ScrollArea } from '~/app/employer/documents/components/ui/scroll-area';
import { cn } from "~/lib/utils";
import { getDocumentDisplayType } from '../types/document';
import type { DocumentType, PredictiveAnalysisResponse, MissingDocument, SuggestedLink, DocumentInsight, InsightCategory } from '../types';

/* ── Types ─────────────────────────────────────────────────── */

interface DocumentSanityCheckerProps {
  selectedDoc: DocumentType | null;
  predictiveAnalysis: PredictiveAnalysisResponse | null;
  predictiveLoading: boolean;
  predictiveError: string;
  onRefreshAnalysis: () => void;
  onSelectDocument: (docId: number, page: number) => void;
  setPdfPageNumber: (page: number) => void;
  currentPage?: number;
}

/* ── Helpers ───────────────────────────────────────────────── */

const ANALYSIS_TYPE_LABELS: Record<string, string> = {
  contract: 'Checking exhibits, schedules, addendums',
  financial: 'Checking reports, statements, audit docs',
  technical: 'Checking specs, manuals, deliverables',
  compliance: 'Checking regulatory filings, policies',
  educational: 'Checking syllabi, readings, resources',
  hr: 'Checking policies, forms, benefits docs',
  research: 'Checking cited papers, datasets',
  general: 'Checking all cross-references',
};

function getLinkHref(link: SuggestedLink): string {
  return link.url ?? link.link ?? '#';
}

const PRIORITY_STYLES = {
  high: {
    pill: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    border: 'border-l-red-500',
  },
  medium: {
    pill: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    border: 'border-l-amber-400',
  },
  low: {
    pill: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    border: 'border-l-blue-400',
  },
} as const;

/* ── Sub-components ────────────────────────────────────────── */

function IssueCard({
  doc,
  isPdf,
  isViewingPage,
  showPage,
  onPageClick,
  onSelectDocument,
}: {
  doc: MissingDocument;
  isPdf: boolean;
  isViewingPage: boolean;
  showPage: boolean;
  onPageClick: (page: number) => void;
  onSelectDocument: (docId: number, page: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pStyle = PRIORITY_STYLES[doc.priority] ?? PRIORITY_STYLES.low;
  const matches = doc.suggestedCompanyDocuments ?? [];

  return (
    <div
      className={cn(
        "bg-card rounded-xl border shadow-sm overflow-hidden transition-all border-l-[3px]",
        pStyle.border,
        isViewingPage
          ? "ring-2 ring-purple-500/15 border-purple-300 dark:border-purple-700 border-l-purple-500"
          : "border-border/60",
      )}
    >
      <div className="p-3.5 space-y-2.5">
        {/* Title row */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="text-[13px] font-semibold text-foreground leading-snug">
              {doc.documentName}
            </h4>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={cn("text-[9px] font-black uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md", pStyle.pill)}>
                {doc.priority}
              </span>
              {showPage && (
                <span className="text-[10px] text-muted-foreground">
                  Page {doc.page}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Reason */}
        <p className="text-xs text-muted-foreground leading-relaxed">{doc.reason}</p>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {isPdf && showPage && (
            <button
              type="button"
              onClick={() => onPageClick(doc.page)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150",
                isViewingPage
                  ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
              )}
            >
              <FileText className="w-3 h-3" />
              Go to page {doc.page}
            </button>
          )}

          {doc.resolvedIn && (
            <button
              type="button"
              onClick={() => onSelectDocument(doc.resolvedIn!.documentId, doc.resolvedIn!.page)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all duration-150"
            >
              <CheckCircle2 className="w-3 h-3" />
              Found in library
            </button>
          )}

          {matches.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-150 ml-auto"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {matches.length} match{matches.length > 1 ? 'es' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Matches drawer */}
      {expanded && matches.length > 0 && (
        <div className="border-t border-border/40 bg-muted/20 px-3.5 py-2.5 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em]">Potential Matches</span>
          {matches.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDocument(m.documentId, m.page)}
              className="w-full text-left flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all group"
            >
              <span className="text-xs font-medium text-foreground group-hover:text-purple-600 dark:group-hover:text-purple-400 truncate">
                {m.documentTitle}
              </span>
              <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded shrink-0 tabular-nums">
                {Math.round(m.similarity * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkCard({ doc }: { doc: MissingDocument }) {
  const link = doc.suggestedLinks?.[0];
  const href = link ? getLinkHref(link) : undefined;
  const displayName = doc.documentName.replace(/^External:\s*/i, '');

  let faviconDomain: string | null = null;
  if (href && href !== '#') {
    try { faviconDomain = new URL(href).hostname; } catch { /* skip */ }
  }

  return (
    <a
      href={href && href !== '#' ? href : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2.5 p-2.5 rounded-lg transition-colors group",
        href && href !== '#' ? "hover:bg-muted/40 cursor-pointer" : "cursor-default",
      )}
    >
      {faviconDomain ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`https://www.google.com/s2/favicons?sz=32&domain=${faviconDomain}`}
          alt=""
          width={16}
          height={16}
          className="w-4 h-4 rounded-sm shrink-0"
        />
      ) : (
        <div className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
          <Link2 className="w-3 h-3 text-blue-500" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 block truncate transition-colors">
          {displayName}
        </span>
        {doc.reason && (
          <span className="text-[10px] text-muted-foreground block truncate">{doc.reason}</span>
        )}
      </div>
      {href && href !== '#' && (
        <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-blue-500 shrink-0 transition-colors" />
      )}
    </a>
  );
}

/* ── Insight styling / icons ────────────────────────────────── */

const INSIGHT_CATEGORY_CONFIG: Record<InsightCategory, {
  icon: React.ElementType;
  label: string;
}> = {
  deadline:        { icon: Clock,         label: 'Deadline' },
  resource:        { icon: Play,          label: 'Resource' },
  'key-reference': { icon: BookMarked,    label: 'Key Reference' },
  'action-item':   { icon: ListChecks,    label: 'Action Item' },
  caveat:          { icon: AlertTriangle, label: 'Caveat' },
};

const INSIGHT_SEVERITY_STYLES = {
  warning: {
    card: 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30 border-l-amber-400',
    pill: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    icon: 'text-amber-500',
    quote: 'border-l-amber-300 dark:border-l-amber-700',
  },
  note: {
    card: 'bg-sky-50/50 dark:bg-sky-950/15 border-sky-200/50 dark:border-sky-800/30 border-l-sky-400',
    pill: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
    icon: 'text-sky-500',
    quote: 'border-l-sky-300 dark:border-l-sky-700',
  },
} as const;

function InsightCard({
  insight,
  isPdf,
  showPage,
  onPageClick,
}: {
  insight: DocumentInsight;
  isPdf: boolean;
  showPage: boolean;
  onPageClick: (page: number) => void;
}) {
  const catConf = INSIGHT_CATEGORY_CONFIG[insight.category] ?? INSIGHT_CATEGORY_CONFIG.caveat;
  const sevStyle = INSIGHT_SEVERITY_STYLES[insight.severity] ?? INSIGHT_SEVERITY_STYLES.note;
  const Icon = catConf.icon;

  return (
    <div className={cn(
      "rounded-xl border shadow-sm overflow-hidden border-l-[3px] p-3.5 space-y-2",
      sevStyle.card,
    )}>
      <div className="flex items-start gap-2">
        <div className={cn("mt-0.5 shrink-0", sevStyle.icon)}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-semibold text-foreground leading-snug">
            {insight.title}
          </h4>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={cn("text-[9px] font-black uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md", sevStyle.pill)}>
              {catConf.label}
            </span>
            {showPage && (
              <span className="text-[10px] text-muted-foreground">
                Page {insight.page}
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{insight.detail}</p>

      {insight.sourceQuote && (
        <div className={cn("pl-3 border-l-2 py-1", sevStyle.quote)}>
          <p className="text-[11px] italic text-muted-foreground/80 leading-relaxed">
            &ldquo;{insight.sourceQuote}&rdquo;
          </p>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
        {isPdf && showPage && (
          <button
            type="button"
            onClick={() => onPageClick(insight.page)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all duration-150"
          >
            <FileText className="w-3 h-3" />
            Go to page {insight.page}
          </button>
        )}
        {insight.url && (() => {
          let faviconHost: string | null = null;
          try { faviconHost = new URL(insight.url).hostname; } catch { /* skip */ }
          return (
            <a
              href={insight.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all duration-150"
            >
              {faviconHost ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`https://www.google.com/s2/favicons?sz=32&domain=${faviconHost}`}
                  alt=""
                  width={12}
                  height={12}
                  className="w-3 h-3 rounded-sm"
                />
              ) : (
                <ExternalLink className="w-3 h-3" />
              )}
              Open link
            </a>
          );
        })()}
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────── */

export function DocumentSanityChecker({
  selectedDoc,
  predictiveAnalysis,
  predictiveLoading,
  predictiveError,
  onRefreshAnalysis,
  onSelectDocument,
  setPdfPageNumber,
  currentPage = 1,
}: DocumentSanityCheckerProps) {

  const isPdf = useMemo(
    () => !!selectedDoc && getDocumentDisplayType(selectedDoc) === 'pdf',
    [selectedDoc],
  );

  const { issues, links } = useMemo(() => {
    if (!predictiveAnalysis) return { issues: [] as MissingDocument[], links: [] as MissingDocument[] };
    const all = predictiveAnalysis.analysis.missingDocuments;
    return {
      issues: all.filter(d => d.documentType !== 'external-resource'),
      links:  all.filter(d => d.documentType === 'external-resource'),
    };
  }, [predictiveAnalysis]);

  const showPages = useMemo(() => {
    if (issues.length === 0) return false;
    const pages = new Set(issues.map(d => d.page));
    return pages.size > 1;
  }, [issues]);

  const insights = useMemo(
    () => predictiveAnalysis?.analysis.insights ?? [],
    [predictiveAnalysis?.analysis.insights],
  );
  const recommendations = predictiveAnalysis?.analysis.recommendations ?? [];
  const resolved = predictiveAnalysis?.analysis.resolvedDocuments ?? [];
  const webRefs = predictiveAnalysis?.analysis.suggestedRelatedDocuments ?? [];
  const highCount = issues.filter(d => d.priority === 'high').length;
  const warningCount = insights.filter(i => i.severity === 'warning').length;
  const resourceCount = insights.filter(i => i.category === 'resource').length;
  const actionCount = insights.filter(i => i.category === 'action-item').length;
  const caveatCount = insights.filter(i => i.category === 'caveat').length;

  const showInsightPages = useMemo(() => {
    if (insights.length === 0) return false;
    const pages = new Set(insights.map(i => i.page));
    return pages.size > 1;
  }, [insights]);

  const handlePageClick = useCallback((page: number) => setPdfPageNumber(page), [setPdfPageNumber]);

  /* ── Empty ── */
  if (!selectedDoc) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-background border-l border-border">
        <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
          <Search className="w-7 h-7 text-muted-foreground/30" />
        </div>
        <h4 className="text-sm font-bold text-foreground mb-1">No Document Selected</h4>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-[200px]">
          Select a document from the sidebar to run analysis.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-background flex flex-col h-full border-l border-border">

      {/* ── Header (matches SimpleQueryPanel) ── */}
      <div className="px-5 py-3.5 border-b border-border flex items-center gap-3 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/20">
          <Shield className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-sm text-foreground leading-none">Document Analysis</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {selectedDoc.title}
          </p>
          {predictiveAnalysis?.analysisType && (
            <p className="text-[9px] text-purple-500 dark:text-purple-400 mt-0.5 truncate font-medium">
              {ANALYSIS_TYPE_LABELS[predictiveAnalysis.analysisType] ?? predictiveAnalysis.analysisType}
            </p>
          )}
        </div>
        <Button
          onClick={onRefreshAnalysis}
          disabled={predictiveLoading}
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 rounded-md transition-all flex-shrink-0",
            predictiveLoading
              ? "text-muted-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", predictiveLoading && "animate-spin")} />
        </Button>
      </div>

      {/* ── Content ── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-5">

          {/* Loading */}
          {predictiveLoading && !predictiveAnalysis && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="relative">
                <div className="w-14 h-14 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-purple-400/60 animate-pulse" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-[68px] h-[68px] border-2 border-purple-200 dark:border-purple-800 border-t-purple-600 dark:border-t-purple-400 rounded-full animate-spin" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">Scanning document&hellip;</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Checking references and completeness</p>
              </div>
            </div>
          )}

          {/* Error */}
          {predictiveError && (
            <div className="p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 rounded-xl flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">Analysis failed</p>
                <p className="text-[11px] text-red-600/80 dark:text-red-500/80 leading-relaxed mt-0.5">{predictiveError}</p>
                <button
                  type="button"
                  onClick={onRefreshAnalysis}
                  className="text-[11px] font-semibold text-red-700 dark:text-red-400 underline underline-offset-2 decoration-red-300 dark:decoration-red-700 hover:decoration-red-500 mt-1.5 transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Results */}
          {predictiveAnalysis && (
            <div className="space-y-5 animate-in fade-in zoom-in-95 duration-300">

              {/* ── Overview card ── */}
              <div className="bg-card p-3.5 rounded-xl border border-border shadow-sm">
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className={cn(
                    "w-5 h-5 rounded-md flex items-center justify-center",
                    issues.length > 0
                      ? "bg-red-100 dark:bg-red-900/30"
                      : "bg-emerald-100 dark:bg-emerald-900/40"
                  )}>
                    {issues.length > 0
                      ? <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-400" />
                      : <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    }
                  </div>
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                    Overview
                  </span>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {issues.length > 0
                    ? `${issues.length} missing reference${issues.length > 1 ? 's' : ''} found`
                    : 'No missing references'
                  }
                </p>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                  {highCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      {highCount} high priority
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {warningCount} warning{warningCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {actionCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      {actionCount} action item{actionCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {resourceCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                      {resourceCount} resource{resourceCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {caveatCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                      {caveatCount} caveat{caveatCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {links.length > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      {links.length} external link{links.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* ── Notes & Warnings ── */}
              {insights.length > 0 && (
                <div className="space-y-2.5">
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5">
                    Notes &amp; Warnings
                  </span>
                  {insights.map((insight, idx) => (
                    <InsightCard
                      key={idx}
                      insight={insight}
                      isPdf={isPdf}
                      showPage={showInsightPages}
                      onPageClick={handlePageClick}
                    />
                  ))}
                </div>
              )}

              {/* ── Missing References ── */}
              {issues.length > 0 && (
                <div className="space-y-2.5">
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5">
                    Missing References
                  </span>
                  {issues.map((doc, idx) => (
                    <IssueCard
                      key={idx}
                      doc={doc}
                      isPdf={isPdf}
                      showPage={showPages}
                      isViewingPage={isPdf && showPages && currentPage === doc.page}
                      onPageClick={handlePageClick}
                      onSelectDocument={onSelectDocument}
                    />
                  ))}
                </div>
              )}

              {/* ── Found in Library ── */}
              {resolved.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5">
                    Found in Library
                  </span>
                  {resolved.map((doc, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onSelectDocument(doc.resolvedDocumentId, doc.resolvedPage)}
                      className="w-full text-left bg-card p-3 rounded-xl border border-border/60 shadow-sm hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 hover:border-emerald-200 dark:hover:border-emerald-800/40 transition-all group"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-xs font-semibold text-foreground group-hover:text-emerald-700 dark:group-hover:text-emerald-400 truncate">
                          {doc.documentName}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 pl-[22px]">
                        Matched to &quot;{doc.resolvedDocumentTitle ?? `Document #${doc.resolvedDocumentId}`}&quot;
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* ── External Links ── */}
              {links.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5 mb-1 block">
                    External Links
                  </span>
                  <div className="bg-card rounded-xl border border-border/60 shadow-sm divide-y divide-border/40 overflow-hidden">
                    {links.map((doc, idx) => (
                      <LinkCard key={idx} doc={doc} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Suggestions ── */}
              {recommendations.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5">
                    Suggestions
                  </span>
                  {recommendations.map((rec, idx) => (
                    <div
                      key={idx}
                      className="flex gap-2.5 p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 rounded-xl"
                    >
                      <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">{rec}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Web References ── */}
              {webRefs.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] px-0.5 mb-1 block">
                    Related Resources
                  </span>
                  <div className="bg-card rounded-xl border border-border/60 shadow-sm divide-y divide-border/40 overflow-hidden">
                    {webRefs.map((ref, idx) => (
                      <a
                        key={idx}
                        href={getLinkHref(ref)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2.5 p-3 hover:bg-muted/40 transition-colors group"
                      >
                        <div className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                          <Globe className="w-3 h-3 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 block truncate transition-colors">
                            {ref.title}
                          </span>
                          <span className="text-[10px] text-muted-foreground line-clamp-1">{ref.snippet}</span>
                        </div>
                        <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-blue-500 mt-0.5 shrink-0 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Disclaimer ── */}
              <div className="p-3 bg-muted/40 border border-border/40 rounded-xl">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  <span className="font-semibold">Disclaimer:</span> This analysis is AI-generated and may not capture all document references. For legal, financial, or compliance documents, always verify critical findings with a qualified professional.
                </p>
              </div>

              {/* ── All clear ── */}
              {issues.length === 0 && links.length === 0 && insights.length === 0 && recommendations.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="relative mb-4">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                      <CheckCircle2 className="w-7 h-7 text-emerald-400/60" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-emerald-500 flex items-center justify-center shadow-sm">
                      <Sparkles className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <h4 className="text-sm font-bold text-foreground mb-1">Looking good</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-[200px]">
                    No missing references or issues detected in this document.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
