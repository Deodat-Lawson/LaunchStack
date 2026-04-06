"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
    Upload,
    FileText,
    X,
    ChevronDown,
    ChevronUp,
    Plus,
    Trash2,
    Check,
    AlertCircle,
    Loader2,
    ExternalLink,
    BookOpen,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "~/lib/auth-hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { genUploader } from "uploadthing/client";
import type { OurFileRouter } from "~/app/api/uploadthing/core";
import { isUploadAccepted, UPLOAD_ACCEPT_STRING } from "~/lib/upload-accepted";

import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import { Label } from "~/app/employer/documents/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/app/employer/documents/components/ui/select";
import { RadioGroup, RadioGroupItem } from "~/app/employer/documents/components/ui/radio-group";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "~/app/employer/documents/components/ui/collapsible";
import { Progress } from "~/app/employer/documents/components/ui/progress";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
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

interface UploadFormProps {
    categories: { id: string; name: string }[];
    useUploadThing: boolean;
    isUploadThingConfigured: boolean;
    onToggleUploadMethod: (useUploadThing: boolean) => Promise<void>;
    isUpdatingPreference: boolean;
    availableProviders: AvailableProviders;
    onAddCategory?: (newCategory: string) => Promise<void>;
}

const UploadForm: React.FC<UploadFormProps> = ({
    categories,
    useUploadThing,
    isUploadThingConfigured,
    onToggleUploadMethod,
    isUpdatingPreference,
    availableProviders,
    onAddCategory,
}) => {
    const { userId } = useAuth();
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    const [step, setStep] = useState<1 | 2>(1);
    const [documents, setDocuments] = useState<DocumentFile[]>([]);
    const [batchSettings, setBatchSettings] = useState<BatchSettings>({
        category: "",
        processingMethod: "standard",
        uploadDate: new Date().toISOString().split("T")[0]!,
        storageMethod: useUploadThing && isUploadThingConfigured ? "cloud" : "database",
    });
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [isSavingCategory, setIsSavingCategory] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showImportGuide, setShowImportGuide] = useState(false);
    const [importTab, setImportTab] = useState<"notion" | "google" | "slack" | "github">("notion");
    const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

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
        if (!batchSettings.category) {
            toast.error("Please select a category to apply to all documents");
            return;
        }
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

    const handleAddCategoryInline = useCallback(async () => {
        if (!newCategoryName.trim() || !onAddCategory) return;
        const name = newCategoryName.trim();
        if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
            setBatchSettings((prev) => ({ ...prev, category: name }));
            setNewCategoryName("");
            setIsAddingCategory(false);
            return;
        }
        setIsSavingCategory(true);
        try {
            await onAddCategory(name);
            setBatchSettings((prev) => ({ ...prev, category: name }));
            setNewCategoryName("");
            setIsAddingCategory(false);
        } catch (err) {
            console.error(err);
        } finally {
            setIsSavingCategory(false);
        }
    }, [newCategoryName, onAddCategory, categories]);

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

    const validateStep1 = () => {
        if (documents.length === 0) {
            setErrors({ files: "Please add at least one file to upload" });
            return false;
        }
        setErrors({});
        return true;
    };

    const validateStep2 = () => {
        const newErrors: Record<string, string> = {};
        documents.forEach((doc) => {
            if (!doc.title.trim()) newErrors[`title-${doc.id}`] = "Title is required";
            if (!doc.category) newErrors[`category-${doc.id}`] = "Category is required";
        });
        if (Object.keys(newErrors).length > 0) {
            toast.error("Please fill in all required fields", {
                description: "Check that each document has a title and category",
            });
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNextStep = () => {
        if (validateStep1()) setStep(2);
    };

    const hasSyncedBatch = useRef(false);
    useEffect(() => {
        if (step === 2 && documents.length > 0 && !hasSyncedBatch.current) {
            hasSyncedBatch.current = true;
            const first = documents[0]!;
            setBatchSettings({
                category: first.category,
                processingMethod: first.processingMethod,
                uploadDate: first.uploadDate,
                storageMethod: first.storageMethod,
            });
        }
        if (step === 1) hasSyncedBatch.current = false;
    }, [step, documents]);

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

        const useUploadThingForDoc = doc.storageMethod === "cloud" && isUploadThingConfigured;
        let resolvedStorageType: "cloud" | "database" = "cloud";
        let fileUrl: string;
        const mimeType: string | undefined = doc.file.type || undefined;

        if (useUploadThingForDoc) {
            updateDocument(doc.id, { progress: 30 });
            const res = await uploadFiles("documentUploaderRestricted", {
                files: [doc.file],
            });
            if (!res?.[0]?.url) throw new Error("Cloud upload failed");
            fileUrl = res[0].url;
        } else {
            updateDocument(doc.id, { progress: 30 });
            const fd = new FormData();
            fd.append("file", doc.file);
            const res = await fetch("/api/upload-local", { method: "POST", body: fd });
            if (!res.ok) {
                const err = (await res.json()) as { error?: string };
                throw new Error(err.error ?? "Local upload failed");
            }
            const data = (await res.json()) as { url: string; provider?: string };
            fileUrl = data.url;
            if (data.provider !== "vercel_blob") {
                resolvedStorageType = "database";
            }
        }

        updateDocument(doc.id, { progress: 60 });

        const preferredProvider =
            doc.processingMethod === "auto" ? undefined
            : doc.processingMethod === "standard" ? "NATIVE_PDF"
            : doc.processingMethod.toUpperCase();

        const response = await fetch("/api/uploadDocument", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId,
                documentName: doc.title,
                category: doc.category,
                documentUrl: fileUrl,
                storageType: resolvedStorageType,
                mimeType,
                originalFilename: doc.file.name,
                preferredProvider:
                    preferredProvider === "LANDING_AI" ? "LANDING_AI" : preferredProvider,
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(
                `Document registration failed for ${doc.title} (HTTP ${response.status}) ${text}`
            );
        }
        updateDocument(doc.id, { status: "success", progress: 100 });
    };

    const handleSubmit = async () => {
        if (!validateStep2()) return;
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
                setStep(1);
                setShowAdvanced(false);
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
                setStep(1);
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
                {/* Step Indicator */}
                <div className="flex items-center gap-2">
                    <div
                        className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                            step >= 1 ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-600"
                        }`}
                    >
                        1
                    </div>
                    <div className={`flex-1 h-1 ${step >= 2 ? "bg-purple-600" : "bg-gray-200"}`} />
                    <div
                        className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                            step >= 2 ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-600"
                        }`}
                    >
                        2
                    </div>
                </div>

                {/* Step 1: Upload Files */}
                {step === 1 && (
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
                            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                                Upload Documents
                            </h2>

                            {!isUploadThingConfigured && (
                                <div className="flex items-start gap-3 p-4 rounded-xl mb-4 bg-amber-50 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-500/40">
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

                            <div
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                                    isDragging
                                        ? "border-purple-600 bg-purple-50 dark:border-purple-400 dark:bg-purple-900/30"
                                        : errors.files
                                          ? "border-red-300 bg-red-50"
                                          : "border-gray-300 hover:border-purple-400 hover:bg-gray-50 dark:border-purple-400/40 dark:hover:border-purple-400 dark:hover:bg-slate-800/60"
                                }`}
                            >
                                <Upload
                                    className={`mx-auto h-12 w-12 mb-4 ${
                                        isDragging
                                            ? "text-purple-600 dark:text-purple-400"
                                            : "text-gray-400 dark:text-purple-400"
                                    }`}
                                />
                                <p className="text-base font-medium text-gray-900 dark:text-white mb-1">
                                    Drag and drop files or folders here
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-300 mb-4">
                                    PDF, DOC, DOCX, PNG, JPG, MP3, MP4, ZIP — Max {DOCUMENT_LIMITS.MAX_FILE_SIZE_MB}MB per file
                                </p>
                                <p className="text-xs text-gray-400">
                                    Or choose exactly what to upload
                                </p>
                                <div className="mt-4 flex items-center justify-center gap-3">
                                    <Button
                                        type="button"
                                        onClick={() => {
                                            fileInputRef.current?.click();
                                        }}
                                    >
                                        Select Files
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => {
                                            folderInputRef.current?.click();
                                        }}
                                    >
                                        Select Folder
                                    </Button>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    id="file-input"
                                    type="file"
                                    accept={`${UPLOAD_ACCEPT_STRING},${ZIP_ACCEPT_STRING}`}
                                    onChange={(e) => handleFileSelect(e.target.files)}
                                    className="hidden"
                                    multiple
                                    aria-describedby={errors.files ? "files-error" : undefined}
                                    aria-invalid={!!errors.files}
                                />
                                <input
                                    ref={folderInputRef}
                                    id="folder-input"
                                    type="file"
                                    accept={`${UPLOAD_ACCEPT_STRING},${ZIP_ACCEPT_STRING}`}
                                    onChange={(e) => handleFolderSelect(e.target.files)}
                                    className="hidden"
                                    multiple
                                    aria-describedby={errors.files ? "files-error" : undefined}
                                    aria-invalid={!!errors.files}
                                />
                            </div>
                            {errors.files && (
                                <p id="files-error" className="text-sm text-red-600 mt-2">
                                    {errors.files}
                                </p>
                            )}

                            {/* Import from External Sources */}
                            <Collapsible open={showImportGuide} onOpenChange={setShowImportGuide}>
                                <CollapsibleTrigger asChild>
                                    <button className="w-full mt-4 px-4 py-3 flex items-center gap-3 rounded-lg border border-dashed border-gray-300 dark:border-purple-500/30 hover:border-purple-400 dark:hover:border-purple-400 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors text-left">
                                        <BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                                                Import from Notion, Google Docs, Slack, or GitHub
                                            </span>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                Export your existing knowledge and upload it here
                                            </p>
                                        </div>
                                        {showImportGuide ? (
                                            <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                        )}
                                    </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <div className="mt-3 border border-gray-200 dark:border-purple-500/20 rounded-lg overflow-hidden">
                                        <div className="flex border-b border-gray-200 dark:border-purple-500/20">
                                            {(["notion", "google", "slack", "github"] as const).map((tab) => (
                                                <button
                                                    key={tab}
                                                    onClick={() => setImportTab(tab)}
                                                    className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
                                                        importTab === tab
                                                            ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-b-2 border-purple-600"
                                                            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800/60"
                                                    }`}
                                                >
                                                    {tab === "notion" ? "Notion" : tab === "google" ? "Google" : tab === "slack" ? "Slack" : "GitHub"}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="p-4 bg-gray-50 dark:bg-slate-800/40 text-sm text-gray-700 dark:text-gray-300 space-y-2">
                                            {importTab === "notion" && (
                                                <>
                                                    <p className="font-medium text-gray-900 dark:text-gray-100">Export from Notion as Markdown</p>
                                                    <ol className="list-decimal list-inside space-y-1.5 text-gray-600 dark:text-gray-400">
                                                        <li>Open your Notion workspace</li>
                                                        <li>Click the <strong>&hellip;</strong> menu on a page, or go to <strong>Settings &amp; members &gt; Export</strong> for a full workspace export</li>
                                                        <li>Select <strong>Markdown &amp; CSV</strong> as the format</li>
                                                        <li>Check <strong>Include subpages</strong> if needed</li>
                                                        <li>Download the ZIP file</li>
                                                        <li>Upload the ZIP directly here &mdash; each <code>.md</code> and <code>.csv</code> file will be ingested as a separate document</li>
                                                    </ol>
                                                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                                                        Supported formats: Markdown (.md), CSV (.csv), HTML (.html)
                                                    </p>
                                                </>
                                            )}
                                            {importTab === "google" && (
                                                <>
                                                    <p className="font-medium text-gray-900 dark:text-gray-100">Export from Google Docs &amp; Sheets</p>
                                                    <div className="space-y-3">
                                                        <div>
                                                            <p className="font-medium text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wide mb-1">Single document</p>
                                                            <ol className="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400">
                                                                <li>Open your Google Doc or Sheet</li>
                                                                <li>Go to <strong>File &gt; Download</strong></li>
                                                                <li>Choose <strong>Microsoft Word (.docx)</strong> for Docs or <strong>CSV / Excel (.xlsx)</strong> for Sheets</li>
                                                                <li>Upload the downloaded file here</li>
                                                            </ol>
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wide mb-1">Bulk export</p>
                                                            <ol className="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400">
                                                                <li>Go to <strong>takeout.google.com</strong></li>
                                                                <li>Select <strong>Drive</strong> and choose the folders you want</li>
                                                                <li>Export as ZIP with DOCX format</li>
                                                                <li>Upload the ZIP directly here</li>
                                                            </ol>
                                                        </div>
                                                    </div>
                                                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                                                        Supported formats: DOCX (.docx), XLSX (.xlsx), CSV (.csv), PDF (.pdf)
                                                    </p>
                                                </>
                                            )}
                                            {importTab === "slack" && (
                                                <>
                                                    <p className="font-medium text-gray-900 dark:text-gray-100">Export from Slack</p>
                                                    <ol className="list-decimal list-inside space-y-1.5 text-gray-600 dark:text-gray-400">
                                                        <li>Go to your Slack workspace <strong>Settings &amp; administration &gt; Workspace settings</strong></li>
                                                        <li>Click <strong>Import/Export Data</strong> then select the <strong>Export</strong> tab</li>
                                                        <li>Choose a date range and click <strong>Start Export</strong></li>
                                                        <li>Download the export ZIP when ready</li>
                                                        <li>Upload the ZIP here &mdash; each channel&apos;s messages will be ingested as a separate document</li>
                                                    </ol>
                                                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                                                        Supported formats: Slack export JSON (.json), plus any file attachments (PDF, DOCX, etc.)
                                                    </p>
                                                </>
                                            )}
                                            {importTab === "github" && (
                                                <>
                                                    <p className="font-medium text-gray-900 dark:text-gray-100">Export from GitHub</p>
                                                    <div className="space-y-3">
                                                        <div>
                                                            <p className="font-medium text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wide mb-1">Repo docs and code</p>
                                                            <ol className="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400">
                                                                <li>Go to your repository on GitHub</li>
                                                                <li>Click <strong>Code &gt; Download ZIP</strong></li>
                                                                <li>Upload the ZIP here &mdash; all Markdown, text, and HTML files will be ingested</li>
                                                            </ol>
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wide mb-1">Issues</p>
                                                            <p className="text-gray-600 dark:text-gray-400 mb-1">Requires the <code>gh</code> CLI. Run in your terminal:</p>
                                                            <code className="block bg-gray-200 dark:bg-slate-700 text-xs p-2 rounded overflow-x-auto whitespace-pre">gh issue list --state all --limit 1000 --json number,title,body,state,labels,author,createdAt,closedAt,comments &gt; issues.json</code>
                                                            <p className="text-gray-600 dark:text-gray-400 mt-1">Upload the resulting <code>issues.json</code> file here.</p>
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-gray-800 dark:text-gray-200 text-xs uppercase tracking-wide mb-1">Pull requests</p>
                                                            <code className="block bg-gray-200 dark:bg-slate-700 text-xs p-2 rounded overflow-x-auto whitespace-pre">gh pr list --state all --limit 1000 --json number,title,body,state,labels,author,createdAt,mergedAt,comments &gt; prs.json</code>
                                                            <p className="text-gray-600 dark:text-gray-400 mt-1">Upload the resulting <code>prs.json</code> file here.</p>
                                                        </div>
                                                    </div>
                                                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                                                        Supported formats: GitHub CLI JSON (.json), repo ZIP (.zip with .md files)
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>

                            {documents.length > 0 && (
                                <div className="mt-6 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200">
                                            Upload Queue ({documents.length}{" "}
                                            {documents.length === 1 ? "file" : "files"})
                                        </h3>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setDocuments([]);
                                                toast.success("Queue cleared");
                                            }}
                                        >
                                            Clear All
                                        </Button>
                                    </div>
                                    <div className="space-y-2">
                                        {documents.map((doc) => (
                                            <div
                                                key={doc.id}
                                                className="border border-gray-200 dark:border-purple-500/20 rounded-lg p-4 bg-gray-50 dark:bg-slate-800/60"
                                            >
                                                <div className="flex items-start gap-3">
                                                    <FileText className="h-8 w-8 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-1" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-gray-900 dark:text-gray-200 truncate">
                                                            {doc.title}
                                                        </p>
                                                        <p className="text-sm text-gray-500 dark:text-gray-400">
                                                            {formatFileSize(doc.file.size)}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeDocument(doc.id)}
                                                        aria-label="Remove file"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {documents.length > 0 && (
                            <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-500/30 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center">
                                        <span className="text-purple-600 text-sm font-medium">
                                            💡
                                        </span>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-purple-900 dark:text-purple-200 mb-1">
                                            Quick Tip: Apply settings to all documents
                                        </p>
                                        <p className="text-sm text-purple-700 dark:text-purple-300">
                                            In the next step, you can apply the same category and
                                            settings to all files at once, or customize each document
                                            individually.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end">
                            <Button onClick={handleNextStep} disabled={documents.length === 0}>
                                Next: Add Details ({documents.length})
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 2: Metadata & Submit */}
                {step === 2 && (
                    <div className="space-y-6">
                        {/* Batch Settings */}
                        <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                        Batch Settings
                                    </h2>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        Apply these settings to all documents
                                    </p>
                                </div>
                                <Button
                                    onClick={applyBatchSettings}
                                    variant="outline"
                                    size="sm"
                                >
                                    Apply to All
                                </Button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="batch-category">Category</Label>
                                    {!isAddingCategory ? (
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <Select
                                                    value={batchSettings.category || undefined}
                                                    onValueChange={(value) => {
                                                        if (value === "add-new") {
                                                            setIsAddingCategory(true);
                                                        } else {
                                                            setBatchSettings((prev) => ({
                                                                ...prev,
                                                                category: value,
                                                            }));
                                                        }
                                                    }}
                                                >
                                                    <SelectTrigger id="batch-category">
                                                        <SelectValue placeholder="Select a category" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {categories.length === 0 ? (
                                                            <div className="p-2 text-sm text-gray-500">
                                                                No categories yet
                                                            </div>
                                                        ) : (
                                                            categories.map((c) => (
                                                                <SelectItem
                                                                    key={c.id}
                                                                    value={c.name}
                                                                >
                                                                    {c.name}
                                                                </SelectItem>
                                                            ))
                                                        )}
                                                        {onAddCategory && (
                                                            <SelectItem value="add-new">
                                                                <span className="flex items-center gap-2 text-purple-600">
                                                                    <Plus className="h-4 w-4" />
                                                                    Add new category
                                                                </span>
                                                            </SelectItem>
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Input
                                                value={newCategoryName}
                                                onChange={(e) =>
                                                    setNewCategoryName(e.target.value)
                                                }
                                                placeholder="Enter category name"
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        void handleAddCategoryInline();
                                                    } else if (e.key === "Escape") {
                                                        setIsAddingCategory(false);
                                                        setNewCategoryName("");
                                                    }
                                                }}
                                                disabled={isSavingCategory}
                                                autoFocus
                                            />
                                            <Button
                                                onClick={() => void handleAddCategoryInline()}
                                                size="sm"
                                                disabled={
                                                    !newCategoryName.trim() || isSavingCategory
                                                }
                                            >
                                                {isSavingCategory ? "..." : "Add"}
                                            </Button>
                                            <Button
                                                onClick={() => {
                                                    setIsAddingCategory(false);
                                                    setNewCategoryName("");
                                                }}
                                                variant="outline"
                                                size="sm"
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Document List */}
                        <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
                            <div className="mb-4">
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    Document Details
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    Review and customize each document&apos;s information
                                </p>
                            </div>

                            <div className="space-y-3">
                                {documents.map((doc, index) => (
                                    <div
                                        key={doc.id}
                                        className="border border-gray-200 dark:border-purple-500/20 rounded-lg overflow-hidden"
                                    >
                                        <div
                                            className="p-4 bg-gray-50 dark:bg-slate-800/60 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/60 transition-colors"
                                            onClick={() =>
                                                setExpandedDocId(
                                                    expandedDocId === doc.id ? null : doc.id,
                                                )
                                            }
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex-shrink-0">
                                                    {doc.status === "success" ? (
                                                        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                                                            <Check className="h-4 w-4 text-green-600" />
                                                        </div>
                                                    ) : doc.status === "error" ? (
                                                        <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                                                            <AlertCircle className="h-4 w-4 text-red-600" />
                                                        </div>
                                                    ) : doc.status === "uploading" ? (
                                                        <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/40 rounded-full flex items-center justify-center">
                                                            <Loader2 className="h-4 w-4 text-purple-600 dark:text-purple-400 animate-spin" />
                                                        </div>
                                                    ) : (
                                                        <div className="w-8 h-8 bg-gray-200 dark:bg-slate-700 rounded-full flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-400">
                                                            {index + 1}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-gray-900 dark:text-gray-200 truncate">
                                                        {doc.title}
                                                    </p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                        {formatFileSize(doc.file.size)}
                                                        {doc.status === "error" && doc.error && (
                                                            <span className="text-red-600 ml-2">
                                                                • {doc.error}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {doc.status === "uploading" && (
                                                        <span className="text-sm text-purple-600 dark:text-purple-400 font-medium">
                                                            {doc.progress}%
                                                        </span>
                                                    )}
                                                    {expandedDocId === doc.id ? (
                                                        <ChevronUp className="h-5 w-5 text-gray-400" />
                                                    ) : (
                                                        <ChevronDown className="h-5 w-5 text-gray-400" />
                                                    )}
                                                </div>
                                            </div>

                                            {doc.status === "uploading" && (
                                                <div className="mt-3">
                                                    <Progress
                                                        value={doc.progress}
                                                        className="h-1"
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {expandedDocId === doc.id && doc.status === "pending" && (
                                            <div className="p-4 border-t border-gray-200 dark:border-purple-500/20 space-y-4 bg-white dark:bg-slate-900/50">
                                                <div>
                                                    <Label htmlFor={`title-${doc.id}`}>
                                                        Document Title{" "}
                                                        <span className="text-red-500">*</span>
                                                    </Label>
                                                    <Input
                                                        id={`title-${doc.id}`}
                                                        value={doc.title}
                                                        onChange={(e) =>
                                                            updateDocument(doc.id, {
                                                                title: e.target.value,
                                                            })
                                                        }
                                                        placeholder="Enter document title"
                                                        className={
                                                            errors[`title-${doc.id}`]
                                                                ? "border-red-500"
                                                                : ""
                                                        }
                                                    />
                                                    {errors[`title-${doc.id}`] && (
                                                        <p className="text-sm text-red-600 mt-1">
                                                            {errors[`title-${doc.id}`]}
                                                        </p>
                                                    )}
                                                </div>

                                                <div>
                                                    <Label htmlFor={`category-${doc.id}`}>
                                                        Category{" "}
                                                        <span className="text-red-500">*</span>
                                                    </Label>
                                                    <Select
                                                        value={doc.category || undefined}
                                                        onValueChange={(value) =>
                                                            updateDocument(doc.id, {
                                                                category: value,
                                                            })
                                                        }
                                                    >
                                                        <SelectTrigger
                                                            id={`category-${doc.id}`}
                                                            className={
                                                                errors[`category-${doc.id}`]
                                                                    ? "border-red-500"
                                                                    : ""
                                                            }
                                                        >
                                                            <SelectValue placeholder="Select a category" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {categories.map((c) => (
                                                                <SelectItem
                                                                    key={c.id}
                                                                    value={c.name}
                                                                >
                                                                    {c.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    {errors[`category-${doc.id}`] && (
                                                        <p className="text-sm text-red-600 mt-1">
                                                            {errors[`category-${doc.id}`]}
                                                        </p>
                                                    )}
                                                </div>

                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => removeDocument(doc.id)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Remove from queue
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Advanced Options */}
                        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                            <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg shadow-sm">
                                <CollapsibleTrigger asChild>
                                    <button className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors rounded-lg">
                                        <span className="text-base font-medium text-gray-900 dark:text-gray-200">
                                            Advanced Options
                                        </span>
                                        {showAdvanced ? (
                                            <ChevronUp className="h-5 w-5 text-gray-500" />
                                        ) : (
                                            <ChevronDown className="h-5 w-5 text-gray-500" />
                                        )}
                                    </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <div className="px-6 pb-6 space-y-4 border-t border-gray-200 dark:border-purple-500/20 pt-4">
                                        {processingMethods.length > 1 && (
                                            <div>
                                                <Label className="mb-3 block">
                                                    Processing Method (Batch)
                                                </Label>
                                                <RadioGroup
                                                    value={batchSettings.processingMethod}
                                                    onValueChange={(value) =>
                                                        setBatchSettings((prev) => ({
                                                            ...prev,
                                                            processingMethod: value,
                                                        }))
                                                    }
                                                    aria-label="Processing method selection"
                                                >
                                                    {processingMethods.map((method) => (
                                                        <div
                                                            key={method.value}
                                                            className="flex items-start space-x-2"
                                                        >
                                                            <RadioGroupItem
                                                                value={method.value}
                                                                id={method.value}
                                                            />
                                                            <div className="flex-1">
                                                                <Label
                                                                    htmlFor={method.value}
                                                                    className="font-normal cursor-pointer flex items-center gap-2"
                                                                >
                                                                    {method.label}
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <span className="inline-flex items-center justify-center w-4 h-4 text-xs text-gray-500 border border-gray-300 rounded-full cursor-help">
                                                                                ?
                                                                            </span>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>
                                                                            <p className="max-w-xs">
                                                                                {method.description}
                                                                            </p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </Label>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </RadioGroup>
                                            </div>
                                        )}

                                        <div>
                                            <Label htmlFor="uploadDate">
                                                Upload Date (Batch)
                                            </Label>
                                            <Input
                                                id="uploadDate"
                                                type="date"
                                                value={batchSettings.uploadDate}
                                                onChange={(e) =>
                                                    setBatchSettings((prev) => ({
                                                        ...prev,
                                                        uploadDate: e.target.value,
                                                    }))
                                                }
                                            />
                                            <p className="text-xs text-gray-500 mt-1">
                                                Optional: Override the upload date for all
                                                documents
                                            </p>
                                        </div>

                                        <div>
                                            <Label htmlFor="storageMethod">
                                                Storage Method (Batch)
                                            </Label>
                                            <Select
                                                value={currentStorageValue}
                                                onValueChange={handleToggleChange}
                                            >
                                                <SelectTrigger id="storageMethod">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="database">
                                                        Vercel Blob
                                                    </SelectItem>
                                                    <SelectItem
                                                        value="cloud"
                                                        disabled={!isUploadThingConfigured}
                                                    >
                                                        UploadThing
                                                        {!isUploadThingConfigured &&
                                                            " (not configured)"}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {isUpdatingPreference && (
                                                <p className="text-xs text-gray-400 animate-pulse mt-1">
                                                    Updating preference...
                                                </p>
                                            )}
                                            <p className="text-xs text-gray-500 mt-1">
                                                Vercel Blob is the default. UploadThing is an optional alternative.
                                            </p>
                                        </div>
                                    </div>
                                </CollapsibleContent>
                            </div>
                        </Collapsible>

                        {/* Upload Summary */}
                        {(successCount > 0 || errorCount > 0) && (
                            <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-4 shadow-sm">
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

                        {/* Action Buttons */}
                        <div className="flex justify-between">
                            <Button
                                variant="outline"
                                onClick={() => setStep(1)}
                                disabled={isSubmitting}
                            >
                                Back
                            </Button>
                            <Button
                                onClick={() => void handleSubmit()}
                                disabled={isSubmitting || pendingCount === 0}
                            >
                                {isSubmitting
                                    ? "Uploading..."
                                    : `Upload ${pendingCount} ${pendingCount === 1 ? "Document" : "Documents"}`}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
};

export default UploadForm;
