import type { ArtifactType } from "~/lib/artifact-content";

/**
 * The two calls every file-shaped source makes on its way in, shared by the
 * Add a source panels: put the bytes in storage, then register the document,
 * which starts ingestion. Paste text, Files, Folder and Claude artifact all
 * go through here.
 */

export interface UploadResult {
    url: string;
    provider: "s3" | "database";
}

// Uses the provider-agnostic /api/upload-local route so uploads work whether the
// app is configured for S3 or database storage (NEXT_PUBLIC_STORAGE_PROVIDER).
// The old /api/storage/upload path 400s whenever storage isn't S3.
export async function uploadFileToStorage(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload-local", { method: "POST", body: form });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
        url: string;
        provider?: "s3" | "database";
    };
    return {
        url: data.url,
        provider: data.provider === "s3" ? "s3" : "database",
    };
}

export async function registerDocument(params: {
    file: File;
    url: string;
    provider: "s3" | "database";
    category: string;
    /** The source's name in the library, when it should not be the file's name. */
    documentName?: string;
    /**
     * The type ingestion should read the file as, when it differs from how
     * it is stored — an HTML artifact is stored as text/plain but read as HTML.
     */
    mimeType?: string;
    /** Marks the document as an imported Claude artifact (see ~/lib/artifact-document). */
    artifact?: { artifactType: ArtifactType; sourceUrl?: string | null };
}): Promise<void> {
    const body: Record<string, unknown> = {
        documentName: params.documentName ?? params.file.name,
        category: params.category,
        documentUrl: params.url,
        storageType: params.provider,
        mimeType: params.mimeType ?? (params.file.type || "application/octet-stream"),
        originalFilename: params.file.name,
    };
    if (params.artifact) body.artifact = params.artifact;
    const res = await fetch("/api/uploadDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Document registration failed (HTTP ${res.status}) ${text}`);
    }
}
