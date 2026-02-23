"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Search, Plus, FileText, Clock, PenLine, Loader2 } from "lucide-react";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Card } from "~/app/employer/documents/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "~/app/employer/documents/components/ui/tabs";
import { DocumentGeneratorEditor } from "./DocumentGeneratorEditor";
import type { Citation } from "./generator";

const DEFAULT_TITLE = "Untitled (Rewrite)";

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
      const docTitle = title.trim() || DEFAULT_TITLE;
      try {
        if (currentDocument) {
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
          const data = (await response.json()) as { success: boolean; message?: string };
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
          const data = (await response.json()) as {
            success: boolean;
            message?: string;
            document?: { id: number };
          };
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

  if (viewMode === "editor") {
    return (
      <div className="flex flex-col h-full w-full">
        {saveError && (
          <div className="flex-shrink-0 px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-border">
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
    <div className="flex flex-col h-full bg-background">
      <div className="flex-shrink-0 bg-background border-b border-border p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-amber-600 rounded-xl shadow-lg shadow-amber-500/20">
                  <PenLine className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-foreground">Rewrite</h1>
              </div>
              <p className="text-muted-foreground">
                Refine and rewrite documents with AI assistance
              </p>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "new" | "existing")} className="w-full">
            <TabsList className="bg-muted">
              <TabsTrigger value="new" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
                <Plus className="w-4 h-4 mr-2" />
                New Document
              </TabsTrigger>
              <TabsTrigger value="existing" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
                <Clock className="w-4 h-4 mr-2" />
                My Documents ({rewriteDocuments.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex-shrink-0 bg-background border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search your documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-background border-border"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          {activeTab === "new" ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="max-w-md text-center mb-6">
                <h3 className="text-xl font-semibold mb-2 text-foreground">Start writing</h3>
                <p className="text-muted-foreground mb-6">
                  Create a new document and use AI to rewrite, refine, or improve your text.
                </p>
                <Button onClick={handleNewDocument} className="bg-amber-600 hover:bg-amber-700 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  New Document
                </Button>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredDocuments.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocuments.map((doc) => (
                <Card
                  key={doc.id}
                  className="group cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] border-2 border-border hover:border-amber-600 p-5 bg-card"
                  onClick={() => handleOpenDocument(doc)}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded">
                      <FileText className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate mb-1 text-foreground">{doc.title}</h3>
                      <p className="text-xs text-muted-foreground">Last edited {doc.lastEdited}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                    {doc.content.slice(0, 150)}
                    {doc.content.length > 150 ? "..." : ""}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full group-hover:bg-amber-600 group-hover:text-white border-border"
                  >
                    Open Document
                  </Button>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="w-16 h-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-xl font-semibold mb-2 text-foreground">No documents yet</h3>
              <p className="text-muted-foreground mb-6 text-center">
                Create your first rewrite document to get started
              </p>
              <Button onClick={handleNewDocument} className="bg-amber-600 hover:bg-amber-700 text-white">
                <Plus className="w-4 h-4 mr-2" />
                Create New Document
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
