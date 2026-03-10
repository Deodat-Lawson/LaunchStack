"use client";

import React, { useEffect, useState } from 'react';
import { FileText, FileImage, FileSpreadsheet, FileCode, Loader2, AlertTriangle, RotateCw, Presentation } from 'lucide-react';
import type { DocumentType } from '../types';
import { getDocumentDisplayType, type DocumentDisplayType } from '../types/document';
import { DocxViewer } from './DocxViewer';
import { XlsxViewer } from './XlsxViewer';
import { PptxViewer } from './PptxViewer';
import { ImageViewer } from './ImageViewer';

interface DocumentViewerProps {
  document: DocumentType | null;
  pdfPageNumber?: number;
  setPdfPageNumber?: (page: number) => void;
  hideActions?: boolean;
  minimal?: boolean;
  isCollapsed?: boolean;
}

export const DISPLAY_TYPE_LABELS: Record<DocumentDisplayType, string> = {
  pdf: "PDF",
  image: "Image",
  docx: "Word",
  xlsx: "Spreadsheet",
  pptx: "Presentation",
  text: "Text / HTML",
  unknown: "File",
};

export const DISPLAY_TYPE_ICONS: Record<DocumentDisplayType, React.ElementType> = {
  pdf: FileText,
  image: FileImage,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  text: FileCode,
  unknown: FileText,
};

/** Wrapper that shows a loading spinner and error state around an iframe */
function IframeWithState({
  src,
  title,
  iframeKey,
}: {
  src: string;
  title: string;
  iframeKey?: string | number;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Reset states when src changes
  useEffect(() => {
    setLoading(true);
    setError(false);
  }, [src]);

  return (
    <div className="relative w-full h-full">
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-muted/30">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
          <p className="text-sm text-muted-foreground font-medium">Loading...</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center z-10 bg-muted/30">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Failed to load document</p>
            <p className="text-xs text-muted-foreground mb-4">The document could not be displayed.</p>
            <button
              onClick={() => { setLoading(true); setError(false); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
            >
              <RotateCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      )}
      <iframe
        key={iframeKey}
        src={src}
        className="w-full h-full border-0"
        title={title}
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
      />
    </div>
  );
}

export function DocumentViewer({ 
  document, 
  pdfPageNumber = 1, 
  setPdfPageNumber: _setPdfPageNumber,
  hideActions: _hideActions = false,
  minimal = false,
  isCollapsed = false
}: DocumentViewerProps) {
  
  // Track document view
  useEffect(() => {
    if (document?.id && !isCollapsed) {
      const trackView = async () => {
        try {
          await fetch('/api/documents/track-view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId: document.id }),
          });
        } catch (error) {
          console.error('Failed to track document view:', error);
        }
      };
      
      void trackView();
    }
  }, [document?.id, isCollapsed]);

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center py-4 bg-muted/20 h-full border-l border-border animate-in fade-in duration-300">
        <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-4 shadow-sm">
          <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="flex-1 flex items-center justify-center [writing-mode:vertical-rl] text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-50">
          Document Preview
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-muted/30 h-full p-8 text-center animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-muted rounded-3xl flex items-center justify-center mb-6 shadow-sm">
          <FileText className="w-10 h-10 text-muted-foreground/30" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">No Document Selected</h3>
        <p className="text-muted-foreground max-w-xs text-sm font-medium">
          Select a document from the sidebar to view its content and start your analysis.
        </p>
      </div>
    );
  }

  const displayType = getDocumentDisplayType(document);
  const DisplayIcon = DISPLAY_TYPE_ICONS[displayType];
  const getPdfSrcWithPage = (url: string, page: number) => `${url}#page=${page}`;

  const renderContent = () => {
    switch (displayType) {
      case "pdf":
        return (
          <IframeWithState
            iframeKey={`${document.id}-${pdfPageNumber}`}
            src={getPdfSrcWithPage(document.url, pdfPageNumber)}
            title={document.title}
          />
        );
      case "image":
        return <ImageViewer src={document.url} alt={document.title} minimal={minimal} />;
      case "docx":
        return <DocxViewer url={document.url} title={document.title} />;
      case "xlsx":
        return <XlsxViewer url={document.url} title={document.title} />;
      case "pptx":
        return <PptxViewer url={document.url} title={document.title} />;
      case "text":
        return (
          <IframeWithState
            iframeKey={document.id}
            src={document.url}
            title={document.title}
          />
        );
      case "unknown":
      default:
        // Graceful fallback: try iframe (browsers handle PDFs, images, text natively)
        return (
          <IframeWithState
            iframeKey={document.id}
            src={document.url}
            title={document.title}
          />
        );
    }
  };

  return (
    <div className="flex flex-col bg-background h-full overflow-hidden transition-all duration-300">
      {/* Document Header - Clean and minimal */}
      {!minimal && (
        <div className="bg-background border-b border-border px-6 py-3 flex-shrink-0 z-10">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-purple-100 dark:bg-purple-900/30 rounded">
                  <DisplayIcon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <h1 className="text-sm font-semibold truncate text-foreground leading-none">
                  {document.title}
                </h1>
                <span className="px-1.5 py-0.5 bg-muted text-[10px] text-muted-foreground rounded capitalize font-medium">
                  {document.category}
                </span>
                <span className="px-1.5 py-0.5 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-[10px] rounded font-medium">
                  {DISPLAY_TYPE_LABELS[displayType]}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
              <span>Browser Native Viewer</span>
            </div>
          </div>
        </div>
      )}

      {/* Document Content */}
      <div className="flex-1 relative bg-muted/30 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}


