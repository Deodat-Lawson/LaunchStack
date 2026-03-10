"use client";

import React from 'react';
import { 
  CheckCircle, 
  AlertTriangle, 
  FileText, 
  Sparkles, 
  BarChart3,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ArrowRight,
  Globe
} from 'lucide-react';
import { Button } from '~/app/employer/documents/components/ui/button';
import { Card } from '~/app/employer/documents/components/ui/card';
import { Badge } from '~/app/employer/documents/components/ui/badge';
import { cn } from "~/lib/utils";
import type { DocumentType, PredictiveAnalysisResponse } from '../types';

interface DocumentSanityCheckerProps {
  selectedDoc: DocumentType | null;
  predictiveAnalysis: PredictiveAnalysisResponse | null;
  predictiveLoading: boolean;
  predictiveError: string;
  onRefreshAnalysis: () => void;
  onSelectDocument: (docId: number, page: number) => void;
  setPdfPageNumber: (page: number) => void;
}

export function DocumentSanityChecker({ 
  selectedDoc,
  predictiveAnalysis,
  predictiveLoading,
  predictiveError,
  onRefreshAnalysis,
  onSelectDocument,
  setPdfPageNumber
}: DocumentSanityCheckerProps) {
  if (!selectedDoc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-muted/30 h-full p-8 text-center">
        <div className="w-20 h-20 bg-muted rounded-3xl flex items-center justify-center mb-6">
          <BarChart3 className="w-10 h-10 text-muted-foreground/30" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">No Document Selected</h3>
        <p className="text-muted-foreground max-w-xs">
          Select a document from the sidebar to perform a predictive sanity check.
        </p>
      </div>
    );
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/30';
      case 'medium': return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-900/30';
      case 'low': return 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/30';
      default: return 'text-muted-foreground bg-muted/20 border-border';
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="bg-background border-b border-border px-8 py-6 flex-shrink-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-600 rounded-2xl shadow-lg shadow-purple-500/20">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground leading-tight">Predictive Document Analysis</h1>
              <p className="text-sm text-muted-foreground font-medium flex items-center gap-2 mt-1">
                Analyzing: <span className="text-purple-600 dark:text-purple-400 font-bold">{selectedDoc.title}</span>
              </p>
            </div>
          </div>
          
          <Button
            onClick={onRefreshAnalysis}
            disabled={predictiveLoading}
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 px-6 shadow-lg shadow-purple-500/20 gap-2 font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {predictiveLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {predictiveLoading ? "Analyzing..." : "Refresh Analysis"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-6xl mx-auto p-8 space-y-8">
          {predictiveLoading && !predictiveAnalysis && (
            <div className="flex flex-col items-center justify-center py-20 animate-in fade-in duration-500">
              <div className="relative mb-8">
                <div className="w-20 h-20 border-4 border-purple-100 dark:border-purple-900/30 rounded-full border-t-purple-600 dark:border-t-purple-500 animate-spin" />
                <Sparkles className="w-8 h-8 text-purple-600 dark:text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">Deep Document Scan In Progress</h3>
              <p className="text-muted-foreground max-w-sm text-center font-medium leading-relaxed">
                Our AI is scanning every page, cross-referencing company data, and identifying potential gaps or risks.
              </p>
            </div>
          )}

          {predictiveError && (
            <Card className="p-6 border-destructive/20 bg-destructive/10 animate-in slide-in-from-top-4 duration-500">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-destructive/20 rounded-lg">
                  <AlertCircle className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-destructive">Analysis Failed</h3>
                  <p className="text-destructive text-sm mt-1 font-medium">{predictiveError}</p>
                  <Button variant="outline" size="sm" onClick={onRefreshAnalysis} className="mt-4 border-destructive/30 text-destructive hover:bg-destructive/10">
                    Try Again
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {predictiveAnalysis && (
            <div className="space-y-8 animate-in fade-in duration-700">
              {/* Summary Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-5 border-none shadow-sm bg-card flex flex-col justify-between group hover:shadow-md transition-all border-l-4 border-l-blue-500">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Missing</span>
                    <AlertCircle className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="text-3xl font-black text-foreground">
                    {predictiveAnalysis.summary.totalMissingDocuments}
                  </div>
                  <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider mt-1">References Found</div>
                </Card>

                <Card className="p-5 border-none shadow-sm bg-card flex flex-col justify-between group hover:shadow-md transition-all border-l-4 border-l-red-500">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Critical</span>
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="text-3xl font-black text-foreground">
                    {predictiveAnalysis.summary.highPriorityItems}
                  </div>
                  <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider mt-1">High Priority Gaps</div>
                </Card>

                <Card className="p-5 border-none shadow-sm bg-card flex flex-col justify-between group hover:shadow-md transition-all border-l-4 border-l-amber-500">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Insights</span>
                    <Sparkles className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="text-3xl font-black text-foreground">
                    {predictiveAnalysis.summary.totalRecommendations}
                  </div>
                  <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider mt-1">AI Suggestions</div>
                </Card>

                <Card className="p-5 border-none shadow-sm bg-card flex flex-col justify-between group hover:shadow-md transition-all border-l-4 border-l-green-500">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Resolved</span>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                  <div className="text-3xl font-black text-foreground">
                    {predictiveAnalysis.analysis.resolvedDocuments?.length ?? 0}
                  </div>
                  <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider mt-1">Matching Docs</div>
                </Card>
              </div>

              {/* Main Sections */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Missing Documents List */}
                <div className="lg:col-span-8 space-y-6">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                      <h2 className="text-lg font-bold text-foreground uppercase tracking-tight">Missing References</h2>
                    </div>
                    <Badge variant="outline" className="rounded-full px-3 py-1 border-blue-200 dark:border-blue-900/30 text-blue-600 dark:text-blue-400 font-bold">
                      {predictiveAnalysis.analysis.missingDocuments.length} Total
                    </Badge>
                  </div>

                  <div className="space-y-4">
                    {predictiveAnalysis.analysis.missingDocuments.map((doc, idx) => (
                      <Card key={idx} className="p-6 border-none shadow-sm hover:shadow-md transition-all group overflow-hidden relative bg-card">
                        <div className={cn(
                          "absolute top-0 left-0 w-1.5 h-full",
                          doc.priority === 'high' ? "bg-red-500" : doc.priority === 'medium' ? "bg-amber-500" : "bg-blue-500"
                        )} />
                        
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-3">
                              <h3 className="text-lg font-bold text-foreground tracking-tight">{doc.documentName}</h3>
                              <Badge className={cn("uppercase text-[10px] font-black tracking-widest", getPriorityColor(doc.priority))}>
                                {doc.priority}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground font-medium leading-relaxed">{doc.reason}</p>
                            
                            <div className="flex flex-wrap gap-2 mt-4">
                              <Button 
                                variant="secondary" 
                                size="sm" 
                                onClick={() => setPdfPageNumber(doc.page)}
                                className="h-8 text-[10px] font-bold uppercase tracking-wider gap-2 bg-muted hover:bg-muted/80"
                              >
                                <FileText className="w-3 h-3 text-purple-600" />
                                Referenced on Page {doc.page}
                              </Button>
                              
                              {doc.resolvedIn && (
                                <Button 
                                  variant="secondary" 
                                  size="sm" 
                                  onClick={() => onSelectDocument(doc.resolvedIn!.documentId, doc.resolvedIn!.page)}
                                  className="h-8 text-[10px] font-bold uppercase tracking-wider gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30"
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  Found in library
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>

                        {doc.suggestedCompanyDocuments && doc.suggestedCompanyDocuments.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-border space-y-3">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] px-1">Potential Matches</span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {doc.suggestedCompanyDocuments.map((match, mIdx) => (
                                <button
                                  key={mIdx}
                                  onClick={() => onSelectDocument(match.documentId, match.page)}
                                  className="text-left p-3 rounded-xl bg-muted/50 hover:bg-purple-50 dark:hover:bg-purple-900/10 border border-transparent hover:border-purple-200 dark:hover:border-purple-900/30 transition-all group/item"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-foreground truncate">{match.documentTitle}</span>
                                    <span className="text-[10px] font-black text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded uppercase">{Math.round(match.similarity * 100)}% Match</span>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground line-clamp-1 italic">&quot;{match.snippet}&quot;</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Sidebar Column: Recommendations & Sources */}
                <div className="lg:col-span-4 space-y-8">
                  {/* AI Recommendations */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 px-2">
                      <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">AI Suggestions</h2>
                    </div>
                    
                    <div className="space-y-3">
                      {predictiveAnalysis.analysis.recommendations.map((rec, idx) => (
                        <Card key={idx} className="p-4 border-none shadow-sm bg-amber-50/50 dark:bg-amber-900/10 relative overflow-hidden group">
                          <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Sparkles className="w-8 h-8 text-amber-600" />
                          </div>
                          <p className="text-sm text-amber-900 dark:text-amber-200 font-medium leading-relaxed relative z-10">
                            {rec}
                          </p>
                        </Card>
                      ))}
                    </div>
                  </div>

                  {/* Web Knowledge Base */}
                  {predictiveAnalysis.analysis.suggestedRelatedDocuments && predictiveAnalysis.analysis.suggestedRelatedDocuments.length > 0 && (
                    <div className="space-y-4 pt-4 border-t border-border">
                      <div className="flex items-center gap-3 px-2">
                        <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                          <Globe className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">Global References</h2>
                      </div>
                      
                      <div className="space-y-3">
                        {predictiveAnalysis.analysis.suggestedRelatedDocuments.map((link, idx) => (
                          <a
                            key={idx}
                            href={link.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <Card className="p-4 border-none shadow-sm bg-card hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all border-l-2 border-l-transparent hover:border-l-blue-500 group">
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400 truncate flex-1">{link.title}</h4>
                                <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-blue-500 transition-colors" />
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                                {link.snippet}
                              </p>
                            </Card>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


