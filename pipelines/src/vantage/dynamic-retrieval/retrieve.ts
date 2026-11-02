import {
    contextSourceKeyV0 as key,
    validateDynamicRetrievalInput,
    validateDynamicRetrievalBundle,
    type DynamicRetrievalInputV0,
    type ContextSourceEntryV0,
} from "../proposals/context-v0";
import { ContextPortErrorV0 } from "../context-v0/ports";
import {
    boundedCall,
    checkBudgets,
    compareText,
    SearchTimeout,
    terms,
    tokenCeiling,
} from "./bounds";
import type {
    RankedRetrievalBundleV0,
    RetrievalLaneV0,
    RetrievalMetadataV0,
    RetrievalSearchPortV0,
} from "./types";

export interface DynamicRetrievalOptionsV0 {
    /** Synthetic/local mode uses only the supplied authorized catalog plus these facts. */
    metadata?: readonly RetrievalMetadataV0[];
    search?: RetrievalSearchPortV0;
    maxCandidates?: number;
    signal?: AbortSignal;
    now?: () => number;
    /** Opt-in: omit unrelated recent updates and explicitly resolved older work. */
    selectionPolicy?: "broad" | "focused";
}

function metadataIdentity(item: RetrievalMetadataV0): string {
    return JSON.stringify([
        key(item.source),
        item.title ?? "",
        [...(item.topics ?? [])].sort(),
        [...(item.roleIds ?? [])].sort(),
        [...(item.ownerPrincipalRefs ?? [])].sort(),
        item.changedAt ?? "",
        item.trust ?? 0.5,
        item.state ? [item.state.asOf, item.state.value] : null,
        item.origin ? [item.origin.connector, item.origin.id, item.origin.revision] : null,
    ]);
}

/** Two deterministic lanes, with older-open work carried by the role lane. No writes. */
export function createDynamicRetrievalProviderV0(options: DynamicRetrievalOptionsV0 = {}) {
    const maxCandidates = options.maxCandidates ?? 2000;
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 10000)
        throw new ContextPortErrorV0("Candidate limit must be between 1 and 10000.", 400);
    const now = options.now ?? (() => performance.now());
    return {
        async retrieve(rawInput: DynamicRetrievalInputV0): Promise<RankedRetrievalBundleV0> {
            const started = now();
            if (rawInput.sourceCatalog.length > maxCandidates)
                throw new ContextPortErrorV0(
                    "Source catalog exceeds the bounded candidate limit.",
                    400
                );
            const checked = validateDynamicRetrievalInput(rawInput);
            if (!checked.ok)
                throw new ContextPortErrorV0("Retrieval input is invalid or unauthorized.", 400);
            checkBudgets(rawInput.budgets);
            const input = structuredClone(rawInput);
            const { budgets, reportWindow, actor } = input;
            const remaining = () => budgets.timeoutMs - (now() - started);
            const catalog = new Map(input.sourceCatalog.map(entry => [key(entry.source), entry]));
            const metadata = new Map<string, RetrievalMetadataV0>();
            if ((options.metadata?.length ?? 0) > maxCandidates)
                throw new ContextPortErrorV0("Metadata exceeds the bounded candidate limit.", 400);
            for (const item of options.metadata ?? []) {
                const id = key(item.source);
                if (!catalog.has(id) || metadata.has(id))
                    throw new ContextPortErrorV0(
                        "Metadata must uniquely reference the authorized catalog.",
                        400
                    );
                metadata.set(id, structuredClone(item));
            }
            const roles = input.verifiedRoleContext.roles
                .map(role => ({
                    roleId: role.roleId,
                    terms: terms(
                        [role.description, ...role.responsibilities, ...role.priorities].join(" ")
                    ),
                }))
                .sort((a, b) => compareText(a.roleId, b.roleId));
            const output: RankedRetrievalBundleV0 = {
                contractVersion: "v0-proposed",
                actor,
                reportWindow,
                roleMatches: [],
                recentChanges: [],
                unresolvedOlderItems: [],
                sourceRegistry: [],
                deduped: [],
                omissions: [],
                failures: [],
                status: "complete",
                diagnostics: {
                    queries: 0,
                    candidates: 0,
                    selected: 0,
                    excerptChars: 0,
                    tokenUpperBound: 0,
                    excluded: [],
                    scores: [],
                },
            };
            const lanes = new Map<string, Set<RetrievalLaneV0>>();
            const invalid = new Set<string>();
            const timeout = () => {
                if (!output.failures.some(f => f.code === "timeout"))
                    output.failures.push({
                        code: "timeout",
                        message: "Retrieval deadline exceeded.",
                    });
                output.status = "timeout";
            };
            // Query budget counts each lane, even when evaluating an in-memory catalog.
            for (const lane of ["role", "recent"] as const) {
                if (remaining() <= 0 || options.signal?.aborted) {
                    timeout();
                    break;
                }
                if (output.diagnostics.queries >= budgets.maxQueries) {
                    output.omissions.push({ reason: "budget" });
                    break;
                }
                output.diagnostics.queries++;
                try {
                    const allowed = [...catalog.values()].filter(
                        entry => entry.access === "allowed"
                    );
                    const result = options.search
                        ? await boundedCall(
                              signal =>
                                  options.search!.search({
                                      lane,
                                      actor: structuredClone(actor),
                                      reportWindow: structuredClone(reportWindow),
                                      roles: structuredClone(roles),
                                      allowedSources: allowed.map(entry =>
                                          structuredClone(entry.source)
                                      ),
                                      limit: maxCandidates,
                                      signal,
                                  }),
                              remaining(),
                              options.signal
                          )
                        : {
                              hits: allowed.map(
                                  entry =>
                                      metadata.get(key(entry.source)) ?? { source: entry.source }
                              ),
                              truncated: false,
                              incomplete: false,
                          };
                    if (!Array.isArray(result.hits) || result.hits.length > maxCandidates)
                        throw new Error("Invalid bounded search response");
                    if (result.truncated) output.omissions.push({ reason: "budget" });
                    if (result.incomplete)
                        output.failures.push({
                            code: "invalid_source",
                            message:
                                "Some search hits could not be verified against the source catalog.",
                        });
                    for (const hit of result.hits) {
                        const id = key(hit.source);
                        const entry = catalog.get(id);
                        if (!entry || entry.access !== "allowed") {
                            // Do not disclose unknown IDs or provider text in diagnostics.
                            output.omissions.push({ reason: "out-of-scope" });
                            continue;
                        }
                        const prior = metadata.get(id);
                        if (!validMetadata(hit) || (prior && !validMetadata(prior))) {
                            output.omissions.push({ source: entry.source, reason: "invalid" });
                            invalid.add(id);
                            continue;
                        }
                        if (
                            prior &&
                            metadataIdentity(prior) !== metadataIdentity(hit) &&
                            options.search
                        ) {
                            // Inconsistent metadata between lanes must not silently change ranking/state.
                            output.omissions.push({ source: entry.source, reason: "invalid" });
                            lanes.delete(id);
                            invalid.add(id);
                            continue;
                        }
                        metadata.set(id, structuredClone(hit));
                        const memberships = lanes.get(id) ?? new Set<RetrievalLaneV0>();
                        memberships.add(lane);
                        lanes.set(id, memberships);
                    }
                } catch (error) {
                    if (error instanceof SearchTimeout) {
                        timeout();
                        break;
                    }
                    output.failures.push({
                        code: "source_unavailable",
                        message: `${lane} search is unavailable.`,
                    });
                }
            }
            function validMetadata(item: RetrievalMetadataV0): boolean {
                return (
                    (item.trust === undefined ||
                        (Number.isFinite(item.trust) && item.trust >= 0 && item.trust <= 1)) &&
                    [item.topics, item.roleIds, item.ownerPrincipalRefs].every(
                        value =>
                            value === undefined ||
                            (Array.isArray(value) &&
                                value.length <= 100 &&
                                value.every(v => typeof v === "string" && v.length <= 1000))
                    ) &&
                    (item.title === undefined ||
                        (typeof item.title === "string" && item.title.length <= 1000)) &&
                    (!item.origin ||
                        [item.origin.connector, item.origin.id, item.origin.revision].every(
                            v => typeof v === "string" && v.length > 0
                        )) &&
                    (!item.state ||
                        (item.state.asOf === reportWindow.asOf &&
                            ["open", "resolved"].includes(item.state.value)))
                );
            }
            const start = Date.parse(reportWindow.startInclusive),
                end = Date.parse(reportWindow.endExclusive);
            const candidates = [] as {
                entry: ContextSourceEntryV0;
                metadata: RetrievalMetadataV0;
                roleIds: string[];
                relevance: number;
                trust: number;
                recent: boolean;
                olderOpen: boolean;
                lanes: RetrievalLaneV0[];
            }[];
            for (const entry of [...catalog.values()].sort((a, b) =>
                compareText(key(a.source), key(b.source))
            )) {
                if (remaining() <= 0 || options.signal?.aborted) {
                    timeout();
                    break;
                }
                if (entry.access === "revoked") {
                    output.omissions.push({ source: entry.source, reason: "revoked" });
                    continue;
                }
                const memberships = lanes.get(key(entry.source));
                if (!memberships || invalid.has(key(entry.source))) continue;
                const meta = metadata.get(key(entry.source)) ?? { source: entry.source };
                const changedAt = Date.parse(meta.changedAt ?? entry.sourceDate);
                if (
                    !validMetadata(meta) ||
                    !Number.isFinite(changedAt) ||
                    changedAt > Date.parse(reportWindow.asOf)
                ) {
                    output.omissions.push({ source: entry.source, reason: "invalid" });
                    continue;
                }
                const words = new Set(
                    terms([meta.title ?? "", ...(meta.topics ?? []), entry.excerpt].join(" "))
                );
                const matches = roles.map(role => ({
                    roleId: role.roleId,
                    score: meta.roleIds?.includes(role.roleId)
                        ? 1
                        : role.terms.filter(term => words.has(term)).length /
                          Math.max(1, role.terms.length),
                }));
                const roleIds = matches.filter(role => role.score > 0).map(role => role.roleId);
                const relevance = Math.max(0, ...matches.map(role => role.score));
                const relevant =
                    relevance > 0 || meta.ownerPrincipalRefs?.includes(actor.principalRef) === true;
                const recent = memberships.has("recent") && changedAt >= start && changedAt < end;
                const olderOpen =
                    memberships.has("role") &&
                    relevant &&
                    changedAt < start &&
                    meta.state?.value === "open";
                const roleMatch = memberships.has("role") && relevant;
                if (!roleMatch && !recent && !olderOpen) continue;
                if (options.selectionPolicy === "focused") {
                    const reason =
                        changedAt < start && meta.state?.value === "resolved"
                            ? "older-resolved"
                            : recent && !relevant
                              ? "irrelevant-recent"
                              : undefined;
                    if (reason) {
                        output.diagnostics.excluded.push({ source: entry.source, reason });
                        continue;
                    }
                }
                candidates.push({
                    entry,
                    metadata: meta,
                    roleIds,
                    relevance,
                    trust: meta.trust ?? 0.5,
                    recent,
                    olderOpen,
                    lanes: [
                        ...(roleMatch ? ["role" as const] : []),
                        ...(recent ? ["recent" as const] : []),
                    ],
                });
            }
            candidates.sort(
                (a, b) =>
                    Number(b.olderOpen) - Number(a.olderOpen) ||
                    b.relevance - a.relevance ||
                    b.trust - a.trust ||
                    Number(b.recent) - Number(a.recent) ||
                    compareText(key(a.entry.source), key(b.entry.source))
            );
            output.diagnostics.candidates = candidates.length;
            const copies = new Map<string, ContextSourceEntryV0>();
            for (const candidate of candidates) {
                if (remaining() <= 0 || options.signal?.aborted) {
                    timeout();
                    break;
                }
                const { entry, metadata: meta } = candidate;
                const copyKey = meta.origin
                    ? JSON.stringify([
                          meta.origin.connector,
                          meta.origin.id,
                          meta.origin.revision,
                          entry.excerpt,
                      ])
                    : key(entry.source);
                const existing = copies.get(copyKey);
                if (existing) {
                    output.omissions.push({ source: entry.source, reason: "duplicate" });
                    if (!output.deduped.some(ref => key(ref) === key(existing.source)))
                        output.deduped.push(existing.source);
                    continue;
                }
                const tokens = tokenCeiling(entry.excerpt);
                if (
                    output.sourceRegistry.length >= budgets.maxSources ||
                    output.diagnostics.excerptChars + entry.excerpt.length >
                        budgets.maxExcerptChars ||
                    output.diagnostics.tokenUpperBound + tokens > budgets.maxTokens
                ) {
                    output.omissions.push({ source: entry.source, reason: "budget" });
                    continue;
                }
                copies.set(copyKey, entry);
                const category = candidate.olderOpen
                    ? "unresolvedOlderItems"
                    : candidate.recent
                      ? "recentChanges"
                      : "roleMatches";
                const item = {
                    ...entry,
                    roleIds: candidate.roleIds,
                    rank: output.sourceRegistry.length + 1,
                    dedupKey: key(entry.source),
                    selectionReason: `${candidate.olderOpen ? "Older unresolved item; " : ""}lanes=${candidate.lanes.join(",")}; roleRelevance=${candidate.relevance.toFixed(3)}; trust=${candidate.trust.toFixed(3)}; recent=${candidate.recent}`,
                };
                output[category].push(item);
                output.sourceRegistry.push(entry);
                if (candidate.lanes.length > 1) output.deduped.push(entry.source);
                output.diagnostics.excerptChars += entry.excerpt.length;
                output.diagnostics.tokenUpperBound += tokens;
                output.diagnostics.scores.push({
                    source: entry.source,
                    relevance: candidate.relevance,
                    trust: candidate.trust,
                    recent: candidate.recent,
                    olderOpen: candidate.olderOpen,
                    lanes: candidate.lanes,
                });
            }
            output.diagnostics.selected = output.sourceRegistry.length;
            output.deduped.sort((a, b) => compareText(key(a), key(b)));
            if (
                output.status !== "timeout" &&
                (output.failures.length || output.omissions.some(o => o.reason !== "duplicate"))
            )
                output.status = "partial";
            if (output.status === "timeout") output.omissions.push({ reason: "timeout" });
            if (!validateDynamicRetrievalBundle(output, input).ok)
                throw new ContextPortErrorV0("Retrieval output failed contract validation.", 500);
            return output;
        },
    };
}
