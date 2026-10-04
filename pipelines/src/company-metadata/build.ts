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
    BUILD_STUCK_MS,
    claimSources,
    countActiveClaims,
    finishBuild,
    listSourceRows,
    saveProfileLocked,
    startBuild,
    upsertSourceRow,
    type ProfileDocument,
} from "./db";
import { extractSourceFacts, runWithConcurrency, type GenerateStructuredFn } from "./extractor";
import { cleanPassages } from "./passages";
import { READER_VERSION } from "./prompts";
import { synthesizeProfile } from "./synthesize";
import { sourceKindOf, triageSource } from "./triage";
import {
    createEmptyMetadata,
    type CompanyMetadataJSON,
    type CompanyProfileSourceRow,
    type SourceOverride,
} from "./types";

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
            // A read that failed outright keeps what the source said last time;
            // Rebuild retries it.
            facts: allCallsFailed
                ? (row?.facts ?? null)
                : counted
                  ? (extracted?.facts ?? {})
                  : null,
            factCount: allCallsFailed ? (row?.factCount ?? 0) : (extracted?.factCount ?? 0),
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

type CountedSource = Awaited<ReturnType<typeof listCountedSources>>[number];

const toAssembleSources = (rows: CountedSource[]) =>
    rows.map(s => ({ documentId: Number(s.documentId), title: s.title, facts: s.facts ?? {} }));

/**
 * Assemble the profile from every counted source and save it.
 *
 * Two passes. Outside the lock, a draft decides whether the summary must be
 * rewritten — a model call, so never under the lock. Under the lock, the
 * profile is assembled again from the source rows and the edits as they are
 * NOW: a build that ran alongside, a reset, a delete or an override made in
 * the meantime is reflected, so the last save is always current. When the
 * facts moved on after the summary was written, the summary is kept but
 * marked out of date (its facts hash), and the next assembly rewrites it.
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
    const draft = assembleMetadata(String(companyId), toAssembleSources(sources), previous, now);
    const draftHash = factsHash(draft);
    const reusable =
        previous?.provenance.facts_hash === draftHash &&
        previous.schema_version === draft.schema_version;
    const written = reusable
        ? writtenPart(previous)
        : await synthesizeProfile({
              metadata: draft,
              companyName: (audit.identity ?? (await identityOf(companyId, ports))).name,
              generate: ports.generate,
              now,
          });

    const saved = await saveProfileLocked(
        companyId,
        async (locked, tx) => {
            const fresh = assembleMetadata(
                String(companyId),
                toAssembleSources(await listCountedSources(companyId, tx)),
                locked,
                now
            );
            fresh.provenance.extraction_model =
                ports.modelId ?? locked?.provenance.extraction_model ?? "";
            const hash = factsHash(fresh);
            // Another build may already have written the summary for exactly these facts.
            const lockedFits =
                hash !== draftHash &&
                locked?.provenance.facts_hash === hash &&
                locked.schema_version === fresh.schema_version;
            const summary = lockedFits ? writtenPart(locked) : written;
            fresh.profile = { ...fresh.profile, ...summary };
            // Edits to the summary itself outrank what was written.
            const final = applyManualOverrides(fresh, locked);
            final.provenance.facts_hash = hash === draftHash || lockedFits ? hash : draftHash;
            return { metadata: final, diff: diffMetadata(locked, final) };
        },
        { changedBy: audit.changedBy, documentId: audit.documentId ?? null }
    );
    return saved!.metadata;
}

function writtenPart(
    metadata: CompanyMetadataJSON
): Pick<NonNullable<CompanyMetadataJSON["profile"]>, "summary" | "applicant_type" | "focus_areas"> {
    return {
        summary: metadata.profile?.summary,
        applicant_type: metadata.profile?.applicant_type,
        focus_areas: metadata.profile?.focus_areas,
    };
}

/** Stale sources one event reads before handing the rest to the next event (or a Rebuild). */
const CATCH_UP_PER_EVENT = 12;

/**
 * Documents whose source row is missing or was read at another version or
 * under an older reader. A failed read is left to Rebuild, so one bad file
 * does not cost a model call on every event. `unclaimed` leaves out sources
 * another reader is reading right now.
 */
export async function staleDocumentIds(
    companyId: bigint,
    options: { unclaimed?: boolean; now?: Date } = {}
): Promise<number[]> {
    const now = options.now ?? new Date();
    const [docs, rows] = await Promise.all([
        listWorkspaceDocuments(companyId),
        listSourceRows(companyId),
    ]);
    const byDocument = new Map(rows.map(r => [Number(r.documentId), r]));
    return docs
        .filter(doc => {
            const row = byDocument.get(doc.id);
            const stale =
                !row ||
                row.readerVersion !== READER_VERSION ||
                (row.versionId === null ? null : Number(row.versionId)) !== doc.currentVersionId;
            if (!stale || !options.unclaimed || !row) return stale;
            const claimed =
                row.status === "pending" &&
                !!row.readAt &&
                now.getTime() - row.readAt.getTime() < BUILD_STUCK_MS;
            return !claimed;
        })
        .map(doc => doc.id);
}

/**
 * Read whatever is stale, then reassemble. Every per-event path (an upload,
 * a person's override, reset or edit, a delete) comes through here, so a
 * profile is never assembled from a partial set of sources.
 *
 * Sources are claimed before they are read, so two events never read the
 * same one, and one event reads at most {@link CATCH_UP_PER_EVENT} — a
 * workspace's first event after this builder shipped (or after a
 * READER_VERSION bump) must not hold up the worker for every workspace.
 * While anything is left to read, or being read elsewhere, the previous
 * profile stays as it is; whichever reader finishes the last source
 * assembles. Rebuild reads everything at once.
 */
export async function catchUpAndAssemble(
    companyId: bigint,
    ports: ProfileBuildPorts,
    audit: { changedBy: string; documentId?: number | null; identity?: CompanyIdentityHint }
): Promise<CompanyMetadataJSON> {
    const identity = audit.identity ?? (await identityOf(companyId, ports));
    const candidates = await staleDocumentIds(companyId, { unclaimed: true });
    const mine = await claimSources(companyId, candidates.slice(0, CATCH_UP_PER_EVENT));
    await runWithConcurrency(
        mine.map(id => () => readSource(companyId, id, ports, { identity })),
        REBUILD_CONCURRENCY
    );
    const [left, reading] = await Promise.all([
        staleDocumentIds(companyId),
        countActiveClaims(companyId),
    ]);
    if (left.length > 0 || reading > 0) {
        console.info(
            `[CompanyProfile] company ${companyId}: ${left.length} source(s) still to read, ${reading} being read — the profile is reassembled once they are`
        );
        return (await getProfileRow(companyId))?.metadata ?? createEmptyMetadata(String(companyId));
    }
    return assembleProfile(companyId, ports, { ...audit, identity });
}

/** A new or changed document: read it (and anything stale), then reassemble. The per-upload path. */
export async function refreshForDocument(
    companyId: bigint,
    documentId: number,
    ports: ProfileBuildPorts
): Promise<CompanyMetadataJSON> {
    const identity = await identityOf(companyId, ports);
    await readSource(companyId, documentId, ports, { identity });
    return catchUpAndAssemble(companyId, ports, { changedBy: "system", documentId, identity });
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
    const token = await startBuild(companyId);
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
        await finishBuild(companyId, token, "idle");
        return {
            metadata,
            sources: docs.length,
            failed: rows.filter(r => r?.status === "failed").length,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await finishBuild(companyId, token, "failed", message.slice(0, 500));
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
