"use client";

/**
 * Legal document flow:
 * 1. Home — pick a template from the library, or open the legal assistant (chat).
 * 2. Chat (optional) — assistant recommends a template and pre-fills field values.
 * 3. Editor — LegalDocumentEditor opens directly with the templated draft.
 *    Field values are filled inline via the right-pane Fields tab.
 */

import { useState, useEffect, useCallback } from 'react';
import { DocumentGeneratorHome, type DocumentTemplate } from './DocumentGeneratorHome';
import { LegalDocumentEditor } from './LegalDocumentEditor';
import { DocumentGeneratorEditor } from './DocumentGeneratorEditor';
import { LegalChatbot } from './LegalChatbot';
import { LegalGeneratorTheme, legalTheme } from './LegalGeneratorTheme';
import { Loader2 } from 'lucide-react';
import type { Citation } from './generator';
import { TEMPLATE_REGISTRY } from '@launchstack/features/legal-templates';
import type { EditorSection } from '@launchstack/features/legal-templates';
import { parseLegalDocumentHtmlToSections } from '@launchstack/features/legal-templates';
import {
  buildEditorSections,
  buildTemplateFieldDataForDocx,
  extractFieldValuesFromSections,
} from '@launchstack/features/legal-templates';

interface GeneratedDocument {
  id: string;
  title: string;
  template: string;
  lastEdited: string;
  content: string;
  citations?: Citation[];
  docxBase64?: string;
  sections?: EditorSection[];
  metadata?: {
    tone?: string;
    audience?: string;
    length?: string;
    description?: string;
    templateType?: "general" | "legal";
    legalData?: Record<string, string>;
    /** Persisted from editor so reopen keeps section labels and field layout */
    legalSections?: EditorSection[];
  };
}

interface APIDocument {
  id: number;
  title: string;
  content: string;
  templateId?: string;
  metadata?: GeneratedDocument['metadata'];
  citations?: Citation[];
  createdAt: string;
  updatedAt?: string;
}

function shouldOpenAsLegalEditor(doc: GeneratedDocument): boolean {
  const id = doc.template;
  if (!id || !TEMPLATE_REGISTRY[id]) return false;
  if (doc.metadata?.templateType === 'legal') return true;
  return /<mark[^>]*\bdata-field-key=/i.test(doc.content);
}

function getLegalSectionsForDocument(doc: GeneratedDocument): EditorSection[] {
  if (doc.sections && doc.sections.length > 0) {
    return doc.sections;
  }
  const fromMeta = doc.metadata?.legalSections;
  if (fromMeta && Array.isArray(fromMeta) && fromMeta.length > 0) {
    return fromMeta;
  }
  return parseLegalDocumentHtmlToSections(doc.content);
}

async function regenerateLegalDocxBase64(
  templateId: string,
  contentHtml: string,
  legalData?: Record<string, string>,
): Promise<string | undefined> {
  if (!templateId || !TEMPLATE_REGISTRY[templateId]) return undefined;
  const data = buildTemplateFieldDataForDocx(templateId, contentHtml, legalData);
  try {
    const res = await fetch('/api/document-generator/legal-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId,
        data,
        format: 'json',
      }),
    });
    const json = (await res.json()) as {
      success?: boolean;
      docxBase64?: string;
    };
    if (!json.success || !json.docxBase64) return undefined;
    return json.docxBase64;
  } catch {
    return undefined;
  }
}

export function DocumentGenerator() {
  const [currentView, setCurrentView] = useState<'home' | 'editor' | 'chat'>('home');
  const [currentDocument, setCurrentDocument] = useState<GeneratedDocument | null>(null);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>(undefined);

  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/api/document-generator/documents');
      const data = await response.json() as { success: boolean; message?: string; documents?: APIDocument[] };
      
      if (data.success && data.documents) {
        const docs: GeneratedDocument[] = data.documents
          .filter((doc: APIDocument) => doc.templateId !== 'rewrite')
          .map((doc: APIDocument) => ({
            id: doc.id.toString(),
            title: doc.title,
            template: doc.templateId ?? 'Custom',
            lastEdited: formatRelativeTime(doc.updatedAt ?? doc.createdAt),
            content: doc.content,
            citations: doc.citations,
            metadata: doc.metadata,
          }));
        setGeneratedDocuments(docs);
      } else {
        setError(data.message ?? 'Failed to fetch documents');
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError('Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  /**
   * Open the editor directly for a chosen legal template — no Configure step.
   * Builds skeleton sections client-side and persists an empty draft so the
   * editor's save/DOCX flows have a document id to work with.
   */
  const openLegalDraft = useCallback(
    async (template: DocumentTemplate, prefilled?: Record<string, string>) => {
      const registryTemplate = TEMPLATE_REGISTRY[template.id];
      if (!registryTemplate) {
        setError(`Unknown template: ${template.id}`);
        return;
      }

      setError(null);
      const data = prefilled ?? {};
      const sections = buildEditorSections(registryTemplate, data);
      const htmlContent = sections
        .map((s) => {
          if (s.type === 'title') return `<h1>${s.content}</h1>`;
          if (s.type === 'heading') return `<h2>${s.content}</h2>`;
          return `<p>${s.content}</p>`;
        })
        .join('\n');

      try {
        const response = await fetch('/api/document-generator/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: template.name,
            content: htmlContent,
            templateId: template.id,
            metadata: {
              templateType: 'legal',
              legalData: data,
              legalSections: sections,
            },
          }),
        });

        const json = await response.json() as {
          success: boolean;
          message?: string;
          document?: { id: number };
        };

        if (!json.success || !json.document) {
          setError(json.message ?? 'Failed to create draft');
          return;
        }

        const newDoc: GeneratedDocument = {
          id: json.document.id.toString(),
          title: template.name,
          template: template.id,
          lastEdited: 'Just now',
          content: htmlContent,
          sections,
          metadata: {
            templateType: 'legal',
            legalData: data,
            legalSections: sections,
          },
        };

        setCurrentDocument(newDoc);
        setGeneratedDocuments((prev) => [newDoc, ...prev]);
        setCurrentView('editor');
      } catch (err) {
        console.error('Error opening legal draft:', err);
        setError('Failed to open templated draft');
      }
    },
    [],
  );

  const handleNewDocument = (template: DocumentTemplate) => {
    void openLegalDraft(template);
  };

  const handleStartChat = (initialMessage?: string) => {
    setError(null);
    setChatInitialMessage(initialMessage);
    setCurrentView('chat');
  };

  const handleChatProceedToTemplateForm = (
    templateId: string,
    prefilled: Record<string, string>,
  ) => {
    const registryTemplate = TEMPLATE_REGISTRY[templateId];
    if (!registryTemplate) return;

    const template: DocumentTemplate = {
      id: registryTemplate.id,
      name: registryTemplate.name,
      category: 'Legal',
      description: registryTemplate.description,
      preview: '',
      isLegal: true,
      fields: registryTemplate.fields,
    };
    void openLegalDraft(template, prefilled);
  };

  const handleOpenDocument = (document: GeneratedDocument) => {
    void (async () => {
      let next: GeneratedDocument = document;
      if (shouldOpenAsLegalEditor(document)) {
        const sections = getLegalSectionsForDocument(document);
        next = {
          ...document,
          sections,
          metadata: {
            ...(document.metadata ?? {}),
            templateType: 'legal',
            legalSections: sections,
          },
        };
        const docx = await regenerateLegalDocxBase64(
          next.template,
          next.content,
          next.metadata?.legalData,
        );
        if (docx) {
          next = { ...next, docxBase64: docx };
        }
      }
      setCurrentDocument(next);
      setCurrentView('editor');
    })();
  };

  const handleSaveDocument = async (
    title: string,
    content: string,
    citations?: Citation[],
    editorSections?: EditorSection[],
  ) => {
    if (!currentDocument) return;

    const isLegalDoc =
      shouldOpenAsLegalEditor(currentDocument) ||
      currentDocument.metadata?.templateType === 'legal';
    const legalSectionsSnapshot = isLegalDoc
      ? (() => {
          if (editorSections && editorSections.length > 0) {
            return editorSections;
          }
          const parsed = parseLegalDocumentHtmlToSections(content);
          if (parsed.length > 0) {
            return parsed;
          }
          return currentDocument.metadata?.legalSections ?? [];
        })()
      : undefined;
    const legalMetadata = isLegalDoc
      ? {
          ...(currentDocument.metadata ?? {}),
          templateType: 'legal' as const,
          legalData: extractFieldValuesFromSections([content]),
          legalSections: legalSectionsSnapshot ?? [],
        }
      : undefined;

    try {
      const response = await fetch('/api/document-generator/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: parseInt(currentDocument.id),
          title,
          content,
          citations,
          ...(legalMetadata !== undefined ? { metadata: legalMetadata } : {}),
        }),
      });

      const data = await response.json() as { success: boolean };
      
      if (data.success) {
        let docxBase64: string | undefined = currentDocument.docxBase64;
        if (
          isLegalDoc &&
          currentDocument.template &&
          TEMPLATE_REGISTRY[currentDocument.template]
        ) {
          const refreshed = await regenerateLegalDocxBase64(
            currentDocument.template,
            content,
            legalMetadata?.legalData,
          );
          if (refreshed) {
            docxBase64 = refreshed;
          }
        }

        const updatedDoc: GeneratedDocument = {
          ...currentDocument,
          title,
          content,
          citations,
          docxBase64,
          ...(legalSectionsSnapshot !== undefined
            ? { sections: legalSectionsSnapshot }
            : {}),
          ...(legalMetadata !== undefined ? { metadata: legalMetadata } : {}),
          lastEdited: 'Just now',
        };

        setGeneratedDocuments(prev =>
          prev.map(doc => doc.id === currentDocument.id ? updatedDoc : doc)
        );
        setCurrentDocument(updatedDoc);
      }
    } catch (err) {
      console.error('Error saving document:', err);
    }
  };

  const handleBackToHome = () => {
    setCurrentView('home');
    setCurrentDocument(null);
    setChatInitialMessage(undefined);
    setError(null);
  };

  if (isLoading) {
    return (
      <LegalGeneratorTheme>
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2
              className="w-8 h-8 animate-spin"
              style={{ color: "var(--accent)" }}
            />
            <p style={{ color: "var(--ink-3)" }}>Loading documents…</p>
          </div>
        </div>
      </LegalGeneratorTheme>
    );
  }

  if (error && currentView === 'home') {
    return (
      <LegalGeneratorTheme>
        <div className="flex h-full items-center justify-center">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <p style={{ color: "var(--danger)" }}>{error}</p>
            <button
              onClick={() => void fetchDocuments()}
              className={legalTheme.btn + " " + legalTheme.btnOutline}
            >
              Try again
            </button>
          </div>
        </div>
      </LegalGeneratorTheme>
    );
  }

  if (currentView === 'editor' && currentDocument) {
    const templateId = currentDocument.template;
    const resolvedFields = templateId
      ? (TEMPLATE_REGISTRY[templateId]?.fields ?? [])
      : [];
    const legalSections = getLegalSectionsForDocument(currentDocument);
    const useLegalEditor =
      shouldOpenAsLegalEditor(currentDocument) &&
      resolvedFields.length > 0 &&
      legalSections.length > 0;

    if (useLegalEditor) {
      return (
        <LegalGeneratorTheme ambient={false}>
          <LegalDocumentEditor
            initialTitle={currentDocument.title}
            sections={legalSections}
            templateId={currentDocument.template}
            documentId={parseInt(currentDocument.id)}
            templateFields={resolvedFields}
            onBack={handleBackToHome}
            onSave={(title, content, editorSections) =>
              void handleSaveDocument(title, content, undefined, editorSections)
            }
          />
        </LegalGeneratorTheme>
      );
    }

    return (
      <LegalGeneratorTheme ambient={false}>
        <DocumentGeneratorEditor
          initialTitle={currentDocument.title}
          initialContent={currentDocument.content}
          initialCitations={currentDocument.citations}
          documentId={parseInt(currentDocument.id)}
          onBack={handleBackToHome}
          onSave={handleSaveDocument}
          docxBase64={currentDocument.docxBase64}
        />
      </LegalGeneratorTheme>
    );
  }

  if (currentView === 'chat') {
    return (
      <LegalGeneratorTheme>
        <LegalChatbot
          onBack={handleBackToHome}
          onContinueToTemplateForm={handleChatProceedToTemplateForm}
          initialMessage={chatInitialMessage}
        />
      </LegalGeneratorTheme>
    );
  }

  return (
    <LegalGeneratorTheme>
      <DocumentGeneratorHome
        onNewDocument={handleNewDocument}
        onOpenDocument={handleOpenDocument}
        onStartChat={handleStartChat}
        generatedDocuments={generatedDocuments}
      />
    </LegalGeneratorTheme>
  );
}
