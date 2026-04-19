"use client";

/**
 * Legal document flow (intended pipeline):
 * 1. Home — pick a template from the library, or open the legal assistant (chat).
 * 2. Chat (optional) — assistant recommends a template and collects field values.
 * 3. Template form — LegalDocumentConfig + TEMPLATE_REGISTRY validation (always after chat).
 * 4. Document — save + LegalDocumentEditor (highlighted fields, docx, etc.).
 */

import { useState, useEffect, useCallback } from 'react';
import { DocumentGeneratorHome, type DocumentTemplate } from './DocumentGeneratorHome';
import { LegalDocumentConfig } from './LegalDocumentConfig';
import { LegalDocumentEditor } from './LegalDocumentEditor';
import { DocumentGeneratorEditor } from './DocumentGeneratorEditor';
import { LegalChatbot } from './LegalChatbot';
import { Loader2 } from 'lucide-react';
import type { Citation } from './generator';
import { TEMPLATE_REGISTRY, type TemplateField } from '~/lib/legal-templates/template-registry';
import type { EditorSection } from '~/lib/legal-templates/section-builders';
import { parseLegalDocumentHtmlToSections } from '~/lib/legal-templates/html-to-sections';
import {
  buildTemplateFieldDataForDocx,
  extractFieldValuesFromSections,
} from '~/lib/legal-templates/legal-document-validation';

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
  const [currentView, setCurrentView] = useState<'home' | 'config' | 'editor' | 'chat'>('home');
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [currentDocument, setCurrentDocument] = useState<GeneratedDocument | null>(null);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legalFieldErrors, setLegalFieldErrors] = useState<Record<string, string>>({});
  const [chatInitialMessage, setChatInitialMessage] = useState<string | undefined>(undefined);
  const [prefilledData, setPrefilledData] = useState<Record<string, string> | undefined>(undefined);
  /** Remount LegalDocumentConfig when template/prefill changes; bump when entering config. */
  const [legalConfigNonce, setLegalConfigNonce] = useState(0);
  /** Whether the field form was opened from chat (back returns to assistant) vs template library. */
  const [configSource, setConfigSource] = useState<'home' | 'chat' | null>(null);

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

  const handleNewDocument = (template: DocumentTemplate) => {
    setError(null);
    setLegalFieldErrors({});
    setPrefilledData(undefined);
    setConfigSource('home');
    setLegalConfigNonce((n) => n + 1);
    setSelectedTemplate(template);
    setCurrentView('config');
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
    setSelectedTemplate(template);
    setPrefilledData(prefilled);
    setLegalFieldErrors({});
    setError(null);
    setConfigSource('chat');
    setLegalConfigNonce((n) => n + 1);
    setCurrentView('config');
  };

  const handleLegalGenerate = async (formData: Record<string, string>, templateOverride?: DocumentTemplate) => {
    const template = templateOverride ?? selectedTemplate;
    if (!template) return;

    setIsSaving(true);
    setError(null);
    setLegalFieldErrors({});

    try {
      const legalResponse = await fetch('/api/document-generator/legal-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          data: formData,
          format: 'json',
        }),
      });

      const legalData = await legalResponse.json() as {
        success: boolean;
        error?: string;
        details?: string[];
        fieldErrors?: Record<string, string>;
        title?: string;
        sections?: EditorSection[];
        docxBase64?: string;
        filename?: string;
      };

      if (legalResponse.status === 422) {
        setCurrentView('config');
        setLegalFieldErrors(legalData.fieldErrors ?? {});
        setError('Please fill in all required fields before generating the document.');
        return;
      }

      if (!legalData.success) {
        setError(legalData.error ?? 'Failed to generate legal document');
        return;
      }

      const sections = legalData.sections ?? [];
      const htmlContent = sections
        .map((s) => {
          if (s.type === 'title') return `<h1>${s.content}</h1>`;
          if (s.type === 'heading') return `<h2>${s.content}</h2>`;
          return `<p>${s.content}</p>`;
        })
        .join('\n');

      const response = await fetch('/api/document-generator/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: legalData.title ?? template.name,
          content: htmlContent,
          templateId: template.id,
          metadata: {
            templateType: 'legal',
            legalData: formData,
            legalSections: sections,
          },
        }),
      });

      const data = await response.json() as { success: boolean; message?: string; document?: { id: number } };

      if (data.success && data.document) {
        const newDoc: GeneratedDocument = {
          id: data.document.id.toString(),
          title: legalData.title ?? template.name,
          template: template.id,
          lastEdited: 'Just now',
          content: htmlContent,
          docxBase64: legalData.docxBase64,
          sections,
          metadata: {
            templateType: 'legal',
            legalData: formData,
            legalSections: sections,
          },
        };

        setCurrentDocument(newDoc);
        setGeneratedDocuments((prev) => [newDoc, ...prev]);
        setPrefilledData(undefined);
        setConfigSource(null);
        setCurrentView('editor');
      } else {
        setError(data.message ?? 'Failed to save legal document');
      }
    } catch (err) {
      console.error('Error generating legal document:', err);
      setError('Failed to generate legal document');
    } finally {
      setIsSaving(false);
    }
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
    setSelectedTemplate(null);
    setLegalFieldErrors({});
    setPrefilledData(undefined);
    setChatInitialMessage(undefined);
    setError(null);
    setConfigSource(null);
  };

  const handleLegalConfigBack = () => {
    if (configSource === 'chat') {
      setCurrentView('chat');
      setConfigSource(null);
      return;
    }
    handleBackToHome();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-muted-foreground">Loading documents...</p>
        </div>
      </div>
    );
  }

  if (error && currentView === 'home') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <p className="text-red-500">{error}</p>
          <button 
            onClick={() => void fetchDocuments()}
            className="text-blue-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
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
        <div className="h-full">
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
        </div>
      );
    }

    return (
      <div className="h-full">
        <DocumentGeneratorEditor
          initialTitle={currentDocument.title}
          initialContent={currentDocument.content}
          initialCitations={currentDocument.citations}
          documentId={parseInt(currentDocument.id)}
          onBack={handleBackToHome}
          onSave={handleSaveDocument}
          docxBase64={currentDocument.docxBase64}
        />
      </div>
    );
  }

  if (currentView === 'chat') {
    return (
      <div className="h-full">
        <LegalChatbot
          onBack={handleBackToHome}
          onContinueToTemplateForm={handleChatProceedToTemplateForm}
          initialMessage={chatInitialMessage}
        />
      </div>
    );
  }

  if (currentView === 'config' && selectedTemplate) {
    if (selectedTemplate.isLegal && selectedTemplate.fields) {
      return (
        <div className="h-full">
          <LegalDocumentConfig
            key={`${selectedTemplate.id}-${legalConfigNonce}`}
            template={selectedTemplate as DocumentTemplate & { isLegal: true; fields: TemplateField[] }}
            onBack={handleLegalConfigBack}
            onGenerate={(data) => void handleLegalGenerate(data)}
            isGenerating={isSaving}
            serverErrors={legalFieldErrors}
            globalError={error}
            initialData={prefilledData}
            backButtonLabel={
              configSource === 'chat' ? 'Back to assistant' : 'Back to templates'
            }
            flowHint={
              configSource === 'chat'
                ? 'Assistant pre-filled these fields. Review required items, then generate — your document opens next for editing and export.'
                : undefined
            }
          />
        </div>
      );
    }
  }

  return (
    <div className="h-full">
      <DocumentGeneratorHome
        onNewDocument={handleNewDocument}
        onOpenDocument={handleOpenDocument}
        onStartChat={handleStartChat}
        generatedDocuments={generatedDocuments}
      />
    </div>
  );
}
