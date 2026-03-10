"use client";
import { useState } from "react";
import type { Document } from "../page";
import { Search, Upload, ChevronDown, ChevronRight, FileText, GraduationCap, X } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { DarkModeToggle } from "./DarkModeToggle";
import { UploadDocumentModal } from "./UploadDocumentModal";

interface SidebarProps {
  documents: Document[];
  selectedDocument: Document | null;
  onSelectDocument: (doc: Document) => void;
  onDocumentUploaded?: (doc: Document) => void;
  isDark?: boolean;
  onToggleDark?: () => void;
  onCloseSidebar?: () => void;
}

export function Sidebar({
  documents,
  selectedDocument,
  onSelectDocument,
  onDocumentUploaded,
  isDark = false,
  onToggleDark,
  onCloseSidebar,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<string[]>(["test", "Culture of Engineering Profession"]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const toggleFolder = (folder: string) => {
    setExpandedFolders((prev) =>
      prev.includes(folder) ? prev.filter((f) => f !== folder) : [...prev, folder]
    );
  };

  // Group documents by folder
  const folders = documents.reduce((acc: Record<string, Document[]>, doc: Document) => {
    const folder = doc.folder ?? "Uncategorized";
    acc[folder] ??= [];
    acc[folder].push(doc);
    return acc;
  }, {} as Record<string, Document[]>);

  const filteredDocuments = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUploadComplete = (uploadedDoc: { id: string; name: string; url: string; category: string }) => {
    const newDoc: Document = {
      id: uploadedDoc.id,
      name: uploadedDoc.name,
      type: "pdf",
      url: uploadedDoc.url,
      folder: uploadedDoc.category,
      uploadedAt: new Date(),
    };
    
    if (onDocumentUploaded) {
      onDocumentUploaded(newDoc);
    }
  };

  return (
    <>
      <div className={`h-full border-r flex flex-col ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className={isDark ? 'text-purple-400' : 'text-purple-600'}>AI Teacher</span>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-9 h-9 ${isDark ? 'bg-gray-800 border-gray-700 text-white' : ''}`}
            />
          </div>
        </div>

        {/* Upload Button */}
        <div className={`p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <Button
            variant="outline"
            onClick={() => setIsUploadModalOpen(true)}
            className={`w-full justify-start gap-2 ${
              isDark 
                ? 'text-purple-400 border-gray-700 hover:bg-gray-800' 
                : 'text-purple-600 border-purple-200 hover:bg-purple-50'
            }`}
          >
            <Upload className="w-4 h-4" />
            Upload Material
          </Button>
        </div>

        {/* Documents List */}
        <div className="flex-1 overflow-y-auto p-2">
          {searchQuery ? (
            // Show filtered results
            <div className="space-y-1">
              {filteredDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => onSelectDocument(doc)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    selectedDocument?.id === doc.id 
                      ? isDark 
                        ? "bg-purple-900/30 text-purple-300" 
                        : "bg-purple-50 text-purple-700"
                      : isDark
                        ? "text-gray-300 hover:bg-gray-800"
                        : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <FileText className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{doc.name}</span>
                </button>
              ))}
            </div>
          ) : (
            // Show folder structure
            <div className="space-y-2">
              {Object.entries(folders).map(([folder, docs]) => {
                const isExpanded = expandedFolders.includes(folder);
                return (
                  <div key={folder}>
                    <button
                      onClick={() => toggleFolder(folder)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                        isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                      }`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                      <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{folder}</span>
                    </button>
                    {isExpanded && (
                      <div className="ml-4 space-y-1 mt-1">
                        {docs.map((doc) => (
                          <button
                            key={doc.id}
                            onClick={() => onSelectDocument(doc)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left group ${
                              selectedDocument?.id === doc.id
                                ? isDark
                                  ? "bg-purple-900/30 text-purple-300"
                                  : "bg-purple-50 text-purple-700"
                                : isDark
                                  ? "text-gray-400 hover:bg-gray-800"
                                  : "text-gray-600 hover:bg-gray-100"
                            }`}
                          >
                            <FileText className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate flex-1">{doc.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-4 border-t space-y-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          {onToggleDark && (
            <DarkModeToggle
              isDark={isDark}
              onToggle={onToggleDark}
            />
          )}
          {onCloseSidebar && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCloseSidebar}
              className={`w-full justify-start gap-2 ${
                isDark 
                  ? 'text-gray-400 border-gray-700 hover:bg-gray-800' 
                  : 'text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <X className="w-4 h-4" />
              Close Sidebar
            </Button>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadComplete={handleUploadComplete}
        isDark={isDark}
      />
    </>
  );
}
