import type { RagPort } from "@launchstack/retrieval";
import { ContextPortErrorV0 } from "../context-v0/ports";
import { contextSourceKeyV0 as key, type ContextScopeV0 } from "../proposals/context-v0";
import { boundedCall, compareText } from "./bounds";
import type { RetrievalMetadataV0, RetrievalSearchPortV0 } from "./types";

/** Explicit native bindings supplied by the authoritative source host, never parsed from citations. */
export interface RagDocumentBindingV0 {
    documentId: number;
    versionId: number;
    metadata: RetrievalMetadataV0;
}

export interface AuthorizedRagSearchOptionsV0 {
    actor: ContextScopeV0;
    bindings: readonly RagDocumentBindingV0[];
    rag: RagPort;
    /** Recheck current membership/document ACLs. Enforce corpus/chunk limits before allowing search. */
    authorizeDocuments(input: {
        actor: ContextScopeV0;
        documentIds: number[];
        signal: AbortSignal;
    }): Promise<{ actor: ContextScopeV0; documentIds: number[] }>;
    maxResults?: number;
    timeoutMs?: number;
}

function sameActor(a: ContextScopeV0, b: ContextScopeV0) {
    return (
        a.companyId === b.companyId &&
        a.principalRef === b.principalRef &&
        a.aclDigest === b.aclDigest &&
        a.audience.kind === "actor" &&
        b.audience.kind === "actor" &&
        a.audience.principalRef === b.audience.principalRef
    );
}
const positiveId = (value: number) => Number.isSafeInteger(value) && value > 0;
function fail(): never {
    throw new ContextPortErrorV0("RAG source bindings or authorization are invalid.", 403);
}

/** Reuses the existing ensemble; only trusted metadata and exact catalog refs cross back out. */
export function createAuthorizedRagSearchV0(
    options: AuthorizedRagSearchOptionsV0
): RetrievalSearchPortV0 {
    const actor = structuredClone(options.actor);
    const bindings = structuredClone(options.bindings);
    const maxResults = options.maxResults ?? 40;
    const timeoutMs = options.timeoutMs ?? 5000;
    const companyId = Number(actor.companyId);
    if (
        !positiveId(companyId) ||
        String(companyId) !== actor.companyId ||
        !actor.aclDigest ||
        !actor.principalRef ||
        actor.audience.principalRef !== actor.principalRef ||
        !Number.isSafeInteger(maxResults) ||
        maxResults < 1 ||
        maxResults > 200 ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 60000 ||
        bindings.length > 128
    )
        fail();
    const refs = new Set<string>();
    const native = new Set<number>();
    for (const binding of bindings) {
        if (
            !positiveId(binding.documentId) ||
            !positiveId(binding.versionId) ||
            binding.metadata.source.kind !== "doc" ||
            !binding.metadata.source.id ||
            !binding.metadata.source.version ||
            refs.has(key(binding.metadata.source)) ||
            native.has(binding.documentId)
        )
            fail();
        refs.add(key(binding.metadata.source));
        native.add(binding.documentId);
    }
    return {
        async search(request) {
            if (
                !sameActor(actor, request.actor) ||
                !Number.isSafeInteger(request.limit) ||
                request.limit < 1
            )
                fail();
            return boundedCall(
                async signal => {
                    const allowedRefs = new Set(request.allowedSources.map(key));
                    const candidates = bindings.filter(binding =>
                        allowedRefs.has(key(binding.metadata.source))
                    );
                    // This adapter is document-only. Never call an uncovered catalog complete.
                    const unbound = [...allowedRefs].some(ref => !refs.has(ref));
                    const ids = candidates.map(binding => binding.documentId).sort((a, b) => a - b);
                    if (!ids.length) return { hits: [], truncated: false, incomplete: unbound };
                    async function authorize() {
                        const current = await options.authorizeDocuments({
                            actor: structuredClone(actor),
                            documentIds: [...ids],
                            signal,
                        });
                        if (
                            !sameActor(actor, current.actor) ||
                            !Array.isArray(current.documentIds) ||
                            current.documentIds.some(id => !positiveId(id) || !ids.includes(id))
                        )
                            fail();
                        return new Set(current.documentIds);
                    }
                    const before = await authorize();
                    if (signal.aborted) fail();
                    const eligible = candidates.filter(binding => before.has(binding.documentId));
                    let incomplete = unbound || eligible.length !== candidates.length;
                    let truncated = false;
                    const selected = new Map<string, RetrievalMetadataV0>();
                    const add = (binding: RagDocumentBindingV0) =>
                        selected.set(key(binding.metadata.source), binding.metadata);
                    if (request.lane === "recent") {
                        const start = Date.parse(request.reportWindow.startInclusive);
                        const end = Date.parse(request.reportWindow.endExclusive);
                        for (const binding of eligible) {
                            const changed = Date.parse(binding.metadata.changedAt ?? "");
                            if (!Number.isFinite(changed)) {
                                incomplete = true;
                                continue;
                            }
                            if (
                                changed >= start &&
                                changed < end &&
                                changed <= Date.parse(request.reportWindow.asOf)
                            )
                                add(binding);
                        }
                    } else {
                        // Historical open records must survive current-version top-k search misses.
                        for (const binding of eligible) {
                            if (
                                binding.metadata.state?.value === "open" &&
                                binding.metadata.state.asOf === request.reportWindow.asOf
                            )
                                add(binding);
                        }
                        const query = [...new Set(request.roles.flatMap(role => role.terms))]
                            .sort(compareText)
                            .join(" ");
                        if (query.length > 2048)
                            throw new ContextPortErrorV0(
                                "Role query exceeds its bounded limit.",
                                400
                            );
                        if (query && eligible.length) {
                            const limit = Math.min(maxResults, request.limit);
                            const documentIds = eligible.map(binding => binding.documentId);
                            const results = await options.rag.companyEnsembleSearch(query, {
                                companyId,
                                topK: limit,
                                scope: {
                                    kind: "only",
                                    allowedCategories: [],
                                    deniedDocumentIds: [],
                                    allowedDocumentIds: documentIds,
                                },
                                filters: { documentIds },
                            });
                            if (signal.aborted) fail();
                            if (!Array.isArray(results) || results.length > limit) fail();
                            truncated = results.length === limit;
                            for (const hit of results) {
                                const binding = eligible.find(
                                    item =>
                                        item.documentId === hit?.metadata?.documentId &&
                                        item.versionId === hit.metadata.versionId
                                );
                                if (
                                    !binding ||
                                    (hit.documentId !== undefined &&
                                        String(hit.documentId) !== String(binding.documentId))
                                ) {
                                    incomplete = true;
                                    continue;
                                }
                                // Backend text, scores, titles and timestamps never become source authority.
                                add(binding);
                            }
                        }
                    }
                    const after = await authorize();
                    if (signal.aborted) fail();
                    const hits = [...selected.values()]
                        .filter(item => {
                            const binding = eligible.find(
                                candidate => key(candidate.metadata.source) === key(item.source)
                            )!;
                            if (after.has(binding.documentId)) return true;
                            incomplete = true;
                            return false;
                        })
                        .sort((a, b) => compareText(key(a.source), key(b.source)));
                    return {
                        hits: structuredClone(hits.slice(0, request.limit)),
                        truncated: truncated || hits.length > request.limit,
                        incomplete,
                    };
                },
                timeoutMs,
                request.signal
            );
        },
    };
}
