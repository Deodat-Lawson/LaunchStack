"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Upload, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { genUploader } from "uploadthing/client";
import type { OurFileRouter } from "~/app/api/uploadthing/core";
import { isUploadAccepted, UPLOAD_ACCEPT_STRING } from "~/lib/upload-accepted";

import { SourceGrid, type SourceType } from "./SourceGrid";
import { SourceDialog } from "./SourceDialog";
import { FileQueue } from "./FileQueue";
import { UploadSettings } from "./UploadSettings";

const { uploadFiles } = genUploader<OurFileRouter>();

import { DOCUMENT_LIMITS } from "~/lib/constants";

const MAX_FILE_SIZE = DOCUMENT_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;
const ZIP_ACCEPT_STRING = ".zip,application/zip";
const ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

interface DocumentFile {
  id: string;
  file: File;
  title: string;
  category: string;
  uploadDate: string;
  processingMethod: string;
  storageMethod: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
}

interface BatchSettings {
  category: string;
  processingMethod: string;
  uploadDate: string;
  storageMethod: string;
}

type DataTransferItemWithWebkitEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

export interface AvailableProviders {
  azure: boolean;
  datalab: boolean;
  landingAI: boolean;
  docling: boolean;
}

function uploadToS3WithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ objectKey: string; bucket: string; url: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/storage/upload", true);
    xhr.timeout = 10 * 60 * 1000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            objectKey: string;
            bucket: string;
            url: string;
          };
          resolve(data);
        } catch {
          reject(new Error("Invalid response from storage upload"));
        }
      } else if (xhr.status === 401) {
        reject(new Error("Authentication required — please sign in and try again"));
      } else if (xhr.status >= 500) {
        reject(new Error("Storage service error — please try again later"));
      } else {
        reject(new Error(`Upload to storage failed (HTTP ${xhr.status})`));
      }
    };

    xhr.ontimeout = () =>
      reject(new Error("Upload timed out — check your connection and try again"));
    xhr.onerror = () => reject(new Error("Storage service unavailable"));
    xhr.send(formData);
  });
}

interface UploadFormProps {
  categories: { id: string; name: string }[];
  useUploadThing: boolean;
  isUploadThingConfigured: boolean;
  onToggleUploadMethod: (useUploadThing: boolean) => Promise<void>;
  isUpdatingPreference: boolean;
  availableProviders: AvailableProviders;
  onAddCategory?: (newCategory: string) => Promise<void>;
  storageProvider: "s3" | "database";
  s3Endpoint: string;
  /**
   * Embedded mode suppresses the post-upload `router.push("/employer/documents")`
   * so the uploader can live inside the workspace (AddSourceModal) without
   * ripping the user out of context. `onCompleted` fires instead.
   */
  embedded?: boolean;
  onCompleted?: () => void;
}

const UploadForm: React.FC<UploadFormProps> = ({
  categories,
  useUploadThing,
  isUploadThingConfigured,
  onToggleUploadMethod,
  isUpdatingPreference,
  availableProviders,
  onAddCategory,
  storageProvider,
  s3Endpoint: _s3Endpoint,
  embedded = false,
  onCompleted,
}) => {
  const { userId } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [batchSettings, setBatchSettings] = useState<BatchSettings>({
    category: "",
    processingMethod: "standard",
    uploadDate: new Date().toISOString().split("T")[0]!,
    storageMethod: useUploadThing && isUploadThingConfigured ? "cloud" : "database",
  });
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeSource, setActiveSource] = useState<SourceType | null>(null);

  const hasAnyOCR =
    availableProviders.azure ||
    availableProviders.landingAI ||
    availableProviders.datalab ||
    availableProviders.docling;

  const processingMethods = [
    ...(hasAnyOCR
      ? [
          {
            value: "auto",
            label: "Auto",
            description: "Automatically select the best method based on document analysis.",
          },
        ]
      : []),
    { value: "standard", label: "Standard", description: "No OCR. Use for text-based PDFs." },
    ...(availableProviders.azure
      ? [{ value: "azure", label: "Azure OCR", description: "Azure Document Intelligence OCR" }]
      : []),
    ...(availableProviders.landingAI
      ? [{ value: "landing_ai", label: "Landing AI", description: "Multimodal AI processing" }]
      : []),
    ...(availableProviders.datalab
      ? [{ value: "datalab", label: "Datalab", description: "Advanced data extraction" }]
      : []),
    ...(availableProviders.docling
      ? [
          {
            value: "docling",
            label: "Docling",
            description: "Open-source document understanding via docling-serve",
          },
        ]
      : []),
  ];

  const defaultDoc = useCallback(
    (file: File): DocumentFile => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      title: file.name.replace(/\.[^/.]+$/, ""),
      category: batchSettings.category,
      uploadDate: batchSettings.uploadDate,
      processingMethod: batchSettings.processingMethod,
      storageMethod: batchSettings.storageMethod,
      status: "pending",
      progress: 0,
    }),
    [batchSettings],
  );

  const isZipFile = useCallback((file: File) => {
    const extension = file.name.toLowerCase().split(".").pop();
    const mimeType = file.type.toLowerCase();
    return extension === "zip" || ZIP_MIME_TYPES.has(mimeType);
  }, []);

  const validateAndAddFiles = useCallback(
    async (files: File[]) => {
      const validFiles: DocumentFile[] = [];
      let nonZipErrorCount = 0;
      let zipArchiveCount = 0;
      let zipOversizedCount = 0;
      let zipQueuedCount = 0;

      for (const file of files) {
        if (isZipFile(file)) {
          zipArchiveCount++;
          if (file.size > MAX_FILE_SIZE) {
            zipOversizedCount++;
            continue;
          }
          validFiles.push(defaultDoc(file));
          zipQueuedCount++;
          continue;
        }

        if (!isUploadAccepted({ name: file.name, type: file.type })) {
          nonZipErrorCount++;
          continue;
        }

        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} exceeds ${DOCUMENT_LIMITS.MAX_FILE_SIZE_MB}MB limit`);
          nonZipErrorCount++;
          continue;
        }

        validFiles.push(defaultDoc(file));
      }

      if (nonZipErrorCount > 0) {
        toast.error(`${nonZipErrorCount} file(s) were rejected`, {
          description: `Please upload PDF, DOCX, images (PNG, JPG, etc.), or audio (MP3, MP4) under ${DOCUMENT_LIMITS.MAX_FILE_SIZE_MB}MB`,
        });
      }

      if (zipArchiveCount > 0) {
        if (zipQueuedCount > 0) {
          toast.success("ZIP archive queued", {
            description: "Files will be auto-extracted and processed individually after upload.",
          });
        }
        if (zipOversizedCount > 0) {
          toast.error("ZIP archive rejected", {
            description: `${zipOversizedCount} ZIP file(s) exceeded the ${DOCUMENT_LIMITS.MAX_FILE_SIZE_MB}MB limit.`,
          });
        }
      }

      if (validFiles.length > 0) {
        setDocuments((prev) => [...prev, ...validFiles]);
        toast.success(`${validFiles.length} file(s) added to upload queue`);
        setErrors((prev) => {
          const next = { ...prev };
          delete next.files;
          return next;
        });
      }
    },
    [defaultDoc, isZipFile],
  );

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      void validateAndAddFiles(Array.from(files));
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [validateAndAddFiles],
  );

  const handleFolderSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      void validateAndAddFiles(Array.from(files));
      if (folderInputRef.current) folderInputRef.current.value = "";
    },
    [validateAndAddFiles],
  );

  const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;
  const isDirectoryEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry =>
    entry.isDirectory;

  const readFileFromEntry = useCallback((entry: FileSystemFileEntry) => {
    return new Promise<File | null>((resolve) => {
      entry.file(
        (file) => resolve(file),
        () => resolve(null),
      );
    });
  }, []);

  const readAllDirectoryEntries = useCallback(async (entry: FileSystemDirectoryEntry) => {
    const reader = entry.createReader();
    const collected: FileSystemEntry[] = [];

    while (true) {
      const entries = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(
          (batch) => resolve(batch),
          () => resolve([]),
        );
      });
      if (entries.length === 0) break;
      collected.push(...entries);
    }

    return collected;
  }, []);

  const collectFilesFromEntry = useCallback(
    async (entry: FileSystemEntry): Promise<File[]> => {
      if (isFileEntry(entry)) {
        const file = await readFileFromEntry(entry);
        return file ? [file] : [];
      }

      if (isDirectoryEntry(entry)) {
        const children = await readAllDirectoryEntries(entry);
        const nestedFiles = await Promise.all(
          children.map((child) => collectFilesFromEntry(child)),
        );
        return nestedFiles.flat();
      }

      return [];
    },
    [readAllDirectoryEntries, readFileFromEntry],
  );

  const collectDroppedFiles = useCallback(
    async (
      dataTransfer: DataTransfer,
    ): Promise<{ files: File[]; usedEntryApi: boolean }> => {
      const items = Array.from(
        dataTransfer.items ?? [],
      ) as DataTransferItemWithWebkitEntry[];
      const rootEntries = items
        .map((item) => item.webkitGetAsEntry?.() ?? null)
        .filter((entry): entry is FileSystemEntry => entry !== null);

      if (rootEntries.length === 0) {
        return { files: Array.from(dataTransfer.files), usedEntryApi: false };
      }

      const nestedFiles = await Promise.all(
        rootEntries.map((entry) => collectFilesFromEntry(entry)),
      );
      return { files: nestedFiles.flat(), usedEntryApi: true };
    },
    [collectFilesFromEntry],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const { files, usedEntryApi } = await collectDroppedFiles(e.dataTransfer);
      if (files.length === 0) {
        if (usedEntryApi) {
          toast.error("No files found in dropped folder");
        }
        return;
      }
      void validateAndAddFiles(files);
    },
    [collectDroppedFiles, validateAndAddFiles],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const removeDocument = (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    toast.success("File removed from queue");
  };

  const updateDocument = (id: string, updates: Partial<DocumentFile>) => {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...updates } : d)));
  };

  const applyBatchSettings = () => {
    setDocuments((prev) =>
      prev.map((d) => ({
        ...d,
        category: batchSettings.category,
        processingMethod: batchSettings.processingMethod,
        uploadDate: batchSettings.uploadDate,
        storageMethod: batchSettings.storageMethod,
      })),
    );
    toast.success("Settings applied to all documents");
  };

  const handleToggleChange = useCallback(
    (value: string) => {
      if (value === "cloud" && !isUploadThingConfigured) return;
      const newUseUploadThing = value === "cloud";
      setBatchSettings((prev) => ({ ...prev, storageMethod: value }));
      setDocuments((prev) => prev.map((d) => ({ ...d, storageMethod: value })));
      void onToggleUploadMethod(newUseUploadThing);
    },
    [isUploadThingConfigured, onToggleUploadMethod],
  );

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) return;
    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const uploadSingleDocument = async (doc: DocumentFile) => {
    updateDocument(doc.id, { status: "uploading", progress: 10 });

    let resolvedStorageType: "s3" | "database" = "s3";
    let fileUrl: string;
    let uploadedObjectKey: string | undefined;
    const mimeType: string | undefined = doc.file.type || undefined;

    if (storageProvider === "s3") {
      updateDocument(doc.id, { progress: 15 });

      const { objectKey, url } = await uploadToS3WithProgress(doc.file, (pct) => {
        updateDocument(doc.id, {
          progress: 15 + Math.round(pct * 0.75),
        });
      });

      fileUrl = url;
      uploadedObjectKey = objectKey;
      resolvedStorageType = "s3";
    } else {
      const useUploadThingForDoc =
        doc.storageMethod === "cloud" && isUploadThingConfigured;

      if (useUploadThingForDoc) {
        updateDocument(doc.id, { progress: 30 });
        const res = await uploadFiles("documentUploaderRestricted", {
          files: [doc.file],
        });
        if (!res?.[0]?.url)
          throw new Error("UploadThing: Cloud upload failed — no URL returned");
        fileUrl = res[0].url;
        resolvedStorageType = "s3";
      } else {
        updateDocument(doc.id, { progress: 30 });
        const fd = new FormData();
        fd.append("file", doc.file);
        const res = await fetch("/api/upload-local", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error("Upload failed: " + (err.error ?? "unknown error"));
        }
        const data = (await res.json()) as {
          url: string;
          provider?: "s3" | "database";
        };
        fileUrl = data.url;
        resolvedStorageType = data.provider === "s3" ? "s3" : "database";
      }
    }

    updateDocument(doc.id, { progress: 92 });

    const preferredProvider =
      doc.processingMethod === "auto"
        ? undefined
        : doc.processingMethod === "standard"
          ? "NATIVE_PDF"
          : doc.processingMethod.toUpperCase();

    const body: Record<string, unknown> = {
      userId,
      documentName: doc.title,
      category: doc.category,
      documentUrl: fileUrl,
      storageType: resolvedStorageType,
      mimeType,
      originalFilename: doc.file.name,
      preferredProvider:
        preferredProvider === "LANDING_AI" ? "LANDING_AI" : preferredProvider,
    };

    if (resolvedStorageType === "s3" && uploadedObjectKey) {
      body.storageProvider = "s3";
      body.storagePathname = uploadedObjectKey;
    }

    const response = await fetch("/api/uploadDocument", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Document registration failed for ${doc.title} (HTTP ${response.status}) ${text}`,
      );
    }
    updateDocument(doc.id, { status: "success", progress: 100 });
  };

  const validateBeforeUpload = () => {
    const newErrors: Record<string, string> = {};
    documents.forEach((doc) => {
      if (!doc.title.trim()) newErrors[`title-${doc.id}`] = "Title is required";
    });
    if (Object.keys(newErrors).length > 0) {
      toast.error("Please fill in all required fields", {
        description: "Check that each document has a title",
      });
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateBeforeUpload()) return;
    setIsSubmitting(true);

    const pendingDocs = documents.filter((d) => d.status === "pending");

    for (const doc of pendingDocs) {
      try {
        await uploadSingleDocument(doc);
      } catch (err) {
        console.error(err);
        updateDocument(doc.id, {
          status: "error",
          progress: 0,
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }

    setIsSubmitting(false);

    const finalSuccess =
      documents.filter((d) => d.status === "success").length +
      pendingDocs.filter((d) => {
        const current = documents.find((dd) => dd.id === d.id);
        return current?.status === "success";
      }).length;

    const finalErrors = documents.filter((d) => d.status === "error").length;

    if (finalErrors === 0) {
      toast.success(`All documents uploaded successfully!`, {
        description: "Your documents are now available in the library.",
      });
      setTimeout(() => {
        setDocuments([]);
        if (onCompleted) {
          onCompleted();
        } else {
          router.push("/employer/documents");
        }
      }, 1500);
    } else if (finalSuccess > 0) {
      toast.warning(`${finalSuccess} succeeded, ${finalErrors} failed`, {
        description: "You can retry failed uploads or remove them.",
      });
    } else {
      toast.error("Upload failed");
    }
  };

  const retryFailedUploads = async () => {
    const failedDocs = documents.filter((d) => d.status === "error");
    if (failedDocs.length === 0) return;

    failedDocs.forEach((d) =>
      updateDocument(d.id, { status: "pending", progress: 0, error: undefined }),
    );

    setIsSubmitting(true);

    for (const doc of failedDocs) {
      try {
        await uploadSingleDocument(doc);
      } catch (err) {
        console.error(err);
        updateDocument(doc.id, {
          status: "error",
          progress: 0,
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }

    setIsSubmitting(false);

    const stillFailed = documents.filter((d) => d.status === "error").length;
    if (stillFailed === 0) {
      toast.success("All uploads completed successfully!");
      setTimeout(() => {
        setDocuments([]);
        if (onCompleted) {
          onCompleted();
        } else {
          router.push("/employer/documents");
        }
      }, 1500);
    }
  };

  const pendingCount = documents.filter((d) => d.status === "pending").length;
  const successCount = documents.filter((d) => d.status === "success").length;
  const errorCount = documents.filter((d) => d.status === "error").length;

  const currentStorageValue =
    useUploadThing && isUploadThingConfigured ? "cloud" : "database";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hero drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          position: "relative",
          border: `1.5px ${isDragging ? "solid" : "dashed"} ${
            isDragging ? "var(--accent)" : "var(--line)"
          }`,
          background: isDragging ? "var(--accent-soft)" : "var(--panel)",
          borderRadius: 14,
          padding: 28,
          transition: "background 140ms, border-color 140ms",
        }}
      >
        {!isUploadThingConfigured && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 10,
              marginBottom: 20,
              background: "oklch(0.96 0.06 70)",
              border: "1px solid oklch(0.86 0.1 70)",
              color: "oklch(0.4 0.12 60)",
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                UploadThing is not configured. Uploads will use Vercel Blob.
              </span>
              <Link
                href="/deployment?section=uploadthing"
                style={{
                  fontSize: 12.5,
                  color: "var(--accent-ink)",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  textDecoration: "underline",
                }}
              >
                Set up UploadThing <ExternalLink size={12} />
              </Link>
            </div>
          </div>
        )}

        {!embedded && (
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              Add sources
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
              Upload files, connect a repo, paste text, or add a URL
            </div>
          </div>
        )}

        {embedded ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "28px 20px",
              borderRadius: 12,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Upload size={26} />
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              Drop files or click to upload
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-3)",
                lineHeight: 1.5,
                maxWidth: 420,
              }}
            >
              PDF, DOCX, images, audio, video, or ZIP — up to{" "}
              {DOCUMENT_LIMITS.MAX_FILE_SIZE_MB}MB per file.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "var(--accent)",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Choose files
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "var(--panel)",
                  color: "var(--ink-2)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "1px solid var(--line)",
                  cursor: "pointer",
                }}
              >
                Choose folder
              </button>
            </div>
          </div>
        ) : (
          <SourceGrid
            onSelectSource={(source) => setActiveSource(source)}
            onFileClick={() => fileInputRef.current?.click()}
            onFolderClick={() => folderInputRef.current?.click()}
          />
        )}

        <input
          ref={fileInputRef}
          id="file-input"
          type="file"
          accept={`${UPLOAD_ACCEPT_STRING},${ZIP_ACCEPT_STRING}`}
          onChange={(e) => handleFileSelect(e.target.files)}
          style={{ display: "none" }}
          multiple
        />
        <input
          ref={folderInputRef}
          id="folder-input"
          type="file"
          accept={`${UPLOAD_ACCEPT_STRING},${ZIP_ACCEPT_STRING}`}
          onChange={(e) => handleFolderSelect(e.target.files)}
          style={{ display: "none" }}
          multiple
        />

        <div
          style={{
            textAlign: "center",
            fontSize: 12,
            color: "var(--ink-3)",
            marginTop: 18,
          }}
        >
          Drag and drop files anywhere on this card — max{" "}
          {DOCUMENT_LIMITS.MAX_FILE_SIZE_MB}MB per file
        </div>

        {isDragging && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <div
              style={{
                color: "var(--accent-ink)",
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              <Upload size={30} style={{ marginBottom: 8 }} />
              <div>Drop files here</div>
            </div>
          </div>
        )}
      </div>

      {documents.length > 0 && (
        <FileQueue
          documents={documents}
          categories={categories}
          expandedDocId={expandedDocId}
          errors={errors}
          onRemove={removeDocument}
          onUpdate={updateDocument}
          onClearAll={() => {
            setDocuments([]);
            toast.success("Queue cleared");
          }}
          onToggleExpand={(id) =>
            setExpandedDocId(expandedDocId === id ? null : id)
          }
          formatFileSize={formatFileSize}
        />
      )}

      {documents.length > 0 && (
        <UploadSettings
          categories={categories}
          batchSettings={batchSettings}
          onBatchSettingsChange={setBatchSettings}
          onApplyBatchSettings={applyBatchSettings}
          processingMethods={processingMethods}
          isUploadThingConfigured={isUploadThingConfigured}
          currentStorageValue={currentStorageValue}
          onToggleChange={handleToggleChange}
          isUpdatingPreference={isUpdatingPreference}
          onAddCategory={onAddCategory}
          storageProvider={storageProvider}
        />
      )}

      {(successCount > 0 || errorCount > 0) && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              Upload progress
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
              {successCount} completed, {errorCount} failed, {pendingCount} pending
            </div>
          </div>
          {errorCount > 0 && !isSubmitting && (
            <button
              onClick={() => void retryFailedUploads()}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                color: "var(--ink-2)",
                padding: "7px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry failed
            </button>
          )}
        </div>
      )}

      {documents.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || pendingCount === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background:
                isSubmitting || pendingCount === 0
                  ? "var(--line)"
                  : "var(--accent)",
              color: isSubmitting || pendingCount === 0 ? "var(--ink-3)" : "white",
              padding: "11px 20px",
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 600,
              border: "none",
              cursor:
                isSubmitting || pendingCount === 0 ? "not-allowed" : "pointer",
              boxShadow:
                isSubmitting || pendingCount === 0
                  ? "none"
                  : "0 2px 10px var(--accent-glow)",
              transition: "background 120ms, box-shadow 120ms",
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Uploading…
              </>
            ) : (
              `Upload ${pendingCount} ${
                pendingCount === 1 ? "document" : "documents"
              }`
            )}
          </button>
        </div>
      )}

      <SourceDialog
        open={activeSource}
        onClose={() => setActiveSource(null)}
        categories={categories}
        defaultCategory={batchSettings.category}
        onFilesAdded={(files) => void validateAndAddFiles(files)}
      />
    </div>
  );
};

export default UploadForm;
