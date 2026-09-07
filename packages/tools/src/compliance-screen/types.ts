/**
 * Compliance-screen port (distribution design §4.1 stage 6): sanctions,
 * politically exposed persons and adverse-media flags for an organisation.
 * Results are *advisory* — the pipeline records flags, it never blocks.
 */
export interface ScreenQuery {
    name: string;
    /** ISO-3166 alpha-2, when known. */
    country?: string | null;
    domain?: string | null;
}

export interface ScreenFlag {
    /** Provider's stable id for the matched entity. */
    entityId: string;
    matchedName: string;
    /** 0–1 provider confidence that the query is this entity. */
    score: number;
    /** e.g. "sanction", "pep", "crime", "debarment". */
    topics: string[];
    /** Source datasets the match comes from. */
    datasets: string[];
    /** A link a human can open. */
    url?: string;
}

export interface ScreenResult {
    provider: string;
    checkedAt: string;
    flags: ScreenFlag[];
}

export interface ComplianceScreenProvider {
    readonly name: string;
    screen(query: ScreenQuery, context?: { signal?: AbortSignal }): Promise<ScreenResult>;
}
