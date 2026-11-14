/** Adapted deterministic ranking from Sophia PR #602. No provider or host dependencies. */
export const ROLE_AWARE_RANKING_PROVENANCE = Object.freeze({
    implementation: "sophia-role-ranking-adapted/v1",
    sourceCommit: "d53cefc7c048dbaecc5d1eee387686211570f082",
    sourcePath: "pipelines/src/vantage/dynamic-retrieval/retrieve.ts",
    sourceSha256: "a931ccdcd275406595202cd01c78f43db462b4552068f9fa8a5172fc23e76ead",
    tokenizerSha256: "2835c2850bfa05764bc5245079441ac5d21935ec7cc7e4e9f4eddafe9071099e",
});

export const ROLE_AWARE_RANKING_LIMITS = Object.freeze({ candidates: 64, textChars: 6000 });

export interface RoleAwareCandidate {
    id: string;
    version: string | number;
    title: string;
    category: string;
    availableAt: string | Date;
    text?: string;
}

export interface RankingRole {
    primaryRole: string;
    responsibilities: readonly string[];
    priorities: readonly string[];
}

export interface RoleAwareRanking<T extends RoleAwareCandidate> {
    candidate: T;
    rank: number;
    scores: {
        relevance: number;
        primaryRoleScore: number;
        matchedTerms: string[];
        totalTerms: number;
        recent: boolean;
        olderOpen: false;
    };
    rationale: {
        mode: "role-aware" | "recency-fallback";
        primaryRole: string | null;
        evaluatedTextChars: number;
        textTruncated: boolean;
    };
    provenance: typeof ROLE_AWARE_RANKING_PROVENANCE;
}

// Sophia bounds.ts tokenizer, including its exact stop-word set and stable ordering.
const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "our",
    "are",
    "was",
    "has",
    "have",
    "into",
]);
function terms(text: string): string[] {
    return [
        ...new Set(
            (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
                word => !stopWords.has(word)
            )
        ),
    ].sort();
}
function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
function timestamp(value: string | Date): number {
    const result = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(result)) throw new Error("Invalid role-ranking timestamp.");
    return result;
}
function boundedMetadata(value: string): boolean {
    return typeof value === "string" && value.length <= 1000;
}

/**
 * Ranks an already authorized optional catalog. Required documents and Stars are
 * selected by the caller. Availability uses the report cutoff inclusively.
 * Sophia's matched-term ratio and relevance/recent ordering are retained. The
 * lean contract supplies no ownership, trust, explicit role tags or state, so
 * older-open promotion is unavailable. The caller's role is the sole role input.
 */
export function rankRoleAwareCandidates<T extends RoleAwareCandidate>(
    candidates: readonly T[],
    role: RankingRole | undefined,
    reportWindow: { start: string | Date; cutoff: string | Date }
): RoleAwareRanking<T>[] {
    if (candidates.length > ROLE_AWARE_RANKING_LIMITS.candidates)
        throw new Error("Role-ranking candidate limit exceeded.");
    const start = timestamp(reportWindow.start);
    const cutoff = timestamp(reportWindow.cutoff);
    if (start > cutoff) throw new Error("Invalid role-ranking report window.");
    if (
        role &&
        (!boundedMetadata(role.primaryRole) ||
            ![role.responsibilities, role.priorities].every(
                values =>
                    Array.isArray(values) && values.length <= 100 && values.every(boundedMetadata)
            ))
    )
        throw new Error("Invalid bounded role-ranking context.");
    const roleTerms = role
        ? terms([role.primaryRole, ...role.responsibilities, ...role.priorities].join(" "))
        : [];
    const roleAware = roleTerms.length > 0;
    const identities = new Set<string>();
    const ranked: { result: RoleAwareRanking<T>; availableAt: number; identity: string }[] = [];
    for (const candidate of candidates) {
        if (
            !boundedMetadata(candidate.id) ||
            !candidate.id ||
            !boundedMetadata(candidate.title) ||
            !boundedMetadata(candidate.category) ||
            !(
                (typeof candidate.version === "string" &&
                    candidate.version.length > 0 &&
                    candidate.version.length <= 1000) ||
                (typeof candidate.version === "number" && Number.isSafeInteger(candidate.version))
            ) ||
            (candidate.text !== undefined && typeof candidate.text !== "string")
        )
            throw new Error("Invalid bounded role-ranking candidate.");
        const identity = JSON.stringify([candidate.id, candidate.version]);
        if (identities.has(identity)) throw new Error("Duplicate role-ranking source version.");
        identities.add(identity);
        const availableAt = timestamp(candidate.availableAt);
        if (availableAt > cutoff) continue;
        const text = (candidate.text ?? "").slice(0, ROLE_AWARE_RANKING_LIMITS.textChars);
        const words = new Set(terms([candidate.title, candidate.category, text].join(" ")));
        const matchedTerms = roleTerms.filter(term => words.has(term));
        const relevance = matchedTerms.length / Math.max(1, roleTerms.length);
        ranked.push({
            availableAt,
            identity,
            result: {
                candidate,
                rank: 0,
                scores: {
                    relevance,
                    primaryRoleScore: relevance,
                    matchedTerms,
                    totalTerms: roleTerms.length,
                    recent: availableAt >= start,
                    olderOpen: false,
                },
                rationale: {
                    mode: roleAware ? "role-aware" : "recency-fallback",
                    primaryRole: roleAware ? role!.primaryRole : null,
                    evaluatedTextChars: text.length,
                    textTruncated: (candidate.text?.length ?? 0) > text.length,
                },
                provenance: ROLE_AWARE_RANKING_PROVENANCE,
            },
        });
    }
    ranked.sort(
        (a, b) =>
            (roleAware ? b.result.scores.primaryRoleScore - a.result.scores.primaryRoleScore : 0) ||
            (roleAware
                ? Number(b.result.scores.recent) - Number(a.result.scores.recent)
                : b.availableAt - a.availableAt) ||
            compareText(a.identity, b.identity)
    );
    return ranked.map(({ result }, index) => ({ ...result, rank: index + 1 }));
}
