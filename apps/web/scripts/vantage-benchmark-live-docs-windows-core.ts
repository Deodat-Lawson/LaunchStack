/** Pure historical reconstruction. No model, database, environment or label access. */
import { canonicalTextHash } from "@launchstack/store/document-digests";
import { compileScopedEvidence } from "@launchstack/pipelines/vantage/scoped-evidence";
import { fingerprint } from "@launchstack/pipelines/vantage/weekly-review-validation";
import type { WeeklyReviewInput } from "@launchstack/pipelines/vantage/weekly-review-v21";
import {
    fitTopicEvidence,
    mergeTopicSpans,
    type TopicFreeze,
} from "../src/server/vantage/weekly-review-topic-freeze";
import { lexicalBackfillSpan } from "../src/server/vantage/weekly-review-topic-backfill";
import { explorationDocumentHandle } from "../src/server/vantage/weekly-review-topic-exploration";
import {
    topicManifestHash,
    topicInputHash,
    type TopicManifest,
    type TopicSeed,
} from "../src/server/vantage/weekly-review-topic-types";
import type { createScopedSourceReader } from "../src/server/vantage/weekly-review-scoped-selection";
import type { WeeklyReviewSource } from "../src/server/vantage/weekly-review-types";
type Span = { start: number; end: number };
type Selection = { ref: string; topicIds: string[]; spans: Span[] }[];
export type SavedPrimary = {
    runId: string;
    workId: string;
    caseId: string;
    enterprise: string;
    workspaceId: string;
    arm: string;
    status: string;
    failure?: string;
    topics: { caseId: string; topicId: string }[];
    retrievalLimits: { sharedEvidenceBytes: number; sourceUnits: number };
    cohort: string;
    protocol?: string;
    snapshot?: WeeklyReviewInput;
    offered: { documentId: string; versionId: string; ref: string }[];
    topicAttribution?: {
        observable: boolean;
        entries: { documentId: string; versionId: string; topicIds: string[] }[];
    };
};
export type Group = {
    groupId: string;
    enterprise: string;
    workspaceId: string;
    topics: { caseId: string; question: string }[];
};
type ArchivedDocument = {
    id: string;
    version: string;
    companyId: string;
    title: string;
    category: string;
    versionDate: string;
    text: string;
    chunks: { id: string; ordinal: number; text: string }[];
};
type ArchivedRun = {
    companyId: string;
    ownerId: string;
    manifest: TopicManifest;
    manifestHash: string;
    inputHash: string;
    snapshotHash: string | null;
    trace: unknown;
};
export type ReconstructionArchive = {
    schemaVersion: "live-docs-windows-state/1";
    referencesSha256: string;
    groupsSha256: string;
    documents: Record<string, ArchivedDocument>;
    runs: Record<string, ArchivedRun>;
};
const bytes = (input: WeeklyReviewInput) =>
    input.sources.reduce((sum, source) => sum + Buffer.byteLength(source.text, "utf8"), 0);
export const success = (row: SavedPrimary) => ["ok", "accepted", "success"].includes(row.status);
export const refOf = (documentId: string, versionId: string) => `doc:${documentId}@${versionId}`;

export function primaryReferences(rows: SavedPrimary[], groups: Group[]) {
    const selected = rows.filter(row => row.arm === "configured-live" && row.cohort === "heldout");
    const seen = new Set<string>();
    for (const row of selected) {
        const group = groups.find(group => group.groupId === row.caseId);
        const key = JSON.stringify([
            row.workspaceId,
            row.caseId,
            row.retrievalLimits.sharedEvidenceBytes,
        ]);
        if (
            !group ||
            row.workspaceId !== group.workspaceId ||
            row.enterprise !== group.enterprise ||
            ![8000, 16000].includes(row.retrievalLimits.sharedEvidenceBytes) ||
            seen.has(key) ||
            !row.workId ||
            !row.runId
        )
            throw Error("projection_reference_invalid");
        if (
            JSON.stringify(row.topics.map(topic => topic.caseId)) !==
            JSON.stringify(group.topics.map(topic => topic.caseId))
        )
            throw Error("projection_topic_mapping_invalid");
        seen.add(key);
    }
    if (selected.length !== groups.length * 2) throw Error("projection_reference_incomplete");
    return selected;
}

function protectedSelection(seed: TopicSeed, input: WeeklyReviewInput): Selection {
    const selected: Selection = [];
    for (const parent of input.scopedEvidence ?? []) {
        const ref = refOf(parent.documentId, parent.parentVersion);
        const document = seed.documents.find(document => document.ref === ref);
        if (!document) continue;
        const spans = mergeTopicSpans(
            parent.units.map(unit => ({ start: unit.start, end: unit.end })),
            document.text
        );
        for (const unit of parent.units) {
            const source = input.sources.find(source => source.ref === unit.ref);
            if (
                !source ||
                source.text !== document.text.slice(unit.start, unit.end) ||
                canonicalTextHash(source.text) !== unit.excerptHash
            )
                throw Error("projection_original_range_mismatch");
        }
        selected.push({ ref, topicIds: [], spans });
    }
    return selected;
}
function covers(frozen: TopicFreeze, required: Selection, seed: TopicSeed) {
    return required.every(item => {
        const document = seed.documents.find(document => document.ref === item.ref)!;
        const parent = frozen.input.scopedEvidence?.find(
            parent => parent.documentId === document.id && parent.parentVersion === document.version
        );
        return item.spans.every(span =>
            parent?.units.some(unit => unit.start <= span.start && unit.end >= span.end)
        );
    });
}
function laneUnitRefs(input: WeeklyReviewInput | undefined) {
    const context = input?.retrievalContext;
    return new Set(
        (context?.schemaVersion === "vantage-topic-retrieval/v1" ? context.seedReasons : [])
            .filter(reason => reason.reason === "lane")
            .map(reason => reason.ref)
    );
}
export function archivedChosenDocuments(seed: TopicSeed, source: SavedPrimary, trace: unknown) {
    const documents = new Map(seed.documents.map(document => [document.ref, document]));
    const aliases = new Map(
        seed.documents.map(document => [explorationDocumentHandle(document), document.ref])
    );
    const events =
        (
            trace as {
                events?: {
                    kind?: string;
                    response?: {
                        toolCalls?: { id?: string; name?: string; arguments?: unknown }[];
                    };
                    callId?: string;
                    code?: string;
                }[];
            } | null
        )?.events ?? [];
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        for (const call of [...(event?.response?.toolCalls ?? [])].reverse()) {
            if (call.name !== "submit_result") continue;
            if (
                events
                    .slice(index + 1)
                    .some(
                        event =>
                            event.kind === "tool_validation" &&
                            event.callId === call.id &&
                            ["submission_invalid", "tool_overflow", "total_call_limit"].includes(
                                event.code ?? ""
                            )
                    )
            )
                continue;
            let args = call.arguments;
            if (typeof args === "string") {
                try {
                    args = JSON.parse(args);
                } catch {
                    continue;
                }
            }
            const items = (
                args as { selected?: { ref?: string; handle?: string; spans?: unknown[] }[] } | null
            )?.selected;
            if (!Array.isArray(items)) continue;
            const refs: string[] = [];
            let valid = true;
            for (const item of items) {
                if (!item || typeof item !== "object") {
                    valid = false;
                    break;
                }
                if (
                    seed.manifest.fixed.some(fixed => fixed.ref === item.ref) &&
                    Array.isArray(item.spans) &&
                    item.spans.length === 0
                )
                    continue;
                const ref = documents.has(item.ref ?? "")
                    ? item.ref
                    : aliases.get(item.handle ?? item.ref ?? "");
                if (!ref) {
                    valid = false;
                    break;
                }
                refs.push(ref);
            }
            if (!valid) continue;
            return {
                refs: [...new Set(refs)],
                provenance: "explicit-model-selection" as const,
            };
        }
    }
    if (source.topicAttribution?.observable) {
        const refs = source.topicAttribution.entries
            .map(item => refOf(item.documentId, item.versionId))
            .filter(ref => documents.has(ref));
        return { refs: [...new Set(refs)], provenance: "explicit-model-selection" as const };
    }
    const laneRefs = laneUnitRefs(source.snapshot);
    const refs = (source.snapshot?.scopedEvidence ?? [])
        .filter(parent => parent.units.some(unit => !laneRefs.has(unit.ref)))
        .map(parent => refOf(parent.documentId, parent.parentVersion))
        .filter(ref => documents.has(ref));
    return { refs: [...new Set(refs)], provenance: "archive-inferred" as const };
}

/** Calls the production fitter only. Existing accepted ranges outrank every added window. */
export async function fitLiveDocumentsWindows(options: {
    source: SavedPrimary;
    seed: TopicSeed;
    read: ReturnType<typeof createScopedSourceReader>;
    trace: unknown;
}) {
    const { source, seed, read, trace } = options;
    if (!source.snapshot) throw Error("projection_snapshot_missing");
    const cap = source.retrievalLimits.sharedEvidenceBytes;
    const original = protectedSelection(seed, source.snapshot);
    let selection = original.map(item => ({
        ...item,
        spans: item.spans.map(span => ({ ...span })),
    }));
    let fitted = await fitTopicEvidence(source.runId, seed, { selected: selection }, read, {
        evidenceCapBytes: cap,
    });
    if (!covers(fitted, original, seed)) throw Error("projection_original_ranges_not_preserved");
    const chosen = archivedChosenDocuments(seed, source, trace);
    let addedWindows = 0;
    for (const ref of chosen.refs) {
        const document = seed.documents.find(document => document.ref === ref)!;
        const prior = selection.find(item => item.ref === ref);
        const priorBytes = (prior?.spans ?? []).reduce(
            (sum, span) => sum + Buffer.byteLength(document.text.slice(span.start, span.end)),
            0
        );
        let allowance = cap - bytes(fitted.input) + priorBytes;
        const tried = new Set<string>();
        while (allowance >= 200) {
            const span = lexicalBackfillSpan(document.text, seed.manifest.topics, allowance);
            if (!span) break;
            const stamp = JSON.stringify(span);
            if (!tried.has(stamp)) {
                tried.add(stamp);
                try {
                    const spans = mergeTopicSpans([...(prior?.spans ?? []), span], document.text);
                    const candidate = selection.map(item => ({
                        ...item,
                        spans: item.spans.map(span => ({ ...span })),
                    }));
                    const index = candidate.findIndex(item => item.ref === ref);
                    if (index >= 0) candidate[index] = { ...candidate[index]!, spans };
                    else candidate.push({ ref, topicIds: [], spans });
                    const next = await fitTopicEvidence(
                        source.runId,
                        seed,
                        { selected: candidate },
                        read,
                        { evidenceCapBytes: cap }
                    );
                    if (covers(next, candidate, seed)) {
                        selection = candidate;
                        fitted = next;
                        addedWindows++;
                        break;
                    }
                } catch (error) {
                    if (
                        !(error instanceof Error) ||
                        error.message !== "topic_exploration_failed:range_invalid"
                    )
                        throw error;
                }
            }
            if (allowance === 200) break;
            allowance = Math.max(200, Math.floor(allowance / 2));
        }
    }
    const completed = await fitTopicEvidence(source.runId, seed, { selected: selection }, read, {
        evidenceCapBytes: cap,
        backfill: true,
    });
    if (!covers(completed, original, seed) || !covers(completed, selection, seed))
        throw Error("projection_original_ranges_not_preserved");
    const originalLaneUnits = laneUnitRefs(source.snapshot);
    const laneParents = new Set(
        (source.snapshot.scopedEvidence ?? [])
            .filter(parent => parent.units.some(unit => originalLaneUnits.has(unit.ref)))
            .map(parent => refOf(parent.documentId, parent.parentVersion))
    );
    const finalLaneUnits = laneUnitRefs(completed.input);
    const finalLaneParents = new Set(
        (completed.input.scopedEvidence ?? [])
            .filter(parent => parent.units.some(unit => finalLaneUnits.has(unit.ref)))
            .map(parent => refOf(parent.documentId, parent.parentVersion))
    );
    return {
        optionalLaneAdmissions: [...finalLaneParents].filter(ref => !laneParents.has(ref)).length,
        frozen: completed,
        provenance: chosen.provenance,
        chosenDocuments: chosen.refs.length,
        addedWindows,
        automaticLaneOnlyDocuments: [...laneParents].filter(ref => !chosen.refs.includes(ref))
            .length,
    };
}

function reconstructSeed(source: SavedPrimary, archive: ReconstructionArchive) {
    const state = archive.runs[source.runId];
    if (
        !state ||
        state.companyId !== source.workspaceId ||
        state.manifestHash !== topicManifestHash(state.manifest) ||
        state.inputHash !== topicInputHash(state.manifest) ||
        !source.snapshot ||
        state.snapshotHash !== fingerprint(source.snapshot)
    )
        throw Error("projection_state_mismatch");
    const manifest = state.manifest;
    const fixed = new Map(manifest.fixed.map(source => [source.ref, source]));
    const sources: WeeklyReviewSource[] = source.snapshot.sources
        .filter(source => fixed.has(source.ref))
        .map(source => ({ ...source, ...fixed.get(source.ref)!, kind: "document" }));
    if (sources.length !== fixed.size) throw Error("projection_fixed_sources_missing");
    const documents = manifest.offered.map(offer => {
        const document = archive.documents[offer.ref];
        if (
            !document ||
            document.id !== offer.id ||
            document.version !== offer.version ||
            document.companyId !== source.workspaceId ||
            canonicalTextHash(document.text) !== offer.hash ||
            document.text !== document.chunks.map(chunk => chunk.text).join("\n")
        )
            throw Error("projection_canonical_source_mismatch");
        return {
            ...offer,
            text: document.text,
            title: document.title,
            category: document.category,
        };
    });
    const seed: TopicSeed = {
        manifest,
        documents,
        context: {
            actor: { companyId: state.companyId, userId: state.ownerId },
            week: manifest.week,
            role: source.snapshot.role,
            preferenceVersion: manifest.revisions.preference,
            authorityEpoch: manifest.epoch,
            mandatoryCoverage: source.snapshot.mandatoryCoverage,
            sources,
            dependencies: manifest.fixedDependencies,
            scopedEvidence: (source.snapshot.scopedEvidence ?? []).filter(parent =>
                parent.units.some(unit => fixed.has(unit.ref))
            ),
        },
    };
    const read: ReturnType<typeof createScopedSourceReader> = async (
        id,
        purpose,
        cutoff,
        scope,
        revision
    ) => {
        const document = archive.documents[refOf(id, scope.version)];
        if (
            !document ||
            !documents.some(offer => offer.id === id && offer.version === scope.version) ||
            cutoff !== manifest.cutoff ||
            Date.parse(document.versionDate) > Date.parse(cutoff)
        )
            throw Error("projection_source_not_offered");
        const request = {
            actorId: state.ownerId,
            companyId: state.companyId,
            documentId: id,
            version: scope.version,
            asOf: cutoff,
            expectedParentHash: scope.expectedParentHash,
            selectedUnitIds: scope.requiredUnits.map(unit => unit.id),
        };
        const prepared = compileScopedEvidence(
            request,
            {
                companyId: state.companyId,
                documentId: id,
                version: scope.version,
                versionDate: document.versionDate,
                availableAt: document.versionDate,
                title: document.title,
                purpose,
                chunks: document.chunks,
                originalCompleteness: "unknown",
            },
            {
                actorId: state.ownerId,
                companyId: state.companyId,
                documentId: id,
                version: scope.version,
                authorized: true,
                purpose,
                audience: "company",
                companyReadable: true,
                aclRevision: manifest.epoch,
                authorityRevision: revision,
                finiteScope: {
                    qualification: scope.qualification,
                    requiredUnits: scope.requiredUnits,
                },
            }
        );
        return {
            descriptor: prepared.dependency,
            dependency: {
                kind: "scoped-document",
                id,
                version: scope.version,
                hash: canonicalTextHash(document.text),
                purpose,
                scope: { request, dependency: prepared.dependency },
            },
            sources: prepared.modelFacingProjection.sources.map(unit => ({
                kind: "document",
                id,
                version: scope.version,
                hash: unit.hash,
                purpose,
                audience: "company",
                ref: unit.ref,
                text: unit.text,
                title: unit.title,
            })),
        };
    };
    return { seed, read, trace: state.trace };
}
function selectedSources(input: WeeklyReviewInput) {
    return input.sources.map(source => {
        const parent = input.scopedEvidence?.find(parent =>
            parent.units.some(unit => unit.ref === source.ref)
        );
        const unit = parent?.units.find(unit => unit.ref === source.ref);
        return {
            documentId: parent?.documentId ?? /^doc:(\d+)@/.exec(source.ref)?.[1] ?? null,
            versionId: source.version,
            ref: source.ref,
            text: source.text,
            start: unit?.start ?? 0,
            end: unit?.end ?? source.text.length,
            kind: unit ? "excerpt" : "full_document",
            purpose: source.purpose,
        };
    });
}
export async function projectSavedPrimary(source: SavedPrimary, archive: ReconstructionArchive) {
    const base = {
        caseId: source.caseId,
        enterprise: source.enterprise,
        workspaceId: source.workspaceId,
        topics: source.topics,
        retrievalLimits: source.retrievalLimits,
        cohort: source.cohort,
        protocol: source.protocol,
        arm: "live-docs+windows",
        offered: source.offered,
        accounting: {
            paidModelCalls: 0,
            embeddingCalls: 0,
            digestProviderCalls: 0,
            explorationResponses: 0,
            explorationToolCalls: 0,
            generation: 0,
            judge: 0,
        },
    };
    const projection = {
        sourceView: "with-reruns",
        sourceRunId: source.runId,
        sourceWorkId: source.workId,
        derivationKind: "offline-projection",
        documentSelectionProvenance: "archive-inferred" as
            | "archive-inferred"
            | "explicit-model-selection",
    };
    if (!success(source))
        return {
            ...base,
            projection,
            status: "failed",
            failure: source.failure,
            selected: [],
            frozenBytes: 0,
        };
    try {
        const prepared = reconstructSeed(source, archive);
        const result = await fitLiveDocumentsWindows({ source, ...prepared });
        projection.documentSelectionProvenance = result.provenance;
        return {
            ...base,
            projection,
            status: "ok",
            selected: selectedSources(result.frozen.input),
            snapshot: result.frozen.input,
            frozenBytes: bytes(result.frozen.input),
            windowPolicy: {
                chosenDocuments: result.chosenDocuments,
                addedWindows: result.addedWindows,
                automaticLaneOnlyDocumentsPreserved: result.automaticLaneOnlyDocuments,
                optionalLaneAdmissions: result.optionalLaneAdmissions,
                originalFrozenRangesPreserved: true,
                historicalAuthorityOnly: true,
            },
        };
    } catch (error) {
        return {
            ...base,
            projection,
            status: "failed",
            failure: "offline_projection_failed",
            projectionFailureCode:
                error instanceof Error && /^[a-z_]{1,100}$/.test(error.message)
                    ? error.message
                    : "fitter_or_archive_invalid",
            selected: [],
            frozenBytes: 0,
        };
    }
}
