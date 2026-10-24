import type { useTranslations } from "next-intl";

import type { ArtifactType } from "~/lib/artifact-content";

/**
 * The two calls every file-shaped source makes on its way in, shared by the
 * Add a source panels: put the bytes in storage, then register the document,
 * which starts ingestion. Paste text, Files, Folder and Claude artifact all
 * go through here.
 */

/**
 * A file that did not make it in. `message` reads "<file>: <why>" in the
 * server's words, or English; `sourceUploadErrorMessage` says it in the
 * reader's language.
 */
export class SourceUploadError extends Error {
    constructor(
        readonly fileName: string,
        /** Storing the bytes, or registering the document. */
        readonly step: "upload" | "register",
        readonly status: number,
        /** The route's own sentence, shown as is; null when it gave none. */
        readonly serverMessage: string | null
    ) {
        super(
            `${fileName}: ${
                serverMessage ??
                (step === "upload"
                    ? `upload failed (HTTP ${status})`
                    : `couldn't be added (HTTP ${status})`)
            }`
        );
        this.name = "SourceUploadError";
    }
}

/** `useTranslations("sources.sourceUpload")`. */
export type SourceUploadTranslator = ReturnType<typeof useTranslations<"sources.sourceUpload">>;

/** What to show for an error from this module; `otherwise` for anything else thrown. */
export function sourceUploadErrorMessage(
    error: unknown,
    t: SourceUploadTranslator,
    otherwise: string
): string {
    if (error instanceof SourceUploadError) {
        if (error.serverMessage !== null) {
            return t("withReason", { name: error.fileName, reason: error.serverMessage });
        }
        return t(error.step === "upload" ? "uploadFailed" : "registerFailed", {
            name: error.fileName,
            status: error.status,
        });
    }
    return error instanceof Error ? error.message : otherwise;
}

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
        throw new SourceUploadError(file.name, "upload", res.status, body.error ?? null);
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
        // The route answers with one readable sentence (a recording that could
        // not be transcribed says why); show that, not the raw JSON.
        const text = await res.text().catch(() => "");
        let message = text;
        try {
            message = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
            // not JSON: keep the text
        }
        throw new SourceUploadError(params.file.name, "register", res.status, message || null);
    }
}
