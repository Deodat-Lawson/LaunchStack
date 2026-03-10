"use client";

import { useState, useEffect, useCallback } from "react";
import { Upload, X, FileText, CheckCircle, Loader2, Plus, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "./ui/utils";
import { UploadDropzone } from "~/app/utils/uploadthing";
import { useAuth } from "@clerk/nextjs";

interface UploadDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete: (document: {
    id: string;
    name: string;
    url: string;
    category: string;
  }) => void;
  isDark?: boolean;
}

interface CategoryFromDB {
  id: number;
  name: string;
  companyId: number;
}

export function UploadDocumentModal({ 
  isOpen, 
  onClose, 
  onUploadComplete,
  isDark = false 
}: UploadDocumentModalProps) {
  const { userId } = useAuth();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [category, setCategory] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [categories, setCategories] = useState<CategoryFromDB[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [enableOCR, setEnableOCR] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setIsLoadingCategories(true);
    try {
      const response = await fetch("/api/Categories/GetCategories");
      if (response.ok) {
        const data = await response.json() as CategoryFromDB[];
        setCategories(data);
        // Set default category to first one if available
        if (data.length > 0 && !category) {
          setCategory(data[0]?.name ?? "");
        }
      }
    } catch (err) {
      console.error("Error fetching categories:", err);
    } finally {
      setIsLoadingCategories(false);
    }
  }, [category]);

  // Fetch categories from database when modal opens
  useEffect(() => {
    if (isOpen) {
      void fetchCategories();
    }
  }, [isOpen, fetchCategories]);

  // Auto-populate document title from filename
  useEffect(() => {
    if (fileName && !documentTitle) {
      const nameWithoutExtension = fileName.replace(/\.[^/.]+$/, "");
      setDocumentTitle(nameWithoutExtension);
    }
  }, [fileName, documentTitle]);

  const handleAddCustomCategory = async () => {
    if (!customCategory.trim()) return;
    
    // Check if category already exists
    if (categories.some(c => c.name.toLowerCase() === customCategory.trim().toLowerCase())) {
      setCategory(customCategory.trim());
      setCustomCategory("");
      setIsAddingCategory(false);
      return;
    }

    setIsSavingCategory(true);
    try {
      const response = await fetch("/api/Categories/AddCategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CategoryName: customCategory.trim() }),
      });

      if (response.ok) {
        const data = await response.json() as { success: boolean; id: { id: number }; name: string };
        const newCategory: CategoryFromDB = {
          id: data.id?.id ?? Date.now(),
          name: data.name,
          companyId: 0, // Will be set by the server
        };
        setCategories(prev => [...prev, newCategory]);
        setCategory(data.name);
        setCustomCategory("");
        setIsAddingCategory(false);
      } else {
        setError("Failed to create category");
      }
    } catch (err) {
      console.error("Error adding category:", err);
      setError("Failed to create category");
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleUpload = async () => {
    if (!fileUrl || !userId) return;

    setIsProcessing(true);
    setError(null);

    // Use filename if no custom title provided
    const finalTitle = documentTitle.trim() || fileName.replace(/\.[^/.]+$/, "");

    try {
      const response = await fetch("/api/uploadDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          documentName: finalTitle,
          category: category,
          documentUrl: fileUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error ?? "Failed to process document");
      }

      const data = await response.json() as { 
        document: { 
          id: number; 
          title: string; 
          url: string; 
          category: string; 
        } 
      };
      
      setUploadSuccess(true);

      // Notify parent of the new document
      onUploadComplete({
        id: data.document.id.toString(),
        name: data.document.title,
        url: data.document.url,
        category: data.document.category,
      });

      // Auto close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      console.error("Error uploading document:", err);
      setError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setFileUrl(null);
    setFileName("");
    setCategory(categories[0]?.name ?? "");
    setDocumentTitle("");
    setCustomCategory("");
    setIsAddingCategory(false);
    setUploadSuccess(false);
    setIsUploading(false);
    setIsProcessing(false);
    setEnableOCR(false);
    setError(null);
    onClose();
  };

  const handleRemoveFile = () => {
    setFileUrl(null);
    setFileName("");
    setDocumentTitle("");
    setUploadSuccess(false);
    setError(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className={cn(
        "sm:max-w-[550px]",
        isDark ? "bg-gray-900 border-gray-700" : "bg-white"
      )}>
        <DialogHeader>
          <DialogTitle className={cn(
            "flex items-center gap-2",
            isDark && "text-white"
          )}>
            <Upload className="w-5 h-5 text-purple-600" />
            Upload Document
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload Area */}
          {!fileUrl ? (
            <UploadDropzone
              endpoint="anyUploader"
              onUploadBegin={() => setIsUploading(true)}
              onClientUploadComplete={(res) => {
                setIsUploading(false);
                if (!res?.length) return;
                const uploadedFile = res[0];
                if (uploadedFile) {
                  setFileUrl(uploadedFile.url);
                  setFileName(uploadedFile.name);
                }
              }}
              onUploadError={(error) => {
                setIsUploading(false);
                console.error("Upload Error:", error);
                setError(error.message ?? "Failed to upload file");
              }}
              className={cn(
                "ut-button:bg-purple-600 ut-button:hover:bg-purple-700",
                "ut-label:text-gray-600 dark:ut-label:text-gray-300",
                "ut-allowed-content:text-gray-500",
                isDark && "bg-gray-800"
              )}
            />
          ) : (
            <div className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center",
              isDark 
                ? "border-purple-600 bg-purple-900/10" 
                : "border-purple-600 bg-purple-50"
            )}>
              <div className="space-y-2">
                <FileText className="w-12 h-12 text-purple-600 mx-auto" />
                <p className={cn(
                  "font-medium",
                  isDark ? "text-gray-300" : "text-gray-700"
                )}>
                  {fileName}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveFile}
                  className="mt-2"
                >
                  <X className="w-4 h-4 mr-2" />
                  Remove
                </Button>
              </div>
            </div>
          )}

          {/* Document Title */}
          <div className="space-y-2">
            <Label htmlFor="document-title" className={isDark ? "text-gray-300" : ""}>
              Document Title
            </Label>
            <Input
              id="document-title"
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e.target.value)}
              placeholder={fileName ? fileName.replace(/\.[^/.]+$/, "") : "Enter document title"}
              className={isDark ? "bg-gray-800 border-gray-700 text-white" : ""}
            />
            <p className={cn(
              "text-xs",
              isDark ? "text-gray-400" : "text-gray-500"
            )}>
              Leave empty to use the original filename
            </p>
          </div>

          {/* Category Selection */}
          <div className="space-y-2">
            <Label htmlFor="category" className={isDark ? "text-gray-300" : ""}>
              Category
            </Label>
            {!isAddingCategory ? (
              <div className="flex gap-2">
                <Select value={category} onValueChange={setCategory} disabled={isLoadingCategories}>
                  <SelectTrigger 
                    id="category" 
                    className={cn(
                      "flex-1",
                      isDark && "bg-gray-800 border-gray-700 text-white"
                    )}
                  >
                    <SelectValue placeholder={isLoadingCategories ? "Loading..." : "Select category"} />
                  </SelectTrigger>
                  <SelectContent className={cn(
                    "z-[100]",
                    isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                  )}>
                    {categories.map((cat) => (
                      <SelectItem 
                        key={cat.id} 
                        value={cat.name}
                        className={isDark ? "text-gray-300 focus:bg-gray-700" : "focus:bg-gray-100"}
                      >
                        {cat.name}
                      </SelectItem>
                    ))}
                    {categories.length === 0 && !isLoadingCategories && (
                      <div className={cn(
                        "px-2 py-4 text-center text-sm",
                        isDark ? "text-gray-400" : "text-gray-500"
                      )}>
                        No categories found. Add one below.
                      </div>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setIsAddingCategory(true)}
                  title="Add custom category"
                  className={isDark ? "border-gray-700 hover:bg-gray-800" : ""}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="Enter category name"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddCustomCategory();
                    } else if (e.key === "Escape") {
                      setIsAddingCategory(false);
                      setCustomCategory("");
                    }
                  }}
                  autoFocus
                  disabled={isSavingCategory}
                  className={cn(
                    "flex-1",
                    isDark && "bg-gray-800 border-gray-700 text-white"
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void handleAddCustomCategory()}
                  disabled={!customCategory.trim() || isSavingCategory}
                  title="Save category"
                  className={isDark ? "border-gray-700 hover:bg-gray-800" : ""}
                >
                  {isSavingCategory ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setIsAddingCategory(false);
                    setCustomCategory("");
                  }}
                  disabled={isSavingCategory}
                  title="Cancel"
                  className={isDark ? "border-gray-700 hover:bg-gray-800" : ""}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
            {isAddingCategory && (
              <p className={cn(
                "text-xs",
                isDark ? "text-gray-400" : "text-gray-500"
              )}>
                Press Enter to add or Escape to cancel
              </p>
            )}
          </div>

          {/* OCR Option */}
          <div className={cn(
            "flex items-center gap-3 p-3 rounded-lg border",
            isDark 
              ? "bg-gray-800 border-gray-700" 
              : "bg-gray-50 border-gray-200"
          )}>
            <input
              type="checkbox"
              id="enable-ocr"
              checked={enableOCR}
              onChange={(e) => setEnableOCR(e.target.checked)}
              className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500 cursor-pointer"
            />
            <div className="flex-1">
              <label 
                htmlFor="enable-ocr" 
                className={cn(
                  "text-sm font-medium cursor-pointer",
                  isDark ? "text-gray-300" : "text-gray-700"
                )}
              >
                Enable OCR Processing
              </label>
              <p className={cn(
                "text-xs",
                isDark ? "text-gray-400" : "text-gray-500"
              )}>
                Extract text from scanned documents using advanced OCR
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <X className="w-5 h-5 text-red-600" />
              <span className="text-sm text-red-700 dark:text-red-300">
                {error}
              </span>
            </div>
          )}

          {/* Upload Status */}
          {uploadSuccess && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-sm text-green-700 dark:text-green-300">
                Document uploaded successfully!
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button 
            variant="outline" 
            onClick={handleClose} 
            disabled={isUploading || isProcessing}
            className={isDark ? "border-gray-700 hover:bg-gray-800" : ""}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!fileUrl || !category || isUploading || isProcessing}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading file...
              </>
            ) : isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload & Process
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
