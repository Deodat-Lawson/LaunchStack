"use client";

import React, { useCallback, useEffect, useState, useRef, useId } from "react";
import {
  Search,
  Plus,
  FileText,
  Clock,
  Loader2,
  Upload,
  FileUp,
  Type,
  Paperclip,
  Sparkles,
  PenLine,
  ArrowRight,
  Wand2,
} from "lucide-react";
import { DocumentGeneratorEditor } from "./DocumentGeneratorEditor";
import { RewriteWorkflow } from "./generator/RewriteWorkflow";
import { legalTheme as s } from "./LegalGeneratorTheme";
import type { Citation } from "./generator";

const DEFAULT_TITLE = "Untitled (Rewrite)";
const PENDING_REWRITE_STORAGE_KEY = "pdr.pendingRewriteDraft";

interface RewriteDocument {
  id: string;
  title: string;
  lastEdited: string;
  content: string;
  citations?: Citation[];
}

interface APIDocument {
  id: number;
  title: string;
  content: string;
  templateId?: string;
  citations?: Citation[];
  createdAt: string;
  updatedAt?: string;
}

interface PendingRewriteDraft {
  title?: string;
  content?: string;
  createdAt?: number;
  source?: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

export function RewriteDiffView() {
  const [viewMode, setViewMode] = useState<"list" | "editor">("list");
  const [activeTab, setActiveTab] = useState<"new" | "existing">("new");
  const [rewriteDocuments, setRewriteDocuments] = useState<RewriteDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentDocument, setCurrentDocument] = useState<RewriteDocument | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowText, setWorkflowText] = useState("");
  const [tempIdCounter, setTempIdCounter] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const componentId = useId();

  const fetchRewriteDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/document-generator/documents?templateId=rewrite");
      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        documents?: APIDocument[];
      };
      if (data.success && data.documents) {
        const docs: RewriteDocument[] = data.documents.map((doc) => ({
          id: doc.id.toString(),
          title: doc.title,
          lastEdited: formatRelativeTime(doc.updatedAt ?? doc.createdAt),
          content: doc.content,
          citations: doc.citations,
        }));
        setRewriteDocuments(docs);
      }
    } catch {
      // Error fetching rewrite documents
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRewriteDocuments();
  }, [fetchRewriteDocuments]);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(PENDING_REWRITE_STORAGE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PENDING_REWRITE_STORAGE_KEY);

      const parsed = JSON.parse(raw) as PendingRewriteDraft;
      const content = typeof parsed.content === "string" ? parsed.content : "";
      if (!content.trim()) return;

      const title =
        typeof parsed.title === "string" && parsed.title.trim().length > 0
          ? parsed.title.trim()
          : "Rewritten Text";

      const newId = tempIdCounter + 1;
      setTempIdCounter(newId);
      setCurrentDocument({
        id: `temp-${componentId}-${newId}`,
        title,
        content,
        lastEdited: "Just now",
      });
      setViewMode("editor");
      setActiveTab("new");
    } catch {
      if (raw) {
        try {
          sessionStorage.removeItem(PENDING_REWRITE_STORAGE_KEY);
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  }, [componentId, tempIdCounter]);

  const filteredDocuments = rewriteDocuments.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleNewDocument = useCallback(() => {
    setCurrentDocument(null);
    setViewMode("editor");
  }, []);

  const handleOpenDocument = useCallback((doc: RewriteDocument) => {
    setCurrentDocument(doc);
    setViewMode("editor");
  }, []);

  const handleBackToList = useCallback(() => {
    setViewMode("list");
    setCurrentDocument(null);
    void fetchRewriteDocuments();
  }, [fetchRewriteDocuments]);

  const handleSave = useCallback(
    async (title: string, content: string, citations?: Citation[]) => {
      setSaveError(null);
      const trimmedTitle = title.trim();
      const docTitle = trimmedTitle.length > 0 ? trimmedTitle : DEFAULT_TITLE;
      const isTempDoc = currentDocument?.id.startsWith("temp-") ?? false;
      const usePut = currentDocument && !isTempDoc;
      try {
        if (usePut) {
          const response = await fetch("/api/document-generator/documents", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: parseInt(currentDocument.id, 10),
              title: docTitle,
              content,
              citations: citations ?? [],
            }),
          });
          const text = await response.text();
          let data: { success: boolean; message?: string };
          try {
            data = JSON.parse(text) as { success: boolean; message?: string };
          } catch {
            setSaveError(
              response.ok
                ? "Invalid response from server"
                : `Failed to save (${response.status}). ${text.slice(0, 100)}`
            );
            return;
          }
          if (!data.success) {
            setSaveError(data.message ?? "Failed to save document");
            return;
          }
          setCurrentDocument({
            ...currentDocument,
            title: docTitle,
            content,
            lastEdited: "Just now",
          });
        } else {
          const response = await fetch("/api/document-generator/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: docTitle,
              content,
              templateId: "rewrite",
              citations: citations ?? [],
              metadata: { source: "rewrite" },
            }),
          });
          const text = await response.text();
          let data: { success: boolean; message?: string; document?: { id: number } };
          try {
            data = JSON.parse(text) as {
              success: boolean;
              message?: string;
              document?: { id: number };
            };
          } catch {
            setSaveError(
              response.ok
                ? "Invalid response from server"
                : `Failed to save (${response.status}). ${text.slice(0, 100)}`
            );
            return;
          }
          if (!data.success) {
            setSaveError(data.message ?? "Failed to save document");
            return;
          }
          if (data.document?.id) {
            setCurrentDocument({
              id: data.document.id.toString(),
              title: docTitle,
              content,
              lastEdited: "Just now",
            });
          }
        }
      } catch (err) {
        console.error("Save to documents failed:", err);
        setSaveError("Failed to save document");
      }
    },
    [currentDocument]
  );

  const handleFileRead = useCallback(async (file: File): Promise<string> => {
    const fileType = file.name.split(".").pop()?.toLowerCase();
    switch (fileType) {
      case "txt":
      case "md":
        return file.text();
      case "pdf":
        throw new Error("PDF import not yet supported. Please copy and paste the text manually.");
      case "docx":
        throw new Error("DOCX import not yet supported. Please copy and paste the text manually.");
      default:
        return file.text();
    }
  }, []);

  const handleStartWorkflow = useCallback((text?: string) => {
    setWorkflowText(text ?? "");
    setShowWorkflow(true);
  }, []);

  const handleFileImport = useCallback(
    async (files: FileList) => {
      if (files.length === 0) return;
      const file = files[0];
      if (!file) return;
      setIsImporting(true);
      setImportError(null);
      try {
        const content = await handleFileRead(file);
        handleStartWorkflow(content);
      } catch (error) {
        setImportError(error instanceof Error ? error.message : "Failed to import file");
      } finally {
        setIsImporting(false);
      }
    },
    [handleFileRead, handleStartWorkflow],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        void handleFileImport(files);
      }
    },
    [handleFileImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        void handleFileImport(files);
      }
    },
    [handleFileImport],
  );

  const handleWorkflowComplete = useCallback(
    (rewrittenText: string) => {
      const newId = tempIdCounter + 1;
      setTempIdCounter(newId);
      setCurrentDocument({
        id: `temp-${componentId}-${newId}`,
        title: "Rewritten Text",
        content: rewrittenText,
        lastEdited: "Just now",
      });
      setShowWorkflow(false);
      setViewMode("editor");
    },
    [tempIdCounter, componentId],
  );

  const handleWorkflowCancel = useCallback(() => {
    setShowWorkflow(false);
    setWorkflowText("");
  }, []);

  if (showWorkflow) {
    return (
      <RewriteWorkflow
        initialText={workflowText}
        onComplete={handleWorkflowComplete}
        onCancel={handleWorkflowCancel}
      />
    );
  }

  if (viewMode === "editor") {
    return (
      <div className="flex h-full w-full flex-col">
        {saveError && (
          <div
            className="flex-shrink-0 px-4 py-2"
            style={{
              fontSize: 13,
              color: "var(--danger)",
              background: "oklch(from var(--danger) l c h / 0.08)",
              borderBottom: "1px solid oklch(from var(--danger) l c h / 0.28)",
            }}
          >
            {saveError}
          </div>
        )}
        <DocumentGeneratorEditor
          initialTitle={currentDocument?.title ?? ""}
          initialContent={currentDocument?.content ?? ""}
          initialCitations={currentDocument?.citations ?? []}
          documentId={currentDocument ? parseInt(currentDocument.id, 10) : undefined}
          onBack={handleBackToList}
          onSave={handleSave}
          mode="rewrite"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Hero header */}
      <div className="flex-shrink-0 px-6 pt-8 pb-4 md:px-10 md:pt-10">
        <div className="mx-auto w-full max-w-7xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="flex items-start gap-4">
              <div className={s.brandMark}>
                <PenLine className="h-[18px] w-[18px]" />
              </div>
              <div className="space-y-2">
                <span className={s.eyebrow}>Rewrite</span>
                <h1 className={s.title}>
                  Refine your{" "}
                  <span className={s.highlight}>
                    <span className={s.serif}>prose</span>
                  </span>
                </h1>
                <p className={s.sub} style={{ maxWidth: 560 }}>
                  Paste or import text, pick a tone, preview the changes,
                  then push the polished version into your editor.
                </p>
              </div>
            </div>

            <div className={s.tabs}>
              <button
                className={`${s.tab} ${activeTab === "new" ? s.tabActive : ""}`}
                onClick={() => setActiveTab("new")}
              >
                <Plus className="h-4 w-4" />
                New rewrite
              </button>
              <button
                className={`${s.tab} ${activeTab === "existing" ? s.tabActive : ""}`}
                onClick={() => setActiveTab("existing")}
              >
                <Clock className="h-4 w-4" />
                My rewrites
                <span className={s.tabCount}>{rewriteDocuments.length}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search strip (only on existing) */}
      {activeTab === "existing" && (
        <div className="flex-shrink-0 px-6 pt-4 md:px-10">
          <div className="mx-auto w-full max-w-7xl">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--ink-3)" }}
              />
              <input
                type="text"
                className={s.input}
                placeholder="Search your rewrites…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 40 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${s.scrollbar}`}>
        <div className="mx-auto w-full max-w-7xl px-6 py-6 md:px-10 md:py-8">
          {activeTab === "new" ? (
            <div className="space-y-8">
              {importError && (
                <div className={`${s.banner} ${s.bannerDanger}`} style={{ padding: 14 }}>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>
                    {importError}
                  </p>
                </div>
              )}

              {/* Primary CTA — start a workflow */}
              <div className={s.banner}>
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex flex-1 items-start gap-3">
                    <div className={s.brandMark}>
                      <Sparkles className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 17,
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "var(--ink)",
                        }}
                      >
                        Step-by-step rewrite
                      </h3>
                      <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>
                        Paste or drop in text, choose tone / length / audience,
                        preview the diff, then push to your document.
                      </p>
                    </div>
                  </div>
                  <div className="flex md:justify-end">
                    <button
                      className={`${s.btn} ${s.btnAccent} ${s.btnLg}`}
                      onClick={() => handleStartWorkflow()}
                    >
                      <Wand2 className="h-4 w-4" />
                      Start workflow
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Action grid */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* Drop zone */}
                <button
                  type="button"
                  onClick={() => !isImporting && fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  disabled={isImporting}
                  className={s.card}
                  style={{
                    padding: 22,
                    border: isDragActive
                      ? "1px dashed var(--accent)"
                      : "1px dashed var(--line)",
                    background: isDragActive
                      ? "var(--accent-soft)"
                      : "var(--panel)",
                    textAlign: "center",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 220,
                    cursor: isImporting ? "wait" : "pointer",
                    opacity: isImporting ? 0.7 : 1,
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf,.docx,.doc"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                  <div
                    className={s.brandMark}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      marginBottom: 12,
                    }}
                  >
                    {isImporting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Upload className="h-5 w-5" />
                    )}
                  </div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--ink)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {isImporting ? "Importing…" : "Import a document"}
                  </h3>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 13,
                      color: "var(--ink-3)",
                      lineHeight: 1.5,
                    }}
                  >
                    Drag &amp; drop or click to browse.
                    <br />
                    Supports <code style={{ fontSize: 12 }}>.txt</code>,{" "}
                    <code style={{ fontSize: 12 }}>.md</code>.
                  </p>
                </button>

                {/* Paste clipboard */}
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      .readText()
                      .then((text) => {
                        if (text.trim()) handleStartWorkflow(text);
                      })
                      .catch(() => {
                        setImportError("Failed to read from clipboard");
                      });
                  }}
                  className={s.card}
                  style={{
                    padding: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    minHeight: 220,
                  }}
                >
                  <div
                    className={s.brandMark}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      marginBottom: 12,
                    }}
                  >
                    <Paperclip className="h-5 w-5" />
                  </div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--ink)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    Paste from clipboard
                  </h3>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 13,
                      color: "var(--ink-3)",
                      lineHeight: 1.5,
                    }}
                  >
                    Pull text you already copied and jump straight into the
                    workflow.
                  </p>
                </button>

                {/* Blank slate */}
                <button
                  type="button"
                  onClick={handleNewDocument}
                  className={s.card}
                  style={{
                    padding: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    minHeight: 220,
                  }}
                >
                  <div
                    className={s.brandMark}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      marginBottom: 12,
                    }}
                  >
                    <FileUp className="h-5 w-5" />
                  </div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--ink)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    Start from blank
                  </h3>
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 13,
                      color: "var(--ink-3)",
                      lineHeight: 1.5,
                    }}
                  >
                    Open an empty editor and type or paste whatever you want to
                    rewrite.
                  </p>
                </button>
              </div>

              {/* Tips strip */}
              <div
                className={s.panel}
                style={{ padding: 18 }}
              >
                <div className="flex items-start gap-3">
                  <div className={s.brandMarkSm}>
                    <Type className="h-[13px] w-[13px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      How the workflow works
                    </h4>
                    <div
                      className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2"
                      style={{
                        fontSize: 12,
                        color: "var(--ink-3)",
                        lineHeight: 1.55,
                      }}
                    >
                      <p style={{ margin: 0 }}>
                        <strong style={{ color: "var(--ink-2)" }}>Input →</strong>{" "}
                        Paste, drop, or type the source text.
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong style={{ color: "var(--ink-2)" }}>Options →</strong>{" "}
                        Pick tone, length, audience, extras.
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong style={{ color: "var(--ink-2)" }}>Preview →</strong>{" "}
                        Side-by-side or inline diff, regenerate as needed.
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong style={{ color: "var(--ink-2)" }}>Apply →</strong>{" "}
                        Push the chosen version to your document.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2
                className="h-6 w-6 animate-spin"
                style={{ color: "var(--accent)" }}
              />
            </div>
          ) : filteredDocuments.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredDocuments.map((doc) => (
                <RewriteDocumentRow
                  key={doc.id}
                  doc={doc}
                  onOpen={handleOpenDocument}
                />
              ))}
            </div>
          ) : (
            <div
              className={`${s.panel} mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center`}
              style={{ borderStyle: "dashed" }}
            >
              <FileText className="h-12 w-12" style={{ color: "var(--ink-4)" }} />
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: "var(--ink)" }}>
                {searchQuery ? "No rewrites match" : "No rewrites yet"}
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)", maxWidth: 340 }}>
                {searchQuery
                  ? `Nothing matched "${searchQuery}". Try a different keyword.`
                  : "Rewrite some prose to keep a history of polished drafts."}
              </p>
              <button
                className={`${s.btn} ${s.btnAccent}`}
                onClick={() => {
                  setActiveTab("new");
                  setSearchQuery("");
                }}
                style={{ marginTop: 6 }}
              >
                <Plus className="h-4 w-4" />
                New rewrite
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Document row ───────────────────────────────────────────────────────────

function RewriteDocumentRow({
  doc,
  onOpen,
}: {
  doc: RewriteDocument;
  onOpen: (doc: RewriteDocument) => void;
}) {
  const preview = doc.content.replace(/<[^>]*>/g, "").slice(0, 160);
  return (
    <button type="button" className={s.docRow} onClick={() => onOpen(doc)}>
      <div className="flex items-start gap-3">
        <div className={s.brandMarkSm}>
          <PenLine className="h-[14px] w-[14px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
            className="truncate"
          >
            {doc.title}
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
            Last edited {doc.lastEdited}
          </p>
        </div>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--ink-2)",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {preview}
        {preview.length >= 160 ? "…" : ""}
      </p>
      <div className="mt-auto">
        <span
          className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
          style={{ width: "100%" }}
        >
          Open rewrite
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
