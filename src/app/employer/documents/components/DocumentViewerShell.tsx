"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import LoadingPage from "~/app/_components/loading";
import { Sidebar } from "./Sidebar";
import { DocumentViewer } from "./DocumentViewer";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "~/app/employer/documents/components/ui/resizable";
import { cn } from "~/lib/utils";
import type { ViewMode, DocumentType, CategoryGroup, errorType, PredictiveAnalysisResponse } from "../types";
import { getDocumentDisplayType, type DocumentDisplayType } from "../types/document";
import { useAIChat } from "../hooks/useAIChat";
import { useAIChatbot } from "../hooks/useAIChatbot";
import { Button } from "~/app/employer/documents/components/ui/button";
import type { ImperativePanelHandle } from "react-resizable-panels";

import { RESPONSE_STYLES, type ResponseStyleId } from "~/lib/ai/styles";
import type { AIModelType } from "~/app/api/agents/documentQ&A/services/types";

type AIModelAvailability = Record<AIModelType, boolean>;

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

const STYLE_OPTIONS = Object.entries(RESPONSE_STYLES).reduce((acc, [key, config]) => {
  acc[key as ResponseStyleId] = config.label;
  return acc;
}, {} as Record<ResponseStyleId, string>);

export interface DocumentViewerShellProps {
  /** 'employer' or 'employee' — controls auth, features, and UI gating */
  userRole: 'employer' | 'employee';
}

export function DocumentViewerShell({ userRole }: DocumentViewerShellProps) {
  const router = useRouter();
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
  const [viewMode, setViewMode] = useState<ViewMode>("with-ai-qa");
  const [qaSubMode, setQaSubMode] = useState<"simple" | "chat">("simple");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  
  // AI States (Simple Query)
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiError, setAiError] = useState("");
  const [referencePages, setReferencePages] = useState<number[]>([]);
  const [aiStyle, setAiStyle] = useState<string>("concise");
  const [searchScope, setSearchScope] = useState<"document" | "company">("document");
  const { sendQuery: sendAIChatQuery, loading: isAiLoading } = useAIChat();
  
  // AI States (Chat)
  const { createChat, getChat } = useAIChatbot();
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [aiPersona, setAiPersona] = useState<string>('general');
  const [aiModel, setAiModel] = useState<AIModelType>("gpt-5.2");
  const [modelAvailability, setModelAvailability] = useState<Partial<AIModelAvailability>>({});

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
    if (!userId || isRoleLoading) return;
    void fetchDocuments();
  }, [userId, isRoleLoading, fetchDocuments]);

  useEffect(() => {
    const fetchModelAvailability = async () => {
      try {
        const response = await fetch("/api/config/ai-models");
        if (!response.ok) return;
        const data = (await response.json()) as {
          models?: Partial<Record<AIModelType, boolean>>;
        };
        if (data.models) {
          setModelAvailability(data.models);
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
    setReferencePages([]);
    setPredictiveAnalysis(null);
  };

  const deleteDocument = async (docId: number) => {
    if (!window.confirm('Are you sure you want to delete this document? This will permanently remove it and all related data. This action cannot be undone.')) {
      return;
    }

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
      alert(result.message ?? 'Document deleted successfully');
    } catch (error) {
      console.error('Error deleting document:', error);
      alert(`Failed to delete document: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  const handleAiSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuestion.trim()) return;
    
    if (searchScope === "document" && !selectedDoc) return;
    let resolvedCompanyId = companyId;
    if (searchScope === "company" && !resolvedCompanyId) {
      resolvedCompanyId = await ensureCompanyContext();
      if (!resolvedCompanyId) {
        setAiError("Company information not available.");
        return;
      }
    }

    setAiError("");
    setAiAnswer("");
    setReferencePages([]);

    const currentQuestion = aiQuestion;
    setAiQuestion("");

    try {
      const data = await sendAIChatQuery({
        question: currentQuestion,
        searchScope,
        style: aiStyle as ResponseStyleId,
        aiModel,
        documentId: searchScope === "document" && selectedDoc ? selectedDoc.id : undefined,
        companyId: searchScope === "company" ? resolvedCompanyId ?? undefined : undefined,
      });

      if (!data) throw new Error("Failed to get AI response");

      setAiAnswer(data.summarizedAnswer ?? "");
      if (Array.isArray(data.recommendedPages)) {
        setReferencePages(Array.from(new Set(data.recommendedPages)));
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Something went wrong.");
      setAiQuestion(currentQuestion);
    }
  };

  const handleSearchScopeChange = useCallback((scope: "document" | "company") => {
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
      case "with-ai-qa":
        return (
          <div className="flex flex-col h-full">
            {/* Query Mode Toggle */}
            <div className="flex-shrink-0 bg-background border-b border-border px-8 pt-4 pb-0">
              <div className="flex gap-8">
                <button
                  onClick={() => {
                    setQaSubMode("simple");
                    setCurrentChatId(null);
                  }}
                  className={cn(
                    "pb-3 text-xs font-bold uppercase tracking-widest transition-all relative",
                    qaSubMode === "simple" ? "text-purple-600" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Simple Query
                  {qaSubMode === "simple" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 animate-in fade-in duration-300" />}
                </button>
                <button
                  onClick={() => setQaSubMode("chat")}
                  className={cn(
                    "pb-3 text-xs font-bold uppercase tracking-widest transition-all relative",
                    qaSubMode === "chat" ? "text-purple-600" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  AI Chat
                  {qaSubMode === "chat" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600 animate-in fade-in duration-300" />}
                </button>
                
                <div className="ml-auto pb-3 flex items-center gap-4">
                  <div className="h-4 w-px bg-border" />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 px-3 text-[10px] font-black uppercase tracking-widest text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all active:scale-95"
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
                      document={selectedDoc} 
                      pdfPageNumber={pdfPageNumber}
                      setPdfPageNumber={setPdfPageNumber}
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
                      aiModel={aiModel}
                      setAiModel={setAiModel}
                      modelAvailability={modelAvailability}
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
                              aiModel={aiModel}
                              setAiModel={setAiModel}
                              modelAvailability={modelAvailability}
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
                              document={selectedDoc} 
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
          />
        );
      case "document-only":
        return (
          <DocumentViewer 
            document={selectedDoc} 
            pdfPageNumber={pdfPageNumber}
            setPdfPageNumber={setPdfPageNumber}
          />
        );
      case "generator":
        if (userRole !== 'employer') return null;
        return <DocumentGenerator />;
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
          minSize={15} 
          maxSize={30}
          collapsible={true}
          collapsedSize={5}
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
            deleteDocument={userRole === 'employer' ? (id) => { void deleteDocument(id); } : undefined}
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
          />
        </ResizablePanel>

        <ResizableHandle className="w-px bg-gray-200 dark:bg-gray-800" />

        {/* Main Content Area */}
        <ResizablePanel defaultSize={80} minSize={50}>
          <div className="h-full w-full">
            {renderContent()}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
