/**
 * Typed fetch wrappers for the artifacts API. Mirrors the serializers in
 * ~/server/artifacts/repository — keep the two in sync.
 */

import type { ArtifactType } from "~/lib/artifact-content";

export interface ArtifactSummary {
    id: number;
    title: string;
    description: string | null;
    folder: string;
    artifactType: string;
    sourceUrl: string | null;
    importMethod: string;
    sizeBytes: number;
    contentHash: string;
    starred: boolean;
    createdByUserId: string;
    updatedByUserId: string | null;
    deletedAt: string | null;
    openedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ArtifactDetail extends ArtifactSummary {
    content: string;
}

export interface ImportArtifactInput {
    title?: string;
    description?: string;
    folder?: string;
    sourceUrl?: string;
    content?: string;
    artifactType?: ArtifactType;
    importMethod?: "paste" | "upload";
    fetchFromUrl?: boolean;
}

export interface UpdateArtifactInput {
    title?: string;
    description?: string | null;
    folder?: string;
    starred?: boolean;
    sourceUrl?: string | null;
    artifactType?: ArtifactType;
    content?: string;
    restore?: boolean;
}

/** Error carrying the server's structured `code`, e.g. `claude_share_link`. */
export class ArtifactApiError extends Error {
    constructor(
        message: string,
        public readonly code?: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = "ArtifactApiError";
    }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
    const res = await fetch(input, init);
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
            code?: string;
        };
        throw new ArtifactApiError(
            body.message ?? body.error ?? `Request failed (HTTP ${res.status})`,
            body.code,
            res.status
        );
    }
    return (await res.json()) as T;
}

export async function listArtifacts(
    params: { scope?: "active" | "trash"; folder?: string } = {}
): Promise<{ artifacts: ArtifactSummary[]; folders: string[] }> {
    const query = new URLSearchParams();
    if (params.scope) query.set("scope", params.scope);
    if (params.folder) query.set("folder", params.folder);
    return request(`/api/artifacts?${query.toString()}`);
}

export async function importArtifact(input: ImportArtifactInput): Promise<ArtifactDetail> {
    const body = await request<{ artifact: ArtifactDetail }>("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    return body.artifact;
}

export async function getArtifact(id: number): Promise<ArtifactDetail> {
    const body = await request<{ artifact: ArtifactDetail }>(`/api/artifacts/${id}`);
    return body.artifact;
}

export async function updateArtifact(
    id: number,
    patch: UpdateArtifactInput
): Promise<ArtifactDetail> {
    const body = await request<{ artifact: ArtifactDetail }>(`/api/artifacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    return body.artifact;
}

export async function deleteArtifact(id: number, purge = false): Promise<void> {
    await request(`/api/artifacts/${id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
}
