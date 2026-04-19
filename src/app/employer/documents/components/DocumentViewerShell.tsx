"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import LoadingPage from "~/app/_components/loading";
import { Sidebar } from "./Sidebar";
import { DocumentViewer } from "./DocumentViewer";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "~/app/employer/documents/components/ui/resizable";
import { cn } from "~/lib/utils";
import type { ViewMode, DocumentType, CategoryGroup, errorType, PredictiveAnalysisResponse } from "../types";
import { getDocumentDisplayType, type DocumentDisplayType } from "../types/document";
import { useAIChat } from "../hooks/useAIChat";
import { useAIChatbot } from "../hooks/useAIChatbot";
import { Button } from "~/app/employer/documents/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/app/employer/documents/components/ui/alert-dialog";
import { Toaster } from "~/app/employer/documents/components/ui/sonner";
import { toast } from "sonner";
import type { ImperativePanelHandle } from "react-resizable-panels";

import { RESPONSE_STYLES, type ResponseStyleId } from "~/lib/ai/styles";
import type { AIModelType, LLMProvider } from "~/app/api/agents/documentQ&A/services/types";
import { ProviderModelMap, ProviderDefaultModels } from "~/app/api/agents/documentQ&A/services/types";

type AIModelAvailability = Record<AIModelType, boolean>;
type ProviderAvailability = Record<LLMProvider, boolean>;

const ChatPanel = dynamic(
  () => import("./ChatPanel").then((module) => module.ChatPanel),
  { loading: () => <LoadingPage /> }
);
const SimpleQueryPanel = dynamic(
  () => import("./SimpleQueryPanel").then((module) => module.SimpleQueryPanel),
  { loading: () => <LoadingPage /> }
);
const DocumentSanityChecker = dynamic(
  () =>
    import("./DocumentSanityChecker").then(
      (module) => module.DocumentSanityChecker
    ),
  { loading: () => <LoadingPage /> }
);
const DocumentGenerator = dynamic(
  () => import("./DocumentGenerator").then((module) => module.DocumentGenerator),
  { loading: () => <LoadingPage /> }
);
const RewriteDiffView = dynamic(
  () => import("./RewriteDiffView").then((module) => module.RewriteDiffView),
  { loading: () => <LoadingPage /> }
);
const UploadView = dynamic(
  () => import("./UploadView").then((module) => module.UploadView),
  { loading: () => <LoadingPage /> }
);
const EmployerDashboard = dynamic(
  () => import("./EmployerDashboard").then((module) => module.EmployerDashboard),
  { loading: () => <LoadingPage /> }
);
const CompanyAnalyticsPanel = dynamic(
  () => import("./CompanyAnalyticsPanel").then((module) => module.CompanyAnalyticsPanel),
  { loading: () => <LoadingPage /> }
);
const EmployeeManagementPanel = dynamic(
  () => import("./EmployeeManagementPanel").then((module) => module.EmployeeManagementPanel),
  { loading: () => <LoadingPage /> }
);
const EmployerSettingsPanel = dynamic(
  () => import("./EmployerSettingsPanel").then((module) => module.EmployerSettingsPanel),
  { loading: () => <LoadingPage /> }
);
const CompanyMetadataPanel = dynamic(
  () => import("./CompanyMetadataPanel").then((module) => module.CompanyMetadataPanel),
  { loading: () => <LoadingPage /> }
);
const MarketingPipelinePanel = dynamic(
  () => import("./MarketingPipelinePanel").then((module) => module.MarketingPipelinePanel),
  { loading: () => <LoadingPage /> }
);
const RepoExplainerPanel = dynamic(
  () => import("./RepoExplainerPanel").then((module) => module.RepoExplainerPanel),
  { loading: () => <LoadingPage /> }
);

const STYLE_OPTIONS = Object.entries(RESPONSE_STYLES).reduce((acc, [key, config]) => {
  acc[key as ResponseStyleId] = config.label;
  return acc;
}, {} as Record<ResponseStyleId, string>);

export interface DocumentViewerShellProps {
  /** 'employer' or 'employee' — controls auth, features, and UI gating */
  userRole: 'employer' | 'employee';
}

const NotesPanel = dynamic(
  () => import("~/components/notes/NotesPanel").then((module) => module.NotesPanel),
  { loading: () => <LoadingPage /> }
);

const VALID_VIEW_MODES = new Set<string>([
  "document-only", "with-ai-qa", "with-ai-qa-history", "predictive-analysis",
  "generator", "rewrite", "upload", "dashboard", "analytics",
  "employees", "settings", "metadata", "marketing-pipeline", "notes",
  "repo-explainer",
]);

export function DocumentViewerShell({ userRole }: DocumentViewerShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn, userId } = useAuth();
  
  // Data States
  const [documents, setDocuments] = useState<DocumentType[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentType | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [isRoleLoading, setIsRoleLoading] = useState(true);
  const [isResolvingCompany, setIsResolvingCompany] = useState(false);
  
  // UI States
  const [searchTerm, setSearchTerm] = useState("");
  const [fileTypeFilter, setFileTypeFilter] = useState<DocumentDisplayType | "all">("all");
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const param = searchParams.get("view");
    if (param && VALID_VIEW_MODES.has(param)) return param as ViewMode;
    return userRole === 'employer' ? "dashboard" : "with-ai-qa";
  });
  const [qaSubMode, setQaSubMode] = useState<"simple" | "chat">("simple");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);

  // Version history: which document's history modal is open.
  const [versionHistoryTarget, setVersionHistoryTarget] = useState<
    { id: number; title: string } | null
  >(null);

  // Inline "viewing an older version" preview state. When set, the viewer
  // renders the old version's content via the version-scoped content endpoint
  // and a banner offers "Return to current" / "Revert" actions. Cleared when
  // the user picks another document, closes the preview, or reverts.
  const [previewVersion, setPreviewVersion] = useState<
    { documentId: number; versionId: number; versionNumber: number } | null
  >(null);
  
  // AI States (Simple Query)
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiError, setAiError] = useState("");
  const [referencePages, setReferencePages] = useState<number[]>([]);
  const [aiStyle, setAiStyle] = useState<string>("concise");
  const [searchScope, setSearchScope] = useState<"document" | "company" | "archive">("document");
  const [aiAnswerModel, setAiAnswerModel] = useState<AIModelType | undefined>(undefined);
  const { sendQuery: sendAIChatQuery, loading: isAiLoading } = useAIChat();
  
  // AI States (Chat)
  const { createChat, getChat } = useAIChatbot();
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [aiPersona, setAiPersona] = useState<string>('general');
  const [provider, setProvider] = useState<LLMProvider>("openai");
  const [aiModel, setAiModel] = useState<AIModelType>(ProviderDefaultModels.openai);
  const [modelAvailability, setModelAvailability] = useState<Partial<AIModelAvailability>>({});
  const [providerAvailability, setProviderAvailability] = useState<Partial<ProviderAvailability>>({});

  useEffect(() => {
    const allowedModels = ProviderModelMap[provider];
    if (allowedModels && !allowedModels.includes(aiModel)) {
      setAiModel(ProviderDefaultModels[provider]);
    }
  }, [provider, aiModel]);

  // Handle chat selection and auto-document binding
  useEffect(() => {
    if (!currentChatId || !documents.length) return;

    const syncChatDocument = async () => {
      const data = await getChat(currentChatId);
      if (data?.success && data.documents?.[0]) {
        const boundDocId = Number(data.documents[0].id);
        const doc = documents.find(d => d.id === boundDocId);
        if (doc && selectedDoc?.id !== doc.id) {
          setSelectedDoc(doc);
          setPdfPageNumber(1);
        }
      }
    };

    void syncChatDocument();
  }, [currentChatId, documents, getChat, selectedDoc?.id]);
  
  // Predictive Analysis States
  const [predictiveAnalysis, setPredictiveAnalysis] = useState<PredictiveAnalysisResponse | null>(null);
  const [isPredictiveLoading, setIsPredictiveLoading] = useState(false);
  const [predictiveError, setPredictiveError] = useState("");
  
  const [pdfPageNumber, setPdfPageNumber] = useState<number>(1);
  
  // Repo diagram state
  const [diagramRepoUrl, setDiagramRepoUrl] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteConfirmDocId, setDeleteConfirmDocId] = useState<number | null>(null);

  const previewPanelRef = useRef<ImperativePanelHandle>(null);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);

  // Fetching Logic
  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch("/api/fetchDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) throw new Error("Failed to fetch documents");

      const data = (await response.json()) as DocumentType[];
      setDocuments(data);
    } catch (error) {
      console.error("Error fetching documents:", error);
    }
  }, [userId]);

  const ensureCompanyContext = useCallback(async (): Promise<number | null> => {
    if (companyId) return companyId;
    if (isResolvingCompany) return null;
    setIsResolvingCompany(true);
    try {
      const response = await fetch("/api/fetchUserInfo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { companyId?: number | string };
      const resolvedCompanyId = data?.companyId ? Number(data.companyId) : null;
      if (resolvedCompanyId) {
        setCompanyId(resolvedCompanyId);
      }
      return resolvedCompanyId;
    } catch (error) {
      console.error("Error resolving company context:", error);
      return null;
    } finally {
      setIsResolvingCompany(false);
    }
  }, [companyId, isResolvingCompany, userId]);

  // Role-based authentication
  useEffect(() => {
    if (!isLoaded) return;
    
    if (!isSignedIn || !userId) {
      console.error("[Auth Debug] isLoaded:", isLoaded, "isSignedIn:", isSignedIn, "userId:", userId);
      router.push("/");
      return;
    }

    if (userRole === 'employer') {
      // Role/status gating is already enforced in middleware for /employer routes.
      setIsRoleLoading(false);
    } else {
      // Employee auth: check via employeeAuth endpoint
      const checkEmployeeRole = async () => {
        try {
          const response = await fetch("/api/employeeAuth", {
            method: "GET",
          });

          if (response.status === 300) {
            router.push("/employee/pending-approval");
            return;
          } else if (!response.ok) {
            window.alert("Authentication failed! You are not an employee.");
            router.push("/");
            return;
          }
        } catch (error) {
          console.error("Error checking employee role:", error);
          window.alert("Authentication failed! You are not an employee.");
          router.push("/");
        } finally {
          setIsRoleLoading(false);
        }
      };

      void checkEmployeeRole();
    }
  }, [isLoaded, isSignedIn, userId, router, userRole]);

  // Handle docId from URL
  useEffect(() => {
      if (!isRoleLoading && documents.length > 0) {
          const params = new URLSearchParams(window.location.search);
          const docIdParam = params.get('docId');
          
          if (docIdParam) {
              const docId = parseInt(docIdParam);
              const targetDoc = documents.find(d => d.id === docId);
              
              if (targetDoc) {
                  setSelectedDoc(targetDoc);
                  const newUrl = window.location.pathname;
                  window.history.replaceState({}, '', newUrl);
              }
          }
      }
  }, [isRoleLoading, documents]);

  useEffect(() => {
    if (isRoleLoading || userRole !== "employer") return;

    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    if (requestedView === "rewrite") {
      setViewMode("rewrite");
      params.delete("view");
      const next = params.toString();
      const newUrl = next ? `${window.location.pathname}?${next}` : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, [isRoleLoading, userRole]);

  useEffect(() => {
    if (!userId || isRoleLoading) return;
    void fetchDocuments();
  }, [userId, isRoleLoading, fetchDocuments]);

  // Poll for document updates when the selected doc is still processing
  useEffect(() => {
    if (!selectedDoc || selectedDoc.ocrProcessed !== false) return;
    const interval = setInterval(() => void fetchDocuments(), 15_000);
    return () => clearInterval(interval);
  }, [selectedDoc, fetchDocuments]);

  // Sync selectedDoc when the documents list refreshes.
  //
  // This runs whenever fetchDocuments() repopulates the `documents` array,
  // which happens on initial load, after deletes, after OCR polling, and
  // crucially after a new version is uploaded (the VersionHistoryPanel
  // calls onVersionsChanged -> fetchDocuments to refresh the list).
  //
  // The original effect only handled the "ocrProcessed: false -> true"
  // transition — that missed the version-upload case entirely, because
  // on version upload the selected document's ocrProcessed is already true
  // (it was set to true the first time the document was processed). So the
  // effect would early-return and `selectedDoc.url` would stay pinned to
  // whichever version was current when the user first clicked the sidebar
  // entry, ignoring any subsequent version swaps. The visible symptom was
  // the main viewer continuing to render the old blob in an iframe even
  // though the DB had been updated with the new one.
  //
  // The fix: compare the relevant fields explicitly and only call
  // setSelectedDoc when something meaningful actually changed. We intentionally
  // do NOT unconditionally setSelectedDoc(updated), because every call to
  // fetchDocuments produces new object references even for unchanged rows,
  // which would cause an extra render on every refresh with no value change.
  useEffect(() => {
    if (!selectedDoc) return;
    const updated = documents.find((d) => d.id === selectedDoc.id);
    if (!updated) return;

    const hasChanged =
      updated.url !== selectedDoc.url ||
      updated.mimeType !== selectedDoc.mimeType ||
      updated.ocrProcessed !== selectedDoc.ocrProcessed ||
      updated.title !== selectedDoc.title ||
      updated.category !== selectedDoc.category;

    if (hasChanged) {
      setSelectedDoc(updated);
    }
  }, [documents, selectedDoc]);

  useEffect(() => {
    const fetchModelAvailability = async () => {
      try {
        const response = await fetch("/api/config/ai-models");
        if (!response.ok) return;
        const data = (await response.json()) as {
          providers?: Partial<Record<LLMProvider, boolean>>;
          models?: Partial<Record<AIModelType, boolean>>;
        };
        if (data.models) {
          setModelAvailability(data.models);
        }
        if (data.providers) {
          setProviderAvailability(data.providers);
        }
      } catch (error) {
        console.error("Error fetching AI model availability:", error);
      }
    };

    void fetchModelAvailability();
  }, []);

  // Actions
  const toggleCategory = (categoryName: string) => {
    setOpenCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) newSet.delete(categoryName);
      else newSet.add(categoryName);
      return newSet;
    });
  };

  const handleSelectDoc = (doc: DocumentType | null) => {
    setSelectedDoc(doc);
    setPdfPageNumber(1);
    setAiAnswer("");
    setAiAnswerModel(undefined);
    setReferencePages([]);
    setPredictiveAnalysis(null);
    // Switching to a different document cancels any active version preview.
    // Without this, the viewer would keep showing the previous document's old
    // version while the sidebar highlights the new document.
    setPreviewVersion(null);
  };

  /**
   * Revert the previewed version to current, via the revert API. On success,
   * the viewer switches back to showing the current version (which is now
   * the formerly-previewed one) and we refresh the document list so any
   * derived fields are up to date.
   */
  const handleRevertPreview = useCallback(async () => {
    if (!previewVersion) return;
    try {
      const res = await fetch(
        `/api/documents/${previewVersion.documentId}/versions/${previewVersion.versionId}/revert`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Reverted to version ${previewVersion.versionNumber}`);
      setPreviewVersion(null);
      await fetchDocuments();
    } catch (err) {
      toast.error(
        `Failed to revert: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, [previewVersion, fetchDocuments]);

  /**
   * Derived viewer document. When the user has opened a past version from the
   * version-history panel, the viewer renders that version's content by
   * swapping `selectedDoc.url` for a version-scoped content URL. The rest of
   * the document metadata (title, mimeType, etc.) stays the same so display
   * type detection still works.
   *
   * Cache-busting via the versionId in the query string ensures iframes don't
   * accidentally keep serving a previous version's content.
   */
  const displayDoc: DocumentType | null =
    previewVersion && selectedDoc && previewVersion.documentId === selectedDoc.id
      ? {
          ...selectedDoc,
          url: `/api/documents/${previewVersion.documentId}/versions/${previewVersion.versionId}/content`,
        }
      : selectedDoc;

  /**
   * Callback passed into every non-minimal `DocumentViewer` so it can render
   * a visible "Versions" button in its header. Only wired for employers —
   * for employees we pass undefined and the button won't render.
   *
   * Uses `selectedDoc` (not `displayDoc`) so the modal always opens for the
   * canonical document, not the preview variant. They share the same id and
   * title so the difference is cosmetic, but this avoids any future confusion
   * if `displayDoc` ever diverges from `selectedDoc` in other fields.
   */
  const openVersionHistoryForSelected =
    userRole === "employer" && selectedDoc
      ? () =>
          setVersionHistoryTarget({
            id: selectedDoc.id,
            title: selectedDoc.title,
          })
      : undefined;

  const handleGenerateDiagram = useCallback((archiveName: string) => {
    // Find a doc from this archive whose title contains owner/repo (set by the upload API)
    const archiveDoc = documents.find(d =>
      d.sourceArchiveName === archiveName && d.title.includes('/')
    );
    const repoSlug = archiveName.replace(/\.zip$/, '');
    const repoUrl = archiveDoc?.title.includes('/')
      ? `https://github.com/${archiveDoc.title}`
      : `https://github.com/${repoSlug}`;
    setDiagramRepoUrl(repoUrl);
    setViewMode("repo-explainer");
  }, [documents]);

  const requestDeleteDocument = (docId: number) => {
    setDeleteConfirmDocId(docId);
  };

  const confirmDeleteDocument = async () => {
    const docId = deleteConfirmDocId;
    setDeleteConfirmDocId(null);
    if (!docId) return;

    try {
      const response = await fetch('/api/deleteDocument', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: docId.toString() }),
      });

      const result = (await response.json()) as errorType;

      if (!response.ok) throw new Error(result.error ?? 'Failed to delete document');

      setDocuments(prev => prev.filter(doc => doc.id !== docId));
      if (selectedDoc?.id === docId) handleSelectDoc(null);
      toast.success(result.message ?? 'Document deleted successfully');
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error(`Failed to delete document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const fetchPredictiveAnalysis = useCallback(async (documentId: number, forceRefresh = false) => {
    setPredictiveError("");
    setPredictiveAnalysis(null);
    setIsPredictiveLoading(true);

    try {
      const response = await fetch("/api/agents/predictive-document-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          analysisType: "general",
          includeRelatedDocs: true,
          forceRefresh
        }),
      });

      if (!response.ok) throw new Error("Failed to fetch predictive analysis");

      const data = (await response.json()) as PredictiveAnalysisResponse;
      setPredictiveAnalysis(data);
    } catch (error) {
      console.error("Error fetching predictive analysis:", error);
      setPredictiveError("Failed to perform predictive analysis. Please try again.");
    } finally {
      setIsPredictiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode !== "predictive-analysis" || !selectedDoc?.id) return;
    void fetchPredictiveAnalysis(selectedDoc.id, false);
  }, [viewMode, selectedDoc, fetchPredictiveAnalysis]);

  // Sync viewMode when ?view= search param changes after mount
  useEffect(() => {
    const param = searchParams.get("view");
    if (param && VALID_VIEW_MODES.has(param) && param !== viewMode) {
      setViewMode(param as ViewMode);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh document list when leaving the upload tab
  const prevViewModeRef = useRef<typeof viewMode | null>(null);
  useEffect(() => {
    if (prevViewModeRef.current === "upload" && viewMode !== "upload") {
      void fetchDocuments();
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode, fetchDocuments]);

  const handleAiSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuestion.trim()) return;
    
    if (searchScope === "document" && !selectedDoc) return;
    let resolvedCompanyId = companyId;
    if ((searchScope === "company" || searchScope === "archive") && !resolvedCompanyId) {
      resolvedCompanyId = await ensureCompanyContext();
      if (!resolvedCompanyId) {
        setAiError("Company information not available.");
        return;
      }
    }

    setAiError("");
    setAiAnswer("");
    setAiAnswerModel(undefined);
    setReferencePages([]);

    const currentQuestion = aiQuestion;
    const modelUsedForQuery = aiModel; // Capture the model at query time
    const providerUsedForQuery = provider;
    setAiQuestion("");

    try {
      const data = await sendAIChatQuery({
        question: currentQuestion,
        searchScope,
        style: aiStyle as ResponseStyleId,
        aiModel: modelUsedForQuery,
        provider: providerUsedForQuery,
        documentId: searchScope === "document" && selectedDoc ? selectedDoc.id : undefined,
        companyId: (searchScope === "company" || searchScope === "archive") ? resolvedCompanyId ?? undefined : undefined,
        archiveName: searchScope === "archive" && selectedDoc?.sourceArchiveName ? selectedDoc.sourceArchiveName : undefined,
      });

      if (!data) throw new Error("Failed to get AI response");

      setAiAnswer(data.summarizedAnswer ?? "");
      setAiAnswerModel((data.aiModel as AIModelType | undefined) ?? modelUsedForQuery);
      if (Array.isArray(data.recommendedPages)) {
        setReferencePages(Array.from(new Set(data.recommendedPages)));
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Something went wrong.");
      setAiQuestion(currentQuestion);
    }
  };

  const handleSearchScopeChange = useCallback((scope: "document" | "company" | "archive") => {
    if (scope === "company") {
      void ensureCompanyContext().then((resolvedCompanyId) => {
        if (resolvedCompanyId) {
          setSearchScope("company");
        } else {
          setAiError("Company information not available.");
          setSearchScope("document");
        }
      });
      return;
    }
    if (scope === "archive") {
      void ensureCompanyContext().then((resolvedCompanyId) => {
        if (resolvedCompanyId) {
          setSearchScope("archive");
        } else {
          setAiError("Company information not available.");
          setSearchScope("document");
        }
      });
      return;
    }
    setSearchScope("document");
  }, [ensureCompanyContext]);

  const handleCreateChat = async () => {
    if (!userId) return null;
    const title = selectedDoc ? `Chat about ${selectedDoc.title}` : 'General AI Chat';
    const chat = await createChat({
      userId,
      title,
      agentMode: 'interactive',
      visibility: 'private',
      aiStyle: aiStyle as "concise" | "detailed" | "academic" | "bullet-points",
      aiPersona: aiPersona as "general" | "learning-coach" | "financial-expert" | "legal-expert" | "math-reasoning",
      documentId: selectedDoc?.id,
    });
    if (chat) {
      setCurrentChatId(chat.id);
      return chat.id;
    }
    return null;
  };

  // Memoized Category Grouping (with file type filter)
  const categories = React.useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    let filteredDocs = documents.filter(doc => 
      doc.title.toLowerCase().includes(lowerSearch) || 
      (doc.aiSummary?.toLowerCase().includes(lowerSearch) ?? false)
    );
    if (fileTypeFilter !== "all") {
      filteredDocs = filteredDocs.filter(doc => getDocumentDisplayType(doc) === fileTypeFilter);
    }

    const grouping: Record<string, CategoryGroup> = {};
    filteredDocs.forEach(doc => {
      grouping[doc.category] ??= {
        name: doc.category,
        isOpen: openCategories.has(doc.category),
        documents: [],
      };
      grouping[doc.category]!.documents.push(doc);
    });

    return Object.values(grouping);
  }, [documents, searchTerm, openCategories, fileTypeFilter]);

  // Render main content based on view mode
  const renderContent = () => {
    switch (viewMode) {
      case "dashboard":
        if (userRole !== 'employer') return null;
        return (
          <EmployerDashboard
            documents={documents}
            categories={categories}
            setViewMode={setViewMode}
            setSelectedDoc={handleSelectDoc}
          />
        );
      case "with-ai-qa":
        return (
          <div className="flex flex-col h-full">
            {/* Query Mode Toggle */}
            <div className="flex-shrink-0 bg-background border-b border-border px-5 py-0">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setQaSubMode("simple");
                    setCurrentChatId(null);
                  }}
                  className={cn(
                    "py-3 px-3 text-[10px] font-black uppercase tracking-[0.15em] transition-all relative",
                    qaSubMode === "simple"
                      ? "text-purple-600 dark:text-purple-400"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Simple Query
                  {qaSubMode === "simple" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 rounded-t-full animate-in fade-in duration-200" />
                  )}
                </button>
                <button
                  onClick={() => setQaSubMode("chat")}
                  className={cn(
                    "py-3 px-3 text-[10px] font-black uppercase tracking-[0.15em] transition-all relative",
                    qaSubMode === "chat"
                      ? "text-purple-600 dark:text-purple-400"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  AI Chat
                  {qaSubMode === "chat" && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 rounded-t-full animate-in fade-in duration-200" />
                  )}
                </button>
                <div className="ml-auto flex items-center gap-2 py-2">
                  <div className="h-3.5 w-px bg-border" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 text-[9px] font-black uppercase tracking-[0.15em] text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all active:scale-95 rounded-md"
                    onClick={() => {
                      if (qaSubMode === "chat") {
                        setQaSubMode("simple");
                        setCurrentChatId(null);
                      } else {
                        setQaSubMode("chat");
                      }
                    }}
                  >
                    {qaSubMode === "chat" ? "Switch to Simple" : "Switch to Chat"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {qaSubMode === "simple" ? (
                <ResizablePanelGroup direction="horizontal" className="h-full">
                  <ResizablePanel defaultSize={65} minSize={40}>
                    <DocumentViewer
                      document={displayDoc}
                      pdfPageNumber={pdfPageNumber}
                      setPdfPageNumber={setPdfPageNumber}
                      onOpenVersionHistory={openVersionHistoryForSelected}
                    />
                  </ResizablePanel>
                  
                  <ResizableHandle className="w-px bg-border" />
                  
                  <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
                    <SimpleQueryPanel
                      selectedDoc={selectedDoc}
                      companyId={companyId}
                      aiQuestion={aiQuestion}
                      setAiQuestion={setAiQuestion}
                      aiAnswer={aiAnswer}
                      setAiAnswer={setAiAnswer}
                      aiError={aiError}
                      setAiError={setAiError}
                      aiLoading={isAiLoading}
                      handleAiSearch={handleAiSearch}
                      searchScope={searchScope}
                      setSearchScope={handleSearchScopeChange}
                      aiStyle={aiStyle}
                      setAiStyle={setAiStyle}
                      provider={provider}
                      setProvider={setProvider}
                      aiModel={aiModel}
                      setAiModel={setAiModel}
                      aiAnswerModel={aiAnswerModel}
                      modelAvailability={modelAvailability}
                      providerAvailability={providerAvailability}
                      styleOptions={STYLE_OPTIONS}
                      referencePages={referencePages}
                      setPdfPageNumber={setPdfPageNumber}
                      userRole={userRole}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
                      ) : (
                        <ResizablePanelGroup direction="horizontal" className="h-full">
                          <ResizablePanel defaultSize={70} minSize={40}>
                            <ChatPanel 
                              userId={userId!}
                              selectedDoc={selectedDoc}
                              currentChatId={currentChatId}
                              setCurrentChatId={setCurrentChatId}
                              aiStyle={aiStyle}
                              setAiStyle={setAiStyle}
                              aiPersona={aiPersona}
                              setAiPersona={setAiPersona}
                              provider={provider}
                              setProvider={setProvider}
                              aiModel={aiModel}
                              setAiModel={setAiModel}
                              modelAvailability={modelAvailability}
                              providerAvailability={providerAvailability}
                              searchScope={searchScope}
                              setSearchScope={handleSearchScopeChange}
                              companyId={companyId}
                              setPdfPageNumber={setPdfPageNumber}
                              styleOptions={STYLE_OPTIONS}
                              onCreateChat={handleCreateChat}
                              isPreviewCollapsed={isPreviewCollapsed}
                              onTogglePreview={() => {
                                if (isPreviewCollapsed) previewPanelRef.current?.expand();
                                else previewPanelRef.current?.collapse();
                              }}
                              userRole={userRole}
                            />
                          </ResizablePanel>
                          
                          <ResizableHandle className="w-px bg-border" />
                          
                          <ResizablePanel 
                            ref={previewPanelRef}
                            defaultSize={30} 
                            minSize={20} 
                            maxSize={40} 
                            collapsible={true}
                            collapsedSize={5}
                            onCollapse={() => setIsPreviewCollapsed(true)}
                            onExpand={() => setIsPreviewCollapsed(false)}
                          >
                            <DocumentViewer 
                              document={displayDoc} 
                              pdfPageNumber={pdfPageNumber}
                              setPdfPageNumber={setPdfPageNumber}
                              hideActions={true}
                              minimal={true}
                              isCollapsed={isPreviewCollapsed}
                            />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      )}
            </div>
          </div>
        );
      case "predictive-analysis":
        return (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={60} minSize={35}>
              <DocumentViewer
                document={displayDoc}
                pdfPageNumber={pdfPageNumber}
                setPdfPageNumber={setPdfPageNumber}
                onOpenVersionHistory={openVersionHistoryForSelected}
              />
            </ResizablePanel>

            <ResizableHandle className="w-px bg-border" />

            <ResizablePanel defaultSize={40} minSize={28} maxSize={55}>
              <DocumentSanityChecker 
                selectedDoc={selectedDoc}
                predictiveAnalysis={predictiveAnalysis}
                predictiveLoading={isPredictiveLoading}
                predictiveError={predictiveError}
                onRefreshAnalysis={() => {
                  if (selectedDoc) {
                    void fetchPredictiveAnalysis(selectedDoc.id, true);
                  }
                }}
                onSelectDocument={(docId, page) => {
                  const doc = documents.find(d => d.id === docId);
                  if (doc) {
                    setSelectedDoc(doc);
                    setPdfPageNumber(page);
                  }
                }}
                setPdfPageNumber={setPdfPageNumber}
                currentPage={pdfPageNumber}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        );
      case "document-only":
        return (
          <DocumentViewer
            document={displayDoc}
            pdfPageNumber={pdfPageNumber}
            setPdfPageNumber={setPdfPageNumber}
            onOpenVersionHistory={openVersionHistoryForSelected}
          />
        );
      case "generator":
        if (userRole !== 'employer') return null;
        return <DocumentGenerator />;
      case "rewrite":
        return <RewriteDiffView />;
      case "upload":
        if (userRole !== 'employer') return null;
        return <UploadView onDocumentUploaded={() => void fetchDocuments()} />;
      case "analytics":
        if (userRole !== 'employer') return null;
        return <CompanyAnalyticsPanel />;
      case "employees":
        if (userRole !== 'employer') return null;
        return <EmployeeManagementPanel />;
      case "settings":
        if (userRole !== 'employer') return null;
        return <EmployerSettingsPanel />;
      case "metadata":
        if (userRole !== 'employer') return null;
        return <CompanyMetadataPanel />;
      case "marketing-pipeline":
        if (userRole !== 'employer') return null;
        return <MarketingPipelinePanel />;
      case "repo-explainer":
        if (userRole !== 'employer') return null;
        return <RepoExplainerPanel initialRepoUrl={diagramRepoUrl} />;
      case "notes":
        return (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={60} minSize={35}>
              <DocumentViewer
                document={displayDoc}
                pdfPageNumber={pdfPageNumber}
                setPdfPageNumber={setPdfPageNumber}
                onOpenVersionHistory={openVersionHistoryForSelected}
              />
            </ResizablePanel>

            <ResizableHandle className="w-px bg-border" />
            
            <ResizablePanel defaultSize={40} minSize={25} maxSize={50}>
              <NotesPanel documentId={selectedDoc?.id ? String(selectedDoc.id) : null} />
            </ResizablePanel>
          </ResizablePanelGroup>
        );
      default:
        return null;
    }
  };

  if (isRoleLoading) return <LoadingPage />;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Sidebar Panel */}
        <ResizablePanel 
          ref={sidebarPanelRef}
          defaultSize={20} 
          minSize={14} 
          maxSize={30}
          collapsible={true}
          collapsedSize={4}
          onCollapse={() => setIsSidebarCollapsed(true)}
          onExpand={() => setIsSidebarCollapsed(false)}
        >
          <Sidebar
            categories={categories}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            fileTypeFilter={fileTypeFilter}
            setFileTypeFilter={setFileTypeFilter}
            selectedDoc={selectedDoc}
            setSelectedDoc={handleSelectDoc}
            viewMode={viewMode}
            setViewMode={setViewMode}
            toggleCategory={toggleCategory}
            deleteDocument={userRole === 'employer' ? requestDeleteDocument : undefined}
            isCollapsed={isSidebarCollapsed}
            onCollapseToggle={(collapsed) => {
              if (collapsed) sidebarPanelRef.current?.collapse();
              else sidebarPanelRef.current?.expand();
            }}
            userId={userId ?? ""}
            currentChatId={currentChatId}
            onSelectChat={(id) => {
              setCurrentChatId(id);
              if (id) setQaSubMode("chat");
            }}
            onNewChat={() => {
              setCurrentChatId(null);
              setQaSubMode("chat");
            }}
            userRole={userRole}
            totalDocuments={documents.length}
            onOpenVersionHistory={
              userRole === 'employer'
                ? (doc) =>
                    setVersionHistoryTarget({ id: doc.id, title: doc.title })
                : undefined
            }
            onGenerateDiagram={handleGenerateDiagram}
          />
        </ResizablePanel>

        <ResizableHandle className="w-px bg-border" />

        {/* Main Content Area */}
        <ResizablePanel defaultSize={80} minSize={50}>
          <div className="h-full w-full flex flex-col">
            {/*
              Old-version preview banner. Rendered above the viewer when the
              user has opened a non-current version from the version-history
              panel. Clicking "Return to current" clears preview state; the
              viewer then shows the current version again. "Revert to this
              version" makes the previewed version authoritative.
            */}
            {previewVersion &&
              selectedDoc &&
              previewVersion.documentId === selectedDoc.id && (
                <div className="flex-shrink-0 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center flex-shrink-0">
                      <svg
                        className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-amber-900 dark:text-amber-100">
                        Viewing version {previewVersion.versionNumber} (not
                        current)
                      </div>
                      <div className="text-[10px] text-amber-700 dark:text-amber-300 truncate">
                        Search and Q&amp;A still use the current version.
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                      onClick={() => setPreviewVersion(null)}
                    >
                      Return to current
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => void handleRevertPreview()}
                    >
                      Revert to this version
                    </Button>
                  </div>
                </div>
              )}
            <div className="flex-1 min-h-0">{renderContent()}</div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <AlertDialog
        open={deleteConfirmDocId !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirmDocId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the document and all related data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => void confirmDeleteDocument()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {versionHistoryTarget && (
        <VersionHistoryPanel
          documentId={versionHistoryTarget.id}
          documentTitle={versionHistoryTarget.title}
          onClose={() => setVersionHistoryTarget(null)}
          onVersionsChanged={() => void fetchDocuments()}
          onPreviewVersion={(versionId, versionNumber) => {
            // Switch the viewer to the previewed version. We scope the
            // preview to whichever doc the history panel was opened for,
            // which may not be the currently-selected doc — e.g. the user
            // could have opened history from one doc's dropdown while a
            // different doc is selected in the viewer. In that case we also
            // flip selectedDoc to the target so the banner + viewer stay
            // consistent.
            if (versionHistoryTarget) {
              if (selectedDoc?.id !== versionHistoryTarget.id) {
                const target = documents.find(
                  (d) => d.id === versionHistoryTarget.id
                );
                if (target) setSelectedDoc(target);
              }
              setPreviewVersion({
                documentId: versionHistoryTarget.id,
                versionId,
                versionNumber,
              });
            }
          }}
        />
      )}

      <Toaster />
    </div>
  );
}
