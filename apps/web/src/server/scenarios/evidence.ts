/**
 * Collecting a run's evidence from the workspace, as the run's creator is
 * allowed to see it (ADR-014): picked files and file search go through their
 * document scope, company facts are filtered to facts whose source files they
 * can see, and nothing carries a real person's name into the cast (comments
 * keep their text, not their author).
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { listPartners } from "@launchstack/pipelines/distribution/db";
import {
    buildEvidence,
    type EvidenceDraft,
    type ScenarioRunRecord,
    type StoredEvidence,
} from "@launchstack/pipelines/scenarios";
import { tokenize } from "@launchstack/simulation";
import { company, document } from "@launchstack/store/schema";
import { retrieveCompanySnippets } from "@launchstack/tools/grounded-retrieval";

import type { DocumentScope } from "~/lib/authz/scope-types";
import { scopedDocumentWhere } from "~/lib/authz/scope";
import { resolveMemberContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { brandComments, companyMetadata } from "~/server/db/schema";
import { getMultiDocChunks } from "@launchstack/retrieval/algorithms/bm25";
import {
    flattenCompanyFacts,
    formatCompanyFact,
    rankCompanyFacts,
    rowsVisibleUnder,
} from "~/server/rag/company-facts";

export class ScenarioCreatorGoneError extends Error {
    constructor() {
        super("The person who started this run is no longer an active member of the workspace.");
        this.name = "ScenarioCreatorGoneError";
    }
}

export function documentHref(id: number): string {
    return `/employer/documents?docId=${id}`;
}

/** Ids among `ids` that `scope` lets its holder read. */
export async function visibleDocumentIds(
    companyId: bigint,
    scope: DocumentScope,
    ids: number[]
): Promise<Set<number>> {
    if (ids.length === 0) return new Set();
    const rows = await db
        .select({ id: document.id })
        .from(document)
        .where(and(scopedDocumentWhere(companyId, scope), inArray(document.id, [...new Set(ids)])));
    return new Set(rows.map(r => Number(r.id)));
}

function overlap(subject: Set<string>, text: string): number {
    let n = 0;
    for (const t of tokenize(text)) if (subject.has(t)) n++;
    return n;
}

function notesDrafts(notes: string): EvidenceDraft[] {
    const parts: string[] = [];
    let current = "";
    for (const para of notes.split(/\n\s*\n/)) {
        const p = para.trim();
        if (!p) continue;
        if (current && current.length + p.length > 700) {
            parts.push(current);
            current = "";
        }
        current = current ? `${current}\n${p}` : p;
    }
    if (current) parts.push(current);
    return parts.slice(0, 8).map((text, i) => ({
        kind: "notes",
        label: parts.length > 1 ? `Pasted material, part ${i + 1}` : "Pasted material",
        text,
        ref: { type: "notes", id: String(i + 1) },
        href: null,
    }));
}

/**
 * Passages read from picked files, shared between them: one business plan
 * gives up to 12, many files at least 3 each (the run keeps 40 in all).
 */
export const PICKED_PASSAGES = { total: 24, perFileMin: 3, perFileMax: 12 } as const;

async function pickedDocumentDrafts(
    companyId: bigint,
    scope: DocumentScope,
    ids: number[],
    subject: Set<string>
): Promise<EvidenceDraft[]> {
    const visible = await visibleDocumentIds(companyId, scope, ids);
    if (visible.size === 0) return [];
    const chunks = await getMultiDocChunks([...visible]);
    const byDoc = new Map<number, typeof chunks>();
    for (const c of chunks) {
        const id = Number(c.documentId);
        if (!visible.has(id)) continue;
        byDoc.set(id, [...(byDoc.get(id) ?? []), c]);
    }
    const { total, perFileMin, perFileMax } = PICKED_PASSAGES;
    const perFile = Math.max(
        perFileMin,
        Math.min(perFileMax, Math.floor(total / Math.max(1, byDoc.size)))
    );
    const ranked = [...byDoc].map(([id, list]) => ({
        id,
        best: list
            .map(c => ({ c, score: overlap(subject, c.content) }))
            .sort((a, b) => b.score - a.score || a.c.page - b.c.page)
            .slice(0, perFile)
            .map(({ c }) => c),
    }));
    // Every file's best passage first, then every file's second, … so a cap
    // further on trims the weakest passages rather than whole files.
    const drafts: EvidenceDraft[] = [];
    for (let rank = 0; rank < perFile; rank++) {
        for (const { id, best } of ranked) {
            const c = best[rank];
            if (!c) continue;
            drafts.push({
                kind: "document",
                label: c.page
                    ? `${c.documentTitle ?? "A file"}, page ${c.page}`
                    : (c.documentTitle ?? "A file"),
                text: c.content,
                ref: { type: "document", id: String(id) },
                href: documentHref(id),
                documentIds: [id],
            });
        }
    }
    return drafts;
}

async function searchDrafts(
    companyId: bigint,
    scope: DocumentScope,
    query: string
): Promise<EvidenceDraft[]> {
    const { results } = await retrieveCompanySnippets({
        companyId: Number(companyId),
        query,
        policy: { topK: 8, weights: [0.4, 0.6], maxSnippets: 8, maxSnippetChars: 600 },
        scope,
        onError: "empty",
    });
    const ids = results
        .map(r => r.metadata.documentId)
        .filter((id): id is number => typeof id === "number");
    // Retrieval already applied the scope; check again so a stale index can't leak a file.
    const visible = await visibleDocumentIds(companyId, scope, ids);
    return results
        .filter(
            r => typeof r.metadata.documentId === "number" && visible.has(r.metadata.documentId)
        )
        .map(r => {
            const id = r.metadata.documentId!;
            return {
                kind: "search" as const,
                label: r.metadata.documentTitle ?? "A file",
                text: r.pageContent,
                ref: { type: "document", id: String(id) },
                href: documentHref(id),
                documentIds: [id],
            };
        });
}

async function prospectDrafts(companyId: bigint): Promise<EvidenceDraft[]> {
    const items = await listPartners(companyId);
    return items
        .slice()
        .sort((a, b) => (b.relationship.fitScore ?? 0) - (a.relationship.fitScore ?? 0))
        .slice(0, 12)
        .map(({ org, relationship }) => ({
            kind: "prospect" as const,
            label: `Prospect: ${org.name}`,
            text: [
                org.name,
                org.categories.length > 0 ? `(${org.categories.join(", ")})` : "",
                org.sizeBand ? `size ${org.sizeBand}.` : "",
                org.description ?? "",
                relationship.fitRationale ? `Why they fit: ${relationship.fitRationale}` : "",
                `Stage: ${relationship.stage}.`,
            ]
                .filter(Boolean)
                .join(" "),
            ref: { type: "prospect", id: org.id },
            href: null,
        }));
}

async function commentDrafts(companyId: bigint): Promise<EvidenceDraft[]> {
    const rows = await db
        .select({
            id: brandComments.id,
            platform: brandComments.platform,
            body: brandComments.body,
        })
        .from(brandComments)
        .where(and(eq(brandComments.companyId, companyId), eq(brandComments.isOwn, false)))
        .orderBy(desc(brandComments.createdAt))
        .limit(15);
    return rows.map(r => ({
        kind: "brand_comment" as const,
        label: `Comment on your ${r.platform} post`,
        text: r.body,
        ref: { type: "brand_comment", id: r.id },
        href: null,
    }));
}

async function profileDrafts(
    companyId: bigint,
    scope: DocumentScope,
    query: string
): Promise<EvidenceDraft[]> {
    const [row] = await db
        .select({ metadata: companyMetadata.metadata })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, companyId))
        .limit(1);
    if (!row) return [];
    const facts = flattenCompanyFacts(row.metadata);
    const visible = await visibleDocumentIds(
        companyId,
        scope,
        facts.flatMap(f => f.sourceDocumentIds)
    );
    return rankCompanyFacts(query, rowsVisibleUnder(facts, visible), 8).map(({ row: fact }) => ({
        kind: "company_profile" as const,
        label: `Company profile: ${fact.subject}`,
        text: formatCompanyFact(fact),
        ref: { type: "company_profile", id: fact.path },
        href: null,
        documentIds: fact.sourceDocumentIds.filter(id => visible.has(id)),
    }));
}

/** How long one source may take before the run goes on without it. */
export const SOURCE_TIMEOUT_MS = 30_000;

/**
 * A source that errors or takes too long is skipped, not fatal: a run with
 * four sources out of five is still worth having, and the evidence list
 * shows exactly what was used.
 */
export async function bounded<T>(
    label: string,
    work: Promise<T[]>,
    ms = SOURCE_TIMEOUT_MS
): Promise<T[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T[]>(resolve => {
        timer = setTimeout(() => {
            console.warn(
                `[scenarios] ${label} took over ${Math.round(ms / 1000)}s; going on without it`
            );
            resolve([]);
        }, ms);
    });
    try {
        return await Promise.race([
            work.catch((error: unknown) => {
                console.warn(`[scenarios] ${label} failed; going on without it:`, error);
                return [] as T[];
            }),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export async function gatherScenarioEvidence(run: ScenarioRunRecord): Promise<StoredEvidence[]> {
    const member = await resolveMemberContext(run.createdByUserId, run.companyId);
    if (!member) throw new ScenarioCreatorGoneError();
    const scope = await member.documentScope();
    const s = run.sources;
    const query =
        run.kind === "post_test" && run.draft ? `${run.subject}\n${run.draft.text}` : run.subject;
    const subject = new Set(tokenize(query));
    const groups = await Promise.all([
        Promise.resolve(notesDrafts(s.notes)),
        s.documentIds.length > 0
            ? bounded(
                  "picked files",
                  pickedDocumentDrafts(run.companyId, scope, s.documentIds, subject)
              )
            : [],
        s.searchFiles ? bounded("file search", searchDrafts(run.companyId, scope, query)) : [],
        s.prospects ? bounded("prospects", prospectDrafts(run.companyId)) : [],
        s.brandComments ? bounded("comments", commentDrafts(run.companyId)) : [],
        s.companyProfile
            ? bounded("company profile", profileDrafts(run.companyId, scope, query))
            : [],
    ]);
    return buildEvidence(groups.flat(), { max: 40 });
}

/** The workspace's name and a handle for the brand account in a post test. */
export async function brandIdentity(companyId: bigint): Promise<{ name: string; handle: string }> {
    const [row] = await db
        .select({ name: company.name })
        .from(company)
        .where(eq(company.id, Number(companyId)))
        .limit(1);
    const trimmed = row?.name?.trim() ?? "";
    const name = trimmed.length > 0 ? trimmed : "Your company";
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 20);
    return { name, handle: `@${slug || "yourcompany"}` };
}
