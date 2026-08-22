"use client";

import type { MindmapDoc } from "../model/types";

/**
 * Typed wrappers over `/api/mindmaps`.
 *
 * Every call funnels error handling through one place, so a 401 from an expired
 * session reads the same in the gallery as in the editor.
 */

export interface MindmapSummary {
    id: number;
    title: string;
    description: string | null;
    folder: string;
    templateId: string | null;
    thumbnail: string | null;
    nodeCount: number;
    edgeCount: number;
    revision: number;
    starred: boolean;
    publishedDocumentId: number | null;
    publishedAt: string | null;
    createdByUserId: string;
    updatedByUserId: string | null;
    deletedAt: string | null;
    openedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface MindmapDetail extends MindmapSummary {
    doc: unknown;
    docVersion: number;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
    const res = await fetch(input, init);
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `Request failed (HTTP ${res.status})`);
    }
    return (await res.json()) as T;
}

export async function listMindmaps(
    params: {
        scope?: "active" | "trash";
        folder?: string;
        q?: string;
        starred?: boolean;
        mine?: boolean;
    } = {}
): Promise<{ mindmaps: MindmapSummary[]; folders: string[] }> {
    const search = new URLSearchParams();
    if (params.scope) search.set("scope", params.scope);
    if (params.folder) search.set("folder", params.folder);
    if (params.q) search.set("q", params.q);
    if (params.starred) search.set("starred", "1");
    if (params.mine) search.set("mine", "1");
    return request(`/api/mindmaps?${search.toString()}`);
}

export async function createMindmap(input: {
    title?: string;
    templateId?: string;
    folder?: string;
    doc?: MindmapDoc;
}): Promise<MindmapDetail> {
    const body = await request<{ mindmap: MindmapDetail }>("/api/mindmaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    return body.mindmap;
}

export async function getMindmap(id: number): Promise<MindmapDetail> {
    const body = await request<{ mindmap: MindmapDetail }>(`/api/mindmaps/${id}`);
    return body.mindmap;
}

export async function updateMindmap(
    id: number,
    patch: Record<string, unknown>
): Promise<MindmapDetail> {
    const body = await request<{ mindmap: MindmapDetail }>(`/api/mindmaps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    return body.mindmap;
}

export async function duplicateMindmap(id: number): Promise<MindmapDetail> {
    const body = await request<{ mindmap: MindmapDetail }>(`/api/mindmaps/${id}/duplicate`, {
        method: "POST",
    });
    return body.mindmap;
}

export async function deleteMindmap(id: number, purge = false): Promise<void> {
    await request(`/api/mindmaps/${id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
}
