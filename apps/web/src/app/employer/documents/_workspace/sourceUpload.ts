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
//
// With `onProgress` the bytes go up through XMLHttpRequest, the one browser
// API that reports upload progress — the Processing queue draws it as the
// first stage of the file's bar. Without it, a plain fetch.
export async function uploadFileToStorage(
    file: File,
    options: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {}
): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    const { status, text } = options.onProgress
        ? await postWithProgress("/api/upload-local", form, options.onProgress, options.signal)
        : await fetch("/api/upload-local", {
              method: "POST",
              body: form,
              signal: options.signal,
          }).then(async res => ({ status: res.status, text: await res.text().catch(() => "") }));
    const data = parseJson(text) as { url?: string; provider?: "s3" | "database"; error?: string };
    if (status < 200 || status >= 300 || !data.url) {
        throw new Error(`${file.name}: ${data.error ?? `upload failed (HTTP ${status})`}`);
    }
    return {
        url: data.url,
        provider: data.provider === "s3" ? "s3" : "database",
    };
}

function parseJson(text: string): Record<string, unknown> {
    try {
        const value = JSON.parse(text) as unknown;
        return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function postWithProgress(
    url: string,
    body: FormData,
    onProgress: (loaded: number, total: number) => void,
    signal?: AbortSignal
): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(event.loaded, event.total);
        };
        xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
        xhr.onerror = () => reject(new Error("The connection dropped during the upload"));
        xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
        signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(body);
    });
}

/** What registering a document started: the ingestion job the Processing queue follows. */
export interface RegisteredDocument {
    jobId: string | null;
    documentId: number | null;
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
}): Promise<RegisteredDocument> {
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
        // The route answers with one readable sentence (a recording that could
        // not be transcribed says why); show that, not the raw JSON.
        const text = await res.text().catch(() => "");
        let message = text;
        try {
            message = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
            // not JSON: keep the text
        }
        throw new Error(
            `${params.file.name}: ${message || `couldn't be added (HTTP ${res.status})`}`
        );
    }
    // 202 { jobId, document: { id } } — the job the queue follows.
    const data = (await res.json().catch(() => ({}))) as {
        jobId?: unknown;
        document?: { id?: unknown } | null;
    };
    const documentId = Number(data.document?.id);
    return {
        jobId: typeof data.jobId === "string" && data.jobId ? data.jobId : null,
        documentId: Number.isFinite(documentId) && documentId > 0 ? documentId : null,
    };
}
