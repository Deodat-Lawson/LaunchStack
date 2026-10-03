/**
 * Building the company profile — the one builder behind Settings › Company,
 * Proposals › Profile, chat's company facts and every pipeline that reads
 * company metadata.
 *
 *   read a source   chunks → clean passages → sort (about us? someone
 *                   else's? nothing?) → when it counts, cited facts.
 *                   Cached per (version, reader version, chunk count): a
 *                   redelivered event or an unchanged document costs nothing.
 *   assemble        every counted source's facts merged fresh, the
 *                   previous profile's edits laid back on top, the summary
 *                   rewritten only when the facts changed, saved under the
 *                   row lock.
 *
 * A new upload reads one source and reassembles; "Rebuild" reads every
 * source that changed and reassembles.
 */
import { getCompanyIdentity } from "@launchstack/tools/company-context";

import { applyManualOverrides, assembleMetadata, diffMetadata, factsHash } from "./assemble";
import {
    getProfileRow,
    getSourceRow,
    getWorkspaceDocument,
    isCounted,
    listCountedSources,
    listWorkspaceDocuments,
    loadVersionChunks,
    saveProfileLocked,
    setBuildStatus,
    upsertSourceRow,
    type ProfileDocument,
} from "./db";
import { extractSourceFacts, runWithConcurrency, type GenerateStructuredFn } from "./extractor";
import { cleanPassages } from "./passages";
import { READER_VERSION } from "./prompts";
import { synthesizeProfile } from "./synthesize";
import { sourceKindOf, triageSource } from "./triage";
import type { CompanyMetadataJSON, CompanyProfileSourceRow, SourceOverride } from "./types";

export interface ProfileBuildPorts {
    generate: GenerateStructuredFn;
    /** Recorded on source rows and the profile, for provenance. */
    modelId?: string;
    /** The organisation's name and what is known about it; defaults to the company record. */
    identity?: (companyId: bigint) => Promise<CompanyIdentityHint>;
    now?: () => Date;
}

export interface CompanyIdentityHint {
    name: string;
    known: string[];
}

/** Sources read at once during a rebuild; each source runs its own calls in parallel too. */
const REBUILD_CONCURRENCY = 3;

async function identityOf(
    companyId: bigint,
    ports: ProfileBuildPorts
): Promise<CompanyIdentityHint> {
    if (ports.identity) return ports.identity(companyId);
    const { data } = await getCompanyIdentity({ companyId: Number(companyId) });
    return {
        name: data.name,
        known: [
            data.description ? `Description: ${data.description}` : "",
            data.industry ? `Industry: ${data.industry}` : "",
        ].filter(Boolean),
    };
}

/** True when the row already reflects this document as it is now. */
export function isSourceFresh(
    row: CompanyProfileSourceRow | null,
    doc: Pick<ProfileDocument, "currentVersionId">,
    chunkCount: number
): boolean {
    if (!row || row.status !== "done") return false;
    if (row.readerVersion !== READER_VERSION) return false;
    if ((row.versionId === null ? null : Number(row.versionId)) !== doc.currentVersionId)
        return false;
    if ((row.passages?.total ?? -1) !== chunkCount) return false;
    // Counted now (e.g. a person just said "this is about us") but never read for facts.
    if (isCounted(row) && row.facts === null) return false;
    return true;
}

/**
 * Read one source: sort it, and read its facts when it counts. Returns the
 * row, or null when the document is not in this workspace. Never throws for
 * a model failure: the row records it as failed and the rest of a build
 * carries on.
 */
export async function readSource(
    companyId: bigint,
    documentId: number,
    ports: ProfileBuildPorts,
    options: { force?: boolean; identity?: CompanyIdentityHint } = {}
): Promise<CompanyProfileSourceRow | null> {
    const doc = await getWorkspaceDocument(companyId, documentId);
    if (!doc) return null;
    const row = await getSourceRow(companyId, documentId);
    const chunks =
        doc.currentVersionId === null ? [] : await loadVersionChunks(doc.id, doc.currentVersionId);
    if (!options.force && isSourceFresh(row, doc, chunks.length)) return row;

    const now = (ports.now ?? (() => new Date()))();
    const base = {
        versionId: doc.currentVersionId === null ? null : BigInt(doc.currentVersionId),
        readerVersion: READER_VERSION,
        modelId: ports.modelId ?? null,
        readAt: now,
    };
    try {
        const identity = options.identity ?? (await identityOf(companyId, ports));
        const cleaned = cleanPassages(chunks, { title: doc.title });
        const passages = { total: cleaned.total, kept: cleaned.kept, dropped: cleaned.dropped };

        // Same version, same reader: keep the role and only (re)read facts.
        const reuseRole =
            !options.force &&
            row?.role &&
            row.readerVersion === READER_VERSION &&
            row.versionId !== null &&
            Number(row.versionId) === doc.currentVersionId &&
            (row.passages?.total ?? -1) === chunks.length;
        const triage = reuseRole
            ? { role: row.role!, roleBy: row.roleBy ?? "model", reason: row.reason ?? "" }
            : await triageSource(
                  {
                      companyName: identity.name,
                      known: identity.known,
                      title: doc.title,
                      folder: doc.folder,
                      kind: sourceKindOf(doc),
                      cleaned,
                  },
                  ports.generate
              );

        const counted = isCounted({ override: row?.override ?? null, role: triage.role });
        const extracted =
            counted && cleaned.passages.length > 0
                ? await extractSourceFacts({
                      companyName: identity.name,
                      documentId: doc.id,
                      documentName: doc.title,
                      versionId: doc.currentVersionId,
                      passages: cleaned.passages,
                      generate: ports.generate,
                      now,
                      vouched: row?.override === "about_us",
                  })
                : null;
        const allCallsFailed =
            extracted && extracted.calls > 0 && extracted.failedCalls === extracted.calls;

        return await upsertSourceRow(companyId, doc.id, {
            ...base,
            role: triage.role,
            roleBy: triage.roleBy,
            reason: triage.reason,
            status: allCallsFailed ? "failed" : "done",
            error: allCallsFailed ? "Reading facts from this source failed" : null,
            facts: counted ? (extracted?.facts ?? {}) : null,
            factCount: extracted?.factCount ?? 0,
            passages,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[CompanyProfile] Reading document ${documentId} failed:`, error);
        return upsertSourceRow(companyId, doc.id, {
            ...base,
            role: row?.role ?? null,
            roleBy: row?.roleBy ?? null,
            reason: row?.reason ?? null,
            status: "failed",
            error: message.slice(0, 500),
            facts: row?.facts ?? null,
            factCount: row?.factCount ?? 0,
            passages: row?.passages ?? null,
        });
    }
}

/**
 * Assemble the profile from every counted source and save it. The summary
 * is rewritten only when the facts it would be written from changed.
 */
export async function assembleProfile(
    companyId: bigint,
    ports: ProfileBuildPorts,
    audit: { changedBy: string; documentId?: number | null; identity?: CompanyIdentityHint }
): Promise<CompanyMetadataJSON> {
    const now = (ports.now ?? (() => new Date()))();
    const [sources, current] = await Promise.all([
        listCountedSources(companyId),
        getProfileRow(companyId),
    ]);
    const previous = current?.metadata ?? null;
    const assembled = assembleMetadata(
        String(companyId),
        sources.map(s => ({
            documentId: Number(s.documentId),
            title: s.title,
            facts: s.facts ?? {},
        })),
        previous,
        now
    );
    assembled.provenance.extraction_model =
        ports.modelId ?? previous?.provenance.extraction_model ?? "";

    const hash = factsHash(assembled);
    const reusable =
        previous?.provenance.facts_hash === hash &&
        previous.schema_version === assembled.schema_version;
    const written = reusable
        ? {
              summary: previous.profile?.summary,
              applicant_type: previous.profile?.applicant_type,
              focus_areas: previous.profile?.focus_areas,
          }
        : await synthesizeProfile({
              metadata: assembled,
              companyName: (audit.identity ?? (await identityOf(companyId, ports))).name,
              generate: ports.generate,
              now,
          });
    assembled.profile = {
        ...assembled.profile,
        summary: written.summary,
        applicant_type: written.applicant_type,
        focus_areas: written.focus_areas,
    };
    // Edits to the summary itself outrank what was just written.
    const withEdits = applyManualOverrides(assembled, previous);
    withEdits.provenance.facts_hash = hash;

    const { metadata } = await saveProfileLocked(
        companyId,
        locked => {
            const final = applyManualOverrides(withEdits, locked);
            return { metadata: final, diff: diffMetadata(locked, final) };
        },
        { changedBy: audit.changedBy, documentId: audit.documentId ?? null }
    );
    return metadata;
}

/** A new or changed document: read it, then reassemble. The per-upload path. */
export async function refreshForDocument(
    companyId: bigint,
    documentId: number,
    ports: ProfileBuildPorts
): Promise<CompanyMetadataJSON> {
    const identity = await identityOf(companyId, ports);
    await readSource(companyId, documentId, ports, { identity });
    return assembleProfile(companyId, ports, { changedBy: "system", documentId, identity });
}

export interface RebuildResult {
    metadata: CompanyMetadataJSON;
    sources: number;
    failed: number;
}

/**
 * Read every source that changed since it was last read, then reassemble.
 * Marks the profile building while it runs and failed if assembly fails;
 * a single source failing is recorded on its row and does not fail the build.
 */
export async function rebuildProfile(
    companyId: bigint,
    ports: ProfileBuildPorts,
    options: { changedBy: string; force?: boolean }
): Promise<RebuildResult> {
    await setBuildStatus(companyId, "building");
    try {
        const identity = await identityOf(companyId, ports);
        const docs = await listWorkspaceDocuments(companyId);
        const rows = await runWithConcurrency(
            docs.map(
                doc => () =>
                    readSource(companyId, doc.id, ports, { force: options.force, identity })
            ),
            REBUILD_CONCURRENCY
        );
        const metadata = await assembleProfile(companyId, ports, {
            changedBy: options.changedBy,
            identity,
        });
        await setBuildStatus(companyId, "idle");
        return {
            metadata,
            sources: docs.length,
            failed: rows.filter(r => r?.status === "failed").length,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await setBuildStatus(companyId, "failed", message.slice(0, 500));
        throw error;
    }
}

/**
 * A person decides a source does (or doesn't) speak for the organisation.
 * Only records the decision — it outlives new versions; follow it with
 * {@link refreshForDocument} (after the response) to read and reassemble.
 */
export async function recordOverride(
    companyId: bigint,
    documentId: number,
    override: SourceOverride | null,
    by: string
): Promise<CompanyProfileSourceRow | null> {
    const doc = await getWorkspaceDocument(companyId, documentId);
    if (!doc) return null;
    const row = await getSourceRow(companyId, documentId);
    return upsertSourceRow(companyId, documentId, {
        override,
        overrideBy: override ? by : null,
        status: row?.status ?? "pending",
        versionId: row?.versionId ?? null,
    });
}
