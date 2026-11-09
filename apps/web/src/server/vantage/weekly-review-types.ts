export interface WeeklyReviewActor {
    companyId: string;
    userId: string;
    authorityEpoch?: string;
}
export type SourcePurpose =
    | "company-architecture"
    | "workspace-required"
    | "personal-star"
    | "retrieved";
export interface FrozenDependency {
    kind: "document" | "company";
    id: string;
    version: string;
    hash: string;
    purpose: SourcePurpose;
}
export type WeeklyReviewQuery = (
    text: string,
    parameters?: unknown[]
) => Promise<Record<string, unknown>[]>;
export interface WeeklyReviewDatabase {
    transaction<T>(work: (query: WeeklyReviewQuery) => Promise<T>): Promise<T>;
}
export type AssertWeeklyReviewAuthority = (
    query: WeeklyReviewQuery,
    actor: WeeklyReviewActor,
    dependencies: FrozenDependency[],
    phase?: "prepare" | "dispatch" | "activation" | "read" | "decision" | "recovery"
) => Promise<void>;
export class WeeklyReviewConflict extends Error {
    constructor(
        readonly code: string,
        readonly status = 409
    ) {
        super(code);
    }
}

export interface WeeklyReviewSource extends FrozenDependency {
    ref: string;
    text: string;
    audience: "company" | "actor";
    title: string;
}
export interface WeeklyReviewContext {
    actor: WeeklyReviewActor;
    week: string;
    sources: WeeklyReviewSource[];
    role: string;
    preferenceVersion: number;
    authorityEpoch: string;
    mandatoryCoverage: { required: number; included: number };
}
