"use client";
import { type Document } from "../page";
import { FileText, Image as ImageIcon, FileType, ExternalLink, Download } from "lucide-react";

interface DocumentViewerProps {
  document: Document | null;
  isDark?: boolean;
}

export function DocumentViewer({ document, isDark = false }: DocumentViewerProps) {
  if (!document) {
    return (
      <div className={`h-full flex items-center justify-center ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
        <div className={`text-center ${isDark ? 'text-gray-400' : 'text-gray-400'}`}>
          <FileText className="w-16 h-16 mx-auto mb-4" />
          <p>Select a document to view</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${isDark ? 'bg-gray-950' : 'bg-gray-900'}`}>
      {/* Document Toolbar */}
      <div className={`px-4 py-2 flex items-center justify-between border-b ${
        isDark ? 'bg-gray-900 border-gray-800' : 'bg-gray-800 border-gray-700'
      }`}>
        <div className="flex items-center gap-3 text-white text-sm">
          <FileText className="w-4 h-4" />
          <span>{document.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {document.url && (
            <>
              <a
                href={document.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
              <a
                href={document.url}
                download={document.name}
                className="text-gray-300 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
                title="Download"
              >
                <Download className="w-4 h-4" />
              </a>
            </>
          )}
        </div>
      </div>

      {/* Document Content */}
      <div className={`flex-1 overflow-hidden flex items-stretch justify-center ${isDark ? 'bg-gray-900' : 'bg-gray-800'}`}>
        {document.type === "pdf" ? (
          document.url ? (
            <iframe
              src={document.url}
              className="w-full h-full border-0"
              title={document.name}
            />
          ) : (
            <div className="flex items-center justify-center text-gray-400">
              <div className="text-center">
                <FileText className="w-16 h-16 mx-auto mb-4" />
                <p>PDF URL not available</p>
              </div>
            </div>
          )
        ) : document.type === "image" ? (
          <div className="flex-1 overflow-auto p-8 flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-2xl p-4 max-w-4xl">
              {document.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- Using img for user-uploaded dynamic images
                <img src={document.url} alt={document.name} className="w-full h-auto rounded" />
              ) : (
                <div className="flex items-center justify-center p-12 text-gray-400">
                  <ImageIcon className="w-16 h-16" />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-8 flex items-center justify-center">
            <div className="bg-white rounded-lg shadow-2xl p-8 max-w-4xl w-full">
              <div className="flex items-center gap-3 mb-4 text-gray-600">
                <FileType className="w-5 h-5" />
                <span>{document.name}</span>
              </div>
              <div className="text-gray-700 whitespace-pre-wrap">
                {document.url ? (
                  <iframe
                    src={document.url}
                    className="w-full min-h-[400px] border rounded"
                    title={document.name}
                  />
                ) : (
                  "Text content not available"
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
