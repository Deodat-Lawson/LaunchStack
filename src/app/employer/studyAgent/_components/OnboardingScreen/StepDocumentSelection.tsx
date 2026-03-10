"use client";

import React, { useState } from "react";
import { Upload, FileText, Search, FolderOpen, X, CheckCircle2 } from "lucide-react";
import type { Document } from "../../types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { UploadDocumentModal } from "../UploadDocumentModal";

interface StepDocumentSelectionProps {
  documents: Document[];
  selectedDocuments: string[];
  setSelectedDocuments: React.Dispatch<React.SetStateAction<string[]>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  selectedCategory: string;
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  onDocumentUploaded: (doc: Document) => void;
}

export const StepDocumentSelection: React.FC<StepDocumentSelectionProps> = ({
  documents,
  selectedDocuments,
  setSelectedDocuments,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  onDocumentUploaded,
}) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Get unique categories/folders
  const categories = ["all", ...new Set(documents.map(doc => doc.folder ?? "Uncategorized"))];

  // Filter documents based on search and category
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || doc.folder === selectedCategory || (!doc.folder && selectedCategory === "Uncategorized");
    return matchesSearch && matchesCategory;
  });

  const toggleDocument = (docId: string) => {
    setSelectedDocuments((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const selectAllFiltered = () => {
    const filteredIds = filteredDocuments.map(doc => doc.id);
    const allSelected = filteredIds.every(id => selectedDocuments.includes(id));
    
    if (allSelected) {
      setSelectedDocuments(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      const newSelection = [...new Set([...selectedDocuments, ...filteredIds])];
      setSelectedDocuments(newSelection);
    }
  };

  const handleUploadComplete = (uploadedDoc: { id: string; name: string; url: string; category: string }) => {
    const newDoc: Document = {
      id: uploadedDoc.id,
      name: uploadedDoc.name,
      type: "pdf",
      url: uploadedDoc.url,
      folder: uploadedDoc.category,
      uploadedAt: new Date(),
    };
    onDocumentUploaded(newDoc);
    // Auto-select the newly uploaded document
    setSelectedDocuments(prev => [...prev, newDoc.id]);
  };

  return (
    <>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl mb-2">Select Your Study Materials</h2>
          <p className="text-gray-600">
            Choose the documents you want to learn about
          </p>
        </div>

        {/* Upload Button */}
        <div>
          <Button
            variant="outline"
            onClick={() => setIsUploadModalOpen(true)}
            className="w-full justify-start gap-2 h-12 border-2 border-dashed border-purple-300 text-purple-600 hover:bg-purple-50"
          >
            <Upload className="w-5 h-5" />
            Upload New Document
          </Button>
        </div>

        {/* Search and Filter */}
        <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search by document name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="flex-1 h-10 px-3 rounded-md border border-gray-200 bg-white text-sm"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category === "all" 
                    ? "All Categories" 
                    : category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
            {selectedCategory !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedCategory("all")}
                className="h-10 px-3"
              >
                Clear
              </Button>
            )}
          </div>

          {/* Search Results Info */}
          {(searchQuery || selectedCategory !== "all") && (
            <div className="text-xs text-gray-600">
              {filteredDocuments.length === 0 ? (
                <span className="text-orange-600">No documents found</span>
              ) : (
                <span>
                  Showing {filteredDocuments.length} of {documents.length} document(s)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Document List */}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {filteredDocuments.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No documents found</p>
              <p className="text-xs mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            <>
              {/* Select All Button */}
              {filteredDocuments.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllFiltered}
                  className="w-full mb-2 h-9 text-xs"
                >
                  {filteredDocuments.every(doc => selectedDocuments.includes(doc.id))
                    ? "Deselect All"
                    : "Select All"} ({filteredDocuments.length})
                </Button>
              )}
              {filteredDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => toggleDocument(doc.id)}
                  className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                    selectedDocuments.includes(doc.id)
                      ? "border-purple-500 bg-purple-50"
                      : "border-gray-200 hover:border-purple-300"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      selectedDocuments.includes(doc.id)
                        ? "border-purple-500 bg-purple-500"
                        : "border-gray-300"
                    }`}
                  >
                    {selectedDocuments.includes(doc.id) && (
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <FileText className="w-5 h-5 text-gray-600 flex-shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="text-sm">{doc.name}</div>
                    {doc.folder && (
                      <div className="text-xs text-gray-500">{doc.folder}</div>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>

        {selectedDocuments.length > 0 && (
          <div className="text-sm text-purple-600 bg-purple-50 p-3 rounded-lg">
            {selectedDocuments.length} document(s) selected
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadComplete={handleUploadComplete}
        isDark={false}
      />
    </>
  );
};
