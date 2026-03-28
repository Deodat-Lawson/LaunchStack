"use client";

import { useState, useEffect, useCallback } from 'react';
import { DocumentGeneratorHome, type DocumentTemplate } from './DocumentGeneratorHome';
import { LegalDocumentConfig } from './LegalDocumentConfig';
import { LegalDocumentEditor } from './LegalDocumentEditor';
import { DocumentGeneratorEditor } from './DocumentGeneratorEditor';
import { LegalChatbot } from './LegalChatbot';
import { Loader2 } from 'lucide-react';
import type { Citation } from './generator';
import type { TemplateField } from '~/lib/legal-templates/template-registry';
import { TEMPLATE_REGISTRY } from '~/lib/legal-templates/template-registry';
import type { EditorSection } from '~/lib/legal-templates/section-builders';

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
    setSelectedTemplate(template);
    setCurrentView('config');
  };

  const handleStartChat = (initialMessage?: string) => {
    setError(null);
    setChatInitialMessage(initialMessage);
    setCurrentView('chat');
  };

  const handleChatGenerate = (templateId: string, data: Record<string, string>) => {
    const registryTemplate = TEMPLATE_REGISTRY[templateId];
    if (!registryTemplate) return;

    // Build a DocumentTemplate to reuse the existing generate flow
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
    void handleLegalGenerate(data, template);
  };

  const handleChatReviewFields = (templateId: string, prefilled: Record<string, string>) => {
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
          },
        }),
      });

      const data = await response.json() as { success: boolean; message?: string; document?: { id: number } };

      if (data.success && data.document) {
        const newDoc: GeneratedDocument = {
          id: data.document.id.toString(),
          title: legalData.title ?? template.name,
          template: template.name,
          lastEdited: 'Just now',
          content: htmlContent,
          docxBase64: legalData.docxBase64,
          sections,
          metadata: {
            templateType: 'legal',
            legalData: formData,
          },
        };

        setCurrentDocument(newDoc);
        setGeneratedDocuments((prev) => [newDoc, ...prev]);
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
    setCurrentDocument(document);
    setCurrentView('editor');
  };

  const handleSaveDocument = async (title: string, content: string, citations?: Citation[]) => {
    if (!currentDocument) return;

    try {
      const response = await fetch('/api/document-generator/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: parseInt(currentDocument.id),
          title,
          content,
          citations,
        }),
      });

      const data = await response.json() as { success: boolean };
      
      if (data.success) {
        const updatedDoc: GeneratedDocument = {
          ...currentDocument,
          title,
          content,
          citations,
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
    const isLegal = currentDocument.metadata?.templateType === 'legal';

    if (isLegal && currentDocument.sections && currentDocument.sections.length > 0) {
      return (
        <div className="h-full">
          <LegalDocumentEditor
            initialTitle={currentDocument.title}
            sections={currentDocument.sections}
            docxBase64={currentDocument.docxBase64}
            documentId={parseInt(currentDocument.id)}
            onBack={handleBackToHome}
            onSave={(title, content) => void handleSaveDocument(title, content)}
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
          onGenerate={handleChatGenerate}
          onReviewFields={handleChatReviewFields}
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
            template={selectedTemplate as DocumentTemplate & { isLegal: true; fields: TemplateField[] }}
            onBack={handleBackToHome}
            onGenerate={(data) => void handleLegalGenerate(data)}
            isGenerating={isSaving}
            serverErrors={legalFieldErrors}
            globalError={error}
            initialData={prefilledData}
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
