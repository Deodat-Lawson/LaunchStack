/**
 * The v2 source collector (`StagePorts["collectSources"]`): captures a run's
 * selected sources as the run's creator may read them (ADR-014), with enough
 * of a locator to cite each quote later.
 *
 * - Picked files: the current version's sections with document, version,
 *   chunk, page and heading path (from the document's structure tree, when
 *   the chunker kept one). Sections are ranked against the subject; the best
 *   and their neighbours are kept under the per-document budget, and what is
 *   left out is recorded. A file the creator can't open, one still being
 *   processed and one with no text are recorded too, never silently dropped.
 * - Company facts: typed facts (ADR-011) read from the picked files, and,
 *   when the creator asked for the company profile, the facts that match
 *   the subject (v1's rule), each only when the creator can see a file it was
 *   read from. They keep their key and value, not just text.
 * - File search, prospects, Brand comments (beta apps only), pasted notes:
 *   as v1, with `validity: "unknown"` where the source keeps no versions.
 *
 * The `sources` stage then ranks across sources, holds the whole run to the
 * budget and numbers the result.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import type { EvidenceDraft, ScenarioRunRecord } from "@launchstack/pipelines/scenarios";
import {
    approxTokens,
    type EvidenceLocator,
    type RequestSpecV2,
    type SnapshotSourceType,
    type SourceCollection,
    type SourceOmission,
    type SourceSectionDraft,
} from "@launchstack/pipelines/scenarios/v2";
import { tokenize } from "@launchstack/simulation";
import { document, documentSections, documentStructure, ocrJobs } from "@launchstack/store/schema";
import { retrieveCompanySnippets } from "@launchstack/tools/grounded-retrieval";

import type { DocumentScope } from "~/lib/authz/scope-types";
import { resolveMemberContext } from "~/lib/require-workspace-context";
import { betaAppsOn } from "~/server/beta-apps";
import { db } from "~/server/db";
import { companyMetadata } from "~/server/db/schema";
import {
    flattenCompanyFacts,
    formatCompanyFact,
    rankCompanyFacts,
    rowsCitingDocuments,
    rowsVisibleUnder,
    type CompanyFactRow,
} from "~/server/rag/company-facts";
import {
    commentDrafts,
    documentHref,
    notesDrafts,
    overlap,
    prospectDrafts,
    ScenarioCreatorGoneError,
    SOURCE_TIMEOUT_MS,
    visibleDocumentIds,
} from "~/server/scenarios/evidence";

export const COLLECTOR_LIMITS = {
    /** Longest single section; a longer chunk keeps its opening sentences. */
    sectionTokens: 1_200,
    /** Typed facts read from the picked files. */
    pickedFacts: 12,
    /** Facts the company profile adds when asked for (v1's number). */
    profileFacts: 8,
    /** File-search hits (v1's number). */
    searchHits: 8,
} as const;

/** A neighbour of a strong section is worth most of its score: it is its context. */
const NEIGHBOUR_WEIGHT = 0.8;

const NO_LOCATOR: EvidenceLocator = {
    documentId: null,
    versionId: null,
    chunkId: null,
    page: null,
    section: null,
    providerId: null,
};

const EMPTY: SourceCollection = { sections: [], omissions: [] };

function merge(parts: SourceCollection[]): SourceCollection {
    return {
        sections: parts.flatMap(p => p.sections),
        omissions: parts.flatMap(p => p.omissions),
    };
}

function omission(
    sourceType: SnapshotSourceType,
    sourceId: string,
    label: string,
    reason: SourceOmission["reason"],
    tokens: number | null = null
): SourceOmission {
    return { sourceType, sourceId, label, reason, tokens };
}

/**
 * Run one source with v1's time limit. A source that errors or takes too
 * long is recorded as not ready rather than failing the run.
 */
async function guarded(
    what: { sourceType: SnapshotSourceType; sourceId: string; label: string },
    work: () => Promise<SourceCollection>,
    ms = SOURCE_TIMEOUT_MS
): Promise<SourceCollection> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fallback: SourceCollection = {
        sections: [],
        omissions: [omission(what.sourceType, what.sourceId, what.label, "not_ready")],
    };
    const timeout = new Promise<SourceCollection>(resolve => {
        timer = setTimeout(() => {
            console.warn(
                `[scenarios] ${what.label} took over ${Math.round(ms / 1000)}s; going on without it`
            );
            resolve(fallback);
        }, ms);
    });
    try {
        return await Promise.race([
            work().catch((error: unknown) => {
                console.warn(`[scenarios] ${what.label} failed; going on without it:`, error);
                return fallback;
            }),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** The opening of a too-long section, cut at a sentence when one ends in time. */
export function clipSection(text: string, maxTokens: number): string {
    const flat = text.trim();
    const max = maxTokens * 4;
    if (flat.length <= max) return flat;
    const head = flat.slice(0, max);
    const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"));
    return (stop > max / 2 ? head.slice(0, stop + 1) : head).trimEnd();
}

/** "/Pricing/Enterprise" → "Pricing › Enterprise"; the root and missing nodes give null. */
export function headingPath(node: {
    heading: string | null;
    path: string | null;
    level: number | null;
}): string | null {
    if (!node.level || node.level < 1) return null;
    const steps = (node.path ?? "").split("/").filter(Boolean);
    if (steps.length > 0) return steps.join(" › ");
    const heading = node.heading?.trim();
    return heading && heading.length > 0 ? heading : null;
}

/** Page numbers start at 1; 0 and missing mean the store doesn't know. */
function pageOrNull(page: number | null | undefined): number | null {
    return typeof page === "number" && page > 0 ? page : null;
}

/** A finite number from loosely typed search metadata, else null. */
function numberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ChunkRow {
    id: number;
    documentId: number;
    versionId: number | null;
    content: string;
    page: number | null;
    heading: string | null;
    path: string | null;
    level: number | null;
}

/**
 * Pick one document's sections: rank against the subject, then take the
 * best sections with their neighbours while they fit the budget. Returns
 * the kept sections in rank order with a 0–1 score, and the tokens left out.
 */
export function pickDocumentSections(
    chunks: ChunkRow[],
    subject: Set<string>,
    budgetTokens: number,
    sectionTokens: number = COLLECTOR_LIMITS.sectionTokens
): { kept: Array<{ chunk: ChunkRow; text: string; score: number }>; leftOut: number } {
    const texts = chunks.map(c => clipSection(c.content, sectionTokens));
    const tokens = texts.map(t => approxTokens(t));
    const clipped = chunks.reduce(
        (sum, c, i) => sum + Math.max(0, approxTokens(c.content.trim()) - tokens[i]!),
        0
    );
    const own = chunks.map(c =>
        Math.min(1, overlap(subject, c.content) / Math.max(1, subject.size))
    );
    const order = chunks.map((_, i) => i).sort((a, b) => own[b]! - own[a]! || a - b);
    const score = new Map<number, number>();
    let used = 0;
    const take = (i: number, s: number) => {
        if (i < 0 || i >= chunks.length || score.has(i) || !texts[i]) return;
        if (used + tokens[i]! > budgetTokens) return;
        score.set(i, Math.max(own[i]!, s));
        used += tokens[i]!;
    };
    for (const i of order) {
        if (!score.has(i)) take(i, own[i]!);
        if (!score.has(i)) continue;
        take(i - 1, own[i]! * NEIGHBOUR_WEIGHT);
        take(i + 1, own[i]! * NEIGHBOUR_WEIGHT);
    }
    const kept = [...score]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([i, s]) => ({ chunk: chunks[i]!, text: texts[i]!, score: s }));
    const leftOut = clipped + tokens.reduce((sum, t, i) => (score.has(i) ? sum : sum + t), 0);
    return { kept, leftOut };
}

function documentLabel(title: string, page: number | null): string {
    return page ? `${title}, page ${page}` : title;
}

async function documentSourceSections(
    companyId: bigint,
    scope: DocumentScope,
    ids: number[],
    subject: Set<string>,
    perDocumentTokens: number
): Promise<SourceCollection> {
    const picked = [...new Set(ids)];
    const visible = await visibleDocumentIds(companyId, scope, picked);
    // Never name a file the creator can't open.
    const omissions: SourceOmission[] = picked
        .filter(id => !visible.has(id))
        .map(id => omission("document", String(id), "A file you can't open", "no_access"));
    if (visible.size === 0) return { sections: [], omissions };

    const docIds = [...visible];
    const docs = await db
        .select({
            id: document.id,
            title: document.title,
            currentVersionId: document.currentVersionId,
        })
        .from(document)
        .where(and(eq(document.companyId, companyId), inArray(document.id, docIds)));
    const rows = await db
        .select({
            id: documentSections.id,
            documentId: documentSections.documentId,
            versionId: documentSections.versionId,
            content: documentSections.content,
            page: documentSections.pageNumber,
            heading: documentStructure.title,
            path: documentStructure.path,
            level: documentStructure.level,
        })
        .from(documentSections)
        .innerJoin(document, eq(documentSections.documentId, document.id))
        .leftJoin(documentStructure, eq(documentSections.structureId, documentStructure.id))
        .where(
            and(
                inArray(
                    documentSections.documentId,
                    docIds.map(id => BigInt(id))
                ),
                eq(documentSections.versionId, document.currentVersionId)
            )
        )
        .orderBy(asc(documentSections.documentId), asc(documentSections.id));

    const byDoc = new Map<number, ChunkRow[]>();
    for (const r of rows) {
        const documentId = Number(r.documentId);
        if (!visible.has(documentId)) continue;
        const chunk: ChunkRow = {
            id: Number(r.id),
            documentId,
            versionId: r.versionId != null ? Number(r.versionId) : null,
            content: r.content,
            page: r.page ?? null,
            heading: r.heading ?? null,
            path: r.path ?? null,
            level: r.level ?? null,
        };
        byDoc.set(documentId, [...(byDoc.get(documentId) ?? []), chunk]);
    }

    // A file with no current-version text: still processing, or nothing to read.
    const unread = docs.filter(d => !byDoc.get(Number(d.id))?.some(c => c.content.trim()));
    const jobs =
        unread.length > 0
            ? await db
                  .select({
                      documentId: ocrJobs.documentId,
                      versionId: ocrJobs.versionId,
                      status: ocrJobs.status,
                  })
                  .from(ocrJobs)
                  .where(
                      inArray(
                          ocrJobs.documentId,
                          unread.map(d => BigInt(d.id))
                      )
                  )
            : [];
    const sections: SourceSectionDraft[] = [];
    for (const doc of [...docs].sort(
        (a, b) => picked.indexOf(Number(a.id)) - picked.indexOf(Number(b.id))
    )) {
        const id = Number(doc.id);
        const title = doc.title || "A file";
        const chunks = byDoc.get(id)?.filter(c => c.content.trim()) ?? [];
        if (chunks.length === 0) {
            const finished = jobs.some(
                j =>
                    Number(j.documentId) === id &&
                    j.status === "completed" &&
                    (j.versionId == null || j.versionId === doc.currentVersionId)
            );
            omissions.push(
                omission(
                    "document",
                    String(id),
                    title,
                    doc.currentVersionId && finished ? "empty" : "not_ready"
                )
            );
            continue;
        }
        const { kept, leftOut } = pickDocumentSections(chunks, subject, perDocumentTokens);
        for (const { chunk, text, score } of kept) {
            sections.push({
                kind: "document",
                sourceType: "document",
                sourceId: String(id),
                versionId: chunk.versionId != null ? String(chunk.versionId) : null,
                label: documentLabel(title, chunk.page),
                locator: {
                    documentId: id,
                    versionId: chunk.versionId,
                    chunkId: chunk.id,
                    page: pageOrNull(chunk.page),
                    section: headingPath(chunk),
                    providerId: null,
                },
                text,
                fact: null,
                validity: chunk.versionId != null ? "versioned" : "unknown",
                documentIds: [id],
                href: documentHref(id),
                score,
            });
        }
        if (leftOut > 0) omissions.push(omission("document", String(id), title, "budget", leftOut));
    }
    return { sections, omissions };
}

async function searchSourceSections(
    companyId: bigint,
    scope: DocumentScope,
    query: string
): Promise<SourceCollection> {
    const { results } = await retrieveCompanySnippets({
        companyId: Number(companyId),
        query,
        policy: {
            topK: COLLECTOR_LIMITS.searchHits,
            weights: [0.4, 0.6],
            maxSnippets: COLLECTOR_LIMITS.searchHits,
            maxSnippetChars: 600,
        },
        scope,
        onError: "empty",
    });
    const ids = results
        .map(r => r.metadata.documentId)
        .filter((id): id is number => typeof id === "number");
    // Retrieval already applied the scope; check again so a stale index can't leak a file.
    const visible = await visibleDocumentIds(companyId, scope, ids);
    const hits = results.filter(
        r => typeof r.metadata.documentId === "number" && visible.has(r.metadata.documentId)
    );
    return {
        sections: hits.map((r, i) => {
            const id = r.metadata.documentId!;
            const versionId = numberOrNull(r.metadata.versionId);
            const page = pageOrNull(r.metadata.page);
            return {
                kind: "search",
                sourceType: "search",
                sourceId: String(id),
                versionId: versionId != null ? String(versionId) : null,
                label: documentLabel(r.metadata.documentTitle ?? "A file", page),
                locator: {
                    ...NO_LOCATOR,
                    documentId: id,
                    versionId,
                    chunkId:
                        numberOrNull(r.metadata.parentChunkId) ?? numberOrNull(r.metadata.chunkId),
                    page,
                },
                text: r.pageContent,
                fact: null,
                validity: versionId != null ? "versioned" : "unknown",
                documentIds: [id],
                href: documentHref(id),
                score: 1 - i / Math.max(1, hits.length),
            } satisfies SourceSectionDraft;
        }),
        omissions: [],
    };
}

/** v1 drafts from a source that keeps no versions (prospects, comments, notes). */
function unversioned(
    drafts: EvidenceDraft[],
    sourceType: SnapshotSourceType,
    score: (i: number, n: number) => number
): SourceSectionDraft[] {
    return drafts.map((d, i) => ({
        kind: d.kind,
        sourceType,
        sourceId: d.ref.id,
        versionId: null,
        label: d.label,
        locator: NO_LOCATOR,
        text: d.text,
        fact: null,
        validity: "unknown",
        documentIds: d.documentIds ?? [],
        href: d.href,
        score: score(i, drafts.length),
    }));
}

const byOrder = (i: number, n: number) => 1 - i / Math.max(1, n);

/** A typed fact as a section: its key and value kept, the text only from files the creator can see. */
function factSection(
    row: CompanyFactRow,
    visible: ReadonlySet<number>,
    sourceType: "company_fact" | "company_profile",
    score: number
): SourceSectionDraft {
    const sourceVisible = row.source && visible.has(row.source.doc_id) ? row.source : undefined;
    const documentIds = row.sourceDocumentIds.filter(id => visible.has(id)).sort((a, b) => a - b);
    return {
        kind: "company_profile",
        sourceType,
        sourceId: row.path,
        versionId: null,
        label: `Company profile: ${row.subject}`,
        locator: {
            ...NO_LOCATOR,
            documentId: sourceVisible?.doc_id ?? documentIds[0] ?? null,
            versionId: sourceVisible?.version_id ?? null,
            page: sourceVisible?.page ?? null,
        },
        // Name and quote a source only when the creator can open it.
        text: formatCompanyFact({ ...row, source: sourceVisible }),
        fact: {
            key: row.path,
            label: row.subject,
            value: row.details.map(d => `${d.field}: ${d.value}`).join("; "),
            sourceDocumentIds: documentIds,
        },
        validity: "unknown",
        documentIds,
        href: null,
        score,
    };
}

async function factSourceSections(
    companyId: bigint,
    scope: DocumentScope,
    query: string,
    pickedDocumentIds: number[],
    profile: boolean
): Promise<SourceCollection> {
    const [row] = await db
        .select({ metadata: companyMetadata.metadata })
        .from(companyMetadata)
        .where(eq(companyMetadata.companyId, companyId))
        .limit(1);
    if (!row) {
        return {
            sections: [],
            omissions: profile
                ? [omission("company_profile", "profile", "Company profile", "empty")]
                : [],
        };
    }
    const facts = flattenCompanyFacts(row.metadata);
    const visible = await visibleDocumentIds(
        companyId,
        scope,
        facts.flatMap(f => f.sourceDocumentIds)
    );
    const readable = rowsVisibleUnder(facts, visible);
    const pickedVisible = pickedDocumentIds.filter(id => visible.has(id));

    // Facts read from the picked files: subject matches first, then the most confident.
    const fromFiles = rowsCitingDocuments(readable, pickedVisible);
    const matched = rankCompanyFacts(query, fromFiles, fromFiles.length).map(r => r.row);
    const rest = fromFiles
        .filter(r => !matched.includes(r))
        .sort((a, b) => b.confidence - a.confidence || a.path.localeCompare(b.path));
    const typed = [...matched, ...rest].slice(0, COLLECTOR_LIMITS.pickedFacts);
    const sections = typed.map((r, i) =>
        factSection(r, visible, "company_fact", byOrder(i, typed.length))
    );

    if (profile) {
        const taken = new Set(typed.map(r => r.path));
        const ranked = rankCompanyFacts(query, readable, COLLECTOR_LIMITS.profileFacts + taken.size)
            .map(r => r.row)
            .filter(r => !taken.has(r.path))
            .slice(0, COLLECTOR_LIMITS.profileFacts);
        sections.push(
            ...ranked.map((r, i) =>
                factSection(r, visible, "company_profile", byOrder(i, ranked.length))
            )
        );
        if (ranked.length === 0 && typed.length === 0)
            return {
                sections,
                omissions: [omission("company_profile", "profile", "Company profile", "empty")],
            };
    }
    return { sections, omissions: [] };
}

/** Drop search hits that repeat a section already taken from a picked file. */
function withoutRepeats(collection: SourceCollection): SourceCollection {
    const chunks = new Set(
        collection.sections
            .filter(s => s.sourceType === "document" && s.locator.chunkId != null)
            .map(s => s.locator.chunkId)
    );
    const texts = new Set(
        collection.sections.filter(s => s.sourceType === "document").map(s => s.text.trim())
    );
    return {
        ...collection,
        sections: collection.sections.filter(
            s =>
                s.sourceType !== "search" ||
                !(
                    (s.locator.chunkId != null && chunks.has(s.locator.chunkId)) ||
                    texts.has(s.text.trim())
                )
        ),
    };
}

/** `StagePorts["collectSources"]` for this app. */
export async function collectScenarioSources(
    run: ScenarioRunRecord,
    spec: RequestSpecV2
): Promise<SourceCollection> {
    const member = await resolveMemberContext(run.createdByUserId, run.companyId);
    if (!member) throw new ScenarioCreatorGoneError();
    const scope = await member.documentScope();
    const s = spec.sources;
    const query = spec.subject;
    const subject = new Set(tokenize(query));
    const companyId = run.companyId;
    const wantsGrowth = s.prospects || s.brandComments;
    const growth = wantsGrowth ? await betaAppsOn(companyId) : false;

    const parts = await Promise.all([
        Promise.resolve<SourceCollection>({
            sections: unversioned(notesDrafts(s.notes), "notes", () => 1),
            omissions: [],
        }),
        s.documentIds.length > 0
            ? guarded({ sourceType: "document", sourceId: "picked", label: "Picked files" }, () =>
                  documentSourceSections(
                      companyId,
                      scope,
                      s.documentIds,
                      subject,
                      spec.policies.sourceBudget.perDocumentTokens
                  )
              )
            : EMPTY,
        s.searchFiles
            ? guarded({ sourceType: "search", sourceId: "search", label: "File search" }, () =>
                  searchSourceSections(companyId, scope, query)
              )
            : EMPTY,
        // Prospects and post comments are Growth's: read only while beta apps are on.
        s.prospects
            ? growth
                ? guarded(
                      { sourceType: "prospect", sourceId: "prospects", label: "Prospects" },
                      async () => ({
                          sections: unversioned(
                              await prospectDrafts(companyId),
                              "prospect",
                              byOrder
                          ),
                          omissions: [],
                      })
                  )
                : {
                      sections: [],
                      omissions: [omission("prospect", "prospects", "Prospects", "no_access")],
                  }
            : EMPTY,
        s.brandComments
            ? growth
                ? guarded(
                      {
                          sourceType: "brand_comment",
                          sourceId: "comments",
                          label: "Comments on your posts",
                      },
                      async () => ({
                          sections: unversioned(
                              await commentDrafts(companyId),
                              "brand_comment",
                              byOrder
                          ),
                          omissions: [],
                      })
                  )
                : {
                      sections: [],
                      omissions: [
                          omission(
                              "brand_comment",
                              "comments",
                              "Comments on your posts",
                              "no_access"
                          ),
                      ],
                  }
            : EMPTY,
        s.companyProfile || s.documentIds.length > 0
            ? guarded(
                  { sourceType: "company_fact", sourceId: "facts", label: "Company facts" },
                  () => factSourceSections(companyId, scope, query, s.documentIds, s.companyProfile)
              )
            : EMPTY,
    ]);
    return withoutRepeats(merge(parts));
}
