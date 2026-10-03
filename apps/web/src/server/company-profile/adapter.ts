/**
 * The company profile as the screen sees it — pure. Turns the profile row,
 * the per-source rows and the workspace's documents into the one DTO both
 * Settings › Company and Proposals › Profile render.
 */
import {
    METADATA_SCHEMA_VERSION,
    READER_VERSION,
    isCounted,
    profileView,
    type CompanyProfileSourceRow,
    type ProfileDocument,
    type ProfileRow,
} from "@launchstack/pipelines/company-metadata";

import type {
    CompanyProfileDto,
    CompanyProfileStatus,
    ProfileSourceDto,
} from "~/lib/company-profile/dto";

/** A build that has said "building" this long without finishing is treated as dead. */
export const STUCK_BUILD_MS = 15 * 60 * 1000;

export function sourceHref(documentId: number): string {
    return `/employer/documents?source=d${documentId}`;
}

export interface ProfileDtoInput {
    row: ProfileRow | null;
    sources: CompanyProfileSourceRow[];
    documents: ProfileDocument[];
    name: string;
    canEdit: boolean;
    /** Whether the viewer may open a document; their profile leaves the rest out. */
    canSee: (doc: { id: number; folder: string }) => boolean;
    now: Date;
}

export function isBuilding(row: ProfileRow | null, now: Date): boolean {
    return (
        row?.buildStatus === "building" &&
        !!row.buildStartedAt &&
        now.getTime() - row.buildStartedAt.getTime() < STUCK_BUILD_MS
    );
}

function statusOf(row: ProfileRow | null, now: Date): CompanyProfileStatus {
    if (isBuilding(row, now)) return "building";
    if (row?.buildStatus === "failed") return "failed";
    if (!row?.builtAt) return "empty";
    return "ready";
}

export function toCompanyProfileDto(input: ProfileDtoInput): CompanyProfileDto {
    const visibleDocs = input.documents.filter(d => input.canSee(d));
    const visibleIds = new Set(visibleDocs.map(d => d.id));
    const view = profileView(input.row?.metadata ?? null, { canSee: id => visibleIds.has(id) });
    const byDocument = new Map(input.sources.map(s => [Number(s.documentId), s]));

    const sources: ProfileSourceDto[] = visibleDocs.map(doc => {
        const row = byDocument.get(doc.id) ?? null;
        const counted = row ? isCounted(row) : false;
        return {
            documentId: doc.id,
            title: doc.title,
            folder: doc.folder,
            role: row?.role ?? null,
            roleBy: row?.roleBy ?? null,
            reason: row?.reason ?? null,
            override: row?.override ?? null,
            counted,
            facts: counted ? (row?.factCount ?? 0) : 0,
            status: row?.status ?? "pending",
            error: row?.status === "failed" ? (row.error ?? "Reading it failed") : null,
            href: sourceHref(doc.id),
        };
    });

    const status = statusOf(input.row, input.now);
    const metadata = input.row?.metadata ?? null;
    const stale =
        status === "ready" &&
        (metadata?.schema_version !== METADATA_SCHEMA_VERSION ||
            visibleDocs.some(doc => {
                const row = byDocument.get(doc.id);
                return (
                    !row ||
                    row.readerVersion !== READER_VERSION ||
                    (row.versionId === null ? null : Number(row.versionId)) !== doc.currentVersionId
                );
            }));

    return {
        status,
        error: status === "failed" ? (input.row?.buildError ?? "The last build failed") : null,
        builtAt: input.row?.builtAt?.toISOString() ?? null,
        stale,
        name: input.name,
        summary: view.summary,
        summaryCites: view.summaryCites,
        applicantType: view.applicantType,
        focusAreas: view.focusAreas,
        geography: view.geography,
        markets: view.markets,
        facts: view.facts.map(f => ({
            path: f.path,
            label: f.label,
            value: f.value,
            cites: f.cites,
            source: f.source,
        })),
        people: view.people,
        services: view.services,
        projects: view.projects,
        evidence: view.evidence.map(e => ({
            ...e,
            href:
                e.documentId !== null && visibleIds.has(e.documentId)
                    ? sourceHref(e.documentId)
                    : null,
        })),
        sources,
        counts: {
            sources: sources.length,
            counted: sources.filter(s => s.counted).length,
            setAside: sources.filter(s => s.status === "done" && !s.counted).length,
            pending: sources.filter(s => s.status === "pending").length,
        },
        canEdit: input.canEdit,
    };
}
