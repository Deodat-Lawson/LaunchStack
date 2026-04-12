"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
    Upload,
    AlertCircle,
    Loader2,
    ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "~/lib/auth-hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { genUploader } from "uploadthing/client";
import type { OurFileRouter } from "~/app/api/uploadthing/core";
import { isUploadAccepted, UPLOAD_ACCEPT_STRING } from "~/lib/upload-accepted";

import { SourceGrid, type SourceType } from "./SourceGrid";
import { SourceDialog } from "./SourceDialog";
import { FileQueue } from "./FileQueue";
import { UploadSettings } from "./UploadSettings";
import { Button } from "~/app/employer/documents/components/ui/button";
import {
    TooltipProvider,
} from "~/app/employer/documents/components/ui/tooltip";

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
                    const data = JSON.parse(xhr.responseText) as { objectKey: string; bucket: string; url: string };
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
        xhr.onerror = () =>
            reject(new Error("Storage service unavailable"));
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
    storageProvider: "cloud" | "local";
    s3Endpoint: string;
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

    const hasAnyOCR = availableProviders.azure || availableProviders.landingAI || availableProviders.datalab;

    const processingMethods = [
        ...(hasAnyOCR
            ? [{ value: "auto", label: "Auto", description: "Automatically select the best method based on document analysis." }]
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
                const nestedFiles = await Promise.all(children.map((child) => collectFilesFromEntry(child)));
                return nestedFiles.flat();
            }

            return [];
        },
        [readAllDirectoryEntries, readFileFromEntry],
    );

    const collectDroppedFiles = useCallback(
        async (dataTransfer: DataTransfer): Promise<{ files: File[]; usedEntryApi: boolean }> => {
            const items = Array.from(dataTransfer.items ?? []) as DataTransferItemWithWebkitEntry[];
            const rootEntries = items
                .map((item) => item.webkitGetAsEntry?.() ?? null)
                .filter((entry): entry is FileSystemEntry => entry !== null);

            if (rootEntries.length === 0) {
                return { files: Array.from(dataTransfer.files), usedEntryApi: false };
            }

            const nestedFiles = await Promise.all(rootEntries.map((entry) => collectFilesFromEntry(entry)));
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

        let resolvedStorageType: "cloud" | "database" | "local" = "cloud";
        let fileUrl: string;
        let uploadedObjectKey: string | undefined;
        const mimeType: string | undefined = doc.file.type || undefined;

        if (storageProvider === "local") {
            updateDocument(doc.id, { progress: 15 });

            const { objectKey, url } = await uploadToS3WithProgress(
                doc.file,
                (pct) => {
                    updateDocument(doc.id, {
                        progress: 15 + Math.round(pct * 0.75),
                    });
                },
            );

            fileUrl = url;
            uploadedObjectKey = objectKey;
            resolvedStorageType = "local";
        } else {
            const useUploadThingForDoc =
                doc.storageMethod === "cloud" && isUploadThingConfigured;

            if (useUploadThingForDoc) {
                updateDocument(doc.id, { progress: 30 });
                const res = await uploadFiles("documentUploaderRestricted", {
                    files: [doc.file],
                });
                if (!res?.[0]?.url) throw new Error("UploadThing: Cloud upload failed — no URL returned");
                fileUrl = res[0].url;
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
                    throw new Error("Vercel Blob: " + (err.error ?? "Upload failed"));
                }
                const data = (await res.json()) as {
                    url: string;
                    provider?: string;
                };
                fileUrl = data.url;
                if (data.provider !== "vercel_blob") {
                    resolvedStorageType = "database";
                }
            }
        }

        updateDocument(doc.id, { progress: 92 });

        const preferredProvider =
            doc.processingMethod === "auto" ? undefined
            : doc.processingMethod === "standard" ? "NATIVE_PDF"
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
                preferredProvider === "LANDING_AI"
                    ? "LANDING_AI"
                    : preferredProvider,
        };

        if (resolvedStorageType === "local") {
            body.storageProvider = "seaweedfs";
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

        const finalSuccess = documents.filter((d) => d.status === "success").length +
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
                router.push("/employer/documents");
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
                router.push("/employer/documents");
            }, 1500);
        }
    };

    const pendingCount = documents.filter((d) => d.status === "pending").length;
    const successCount = documents.filter((d) => d.status === "success").length;
    const errorCount = documents.filter((d) => d.status === "error").length;

    const currentStorageValue =
        useUploadThing && isUploadThingConfigured ? "cloud" : "database";

    return (
        <TooltipProvider>
            <div className="space-y-6">
                {/* Hero Upload Card — entire card is drop zone */}
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`relative border-2 rounded-xl p-8 transition-colors ${
                        isDragging
                            ? "border-purple-500 bg-purple-50/50 dark:border-purple-400 dark:bg-purple-900/20"
                            : "border-dashed border-gray-300 dark:border-purple-500/30 bg-white dark:bg-slate-900/50"
                    }`}
                >
                    {/* UploadThing warning */}
                    {!isUploadThingConfigured && (
                        <div className="flex items-start gap-3 p-4 rounded-xl mb-6 bg-amber-50 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-500/40">
                            <AlertCircle className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-1">
                                <span className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                                    UploadThing is not configured. Uploads will use Vercel Blob.
                                </span>
                                <Link
                                    href="/deployment?section=uploadthing"
                                    className="text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium inline-flex items-center gap-1 transition-colors"
                                >
                                    Set up UploadThing{" "}
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* Heading */}
                    <div className="text-center mb-6">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Add sources
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Upload files, connect a repo, paste text, or add a URL
                        </p>
                    </div>

                    {/* Source Type Grid */}
                    <SourceGrid
                        onSelectSource={(source) => setActiveSource(source)}
                        onFileClick={() => fileInputRef.current?.click()}
                        onFolderClick={() => folderInputRef.current?.click()}
                    />

                    {/* Hidden file inputs */}
                    <input
                        ref={fileInputRef}
                        id="file-input"
                        type="file"
                        accept={`${UPLOAD_ACCEPT_STRING},${ZIP_ACCEPT_STRING}`}
                        onChange={(e) => handleFileSelect(e.target.files)}
                        className="hidden"
                        multiple
                    />
                    <input
                        ref={folderInputRef}
                        id="folder-input"
                        type="file"
                        accept={`${UPLOAD_ACCEPT_STRING},${ZIP_ACCEPT_STRING}`}
                        onChange={(e) => handleFolderSelect(e.target.files)}
                        className="hidden"
                        multiple
                    />

                    <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-5">
                        Drag and drop files anywhere on this card &mdash; Max {DOCUMENT_LIMITS.MAX_FILE_SIZE_MB}MB per file
                    </p>

                    {/* Drag overlay */}
                    {isDragging && (
                        <div className="absolute inset-0 rounded-xl bg-purple-600/10 flex items-center justify-center pointer-events-none z-10">
                            <div className="text-purple-600 dark:text-purple-400 font-medium text-center">
                                <Upload className="w-8 h-8 mx-auto mb-2" />
                                Drop files here
                            </div>
                        </div>
                    )}
                </div>

                {/* File Queue */}
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

                {/* Settings */}
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

                {/* Upload Progress Summary */}
                {(successCount > 0 || errorCount > 0) && (
                    <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-xl p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    Upload Progress
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {successCount} completed, {errorCount} failed,{" "}
                                    {pendingCount} pending
                                </p>
                            </div>
                            {errorCount > 0 && !isSubmitting && (
                                <Button
                                    onClick={() => void retryFailedUploads()}
                                    variant="outline"
                                    size="sm"
                                >
                                    Retry Failed
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Upload Button */}
                {documents.length > 0 && (
                    <div className="flex justify-end">
                        <Button
                            onClick={() => void handleSubmit()}
                            disabled={isSubmitting || pendingCount === 0}
                            className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-500/20"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Uploading...
                                </>
                            ) : (
                                `Upload ${pendingCount} ${pendingCount === 1 ? "Document" : "Documents"}`
                            )}
                        </Button>
                    </div>
                )}

                {/* Source Dialogs */}
                <SourceDialog
                    open={activeSource}
                    onClose={() => setActiveSource(null)}
                    categories={categories}
                    defaultCategory={batchSettings.category}
                    onFilesAdded={(files) => void validateAndAddFiles(files)}
                />
            </div>
        </TooltipProvider>
    );
};

export default UploadForm;
