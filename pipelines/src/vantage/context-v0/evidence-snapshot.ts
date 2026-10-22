import { createHash } from "node:crypto";
import { contextSourceKeyV0, type ContextSourceRefV0 } from "../proposals/context-v0";
import type {
    ContextBudgetsV0,
    EvidenceSnapshotEntryV0,
    EvidenceSnapshotV0,
    SourceRegistryV0,
} from "./contracts";

export interface EvidenceSnapshotInputV0 {
    registry: SourceRegistryV0;
    refs: readonly ContextSourceRefV0[];
    asOf: string;
    budgets: Pick<ContextBudgetsV0, "maxSources" | "maxExcerptChars">;
}

export interface EvidenceSnapshotIssueV0 {
    path: string;
    code:
        | "invalid_budget"
        | "invalid_as_of"
        | "as_of_mismatch"
        | "invalid_refs"
        | "invalid_source_date"
        | "source_not_found"
        | "source_revoked"
        | "source_budget_exceeded"
        | "excerpt_budget_exceeded";
    message: string;
    status: 400 | 403 | 404 | 409;
}

export type EvidenceSnapshotResultV0 =
    | { ok: true; snapshot: EvidenceSnapshotV0; issues: readonly [] }
    | { ok: false; issues: readonly EvidenceSnapshotIssueV0[] };

function stable(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
        .join(",")}}`;
}

function fingerprint(entries: readonly EvidenceSnapshotEntryV0[]): string {
    return createHash("sha256").update(stable(entries), "utf8").digest("hex");
}

const strictIsoTimestamp =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const isoDateOrTimestamp =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/;

function validStrictIsoTimestamp(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const match = strictIsoTimestamp.exec(value);
    if (!match) return false;
    if (!validCalendarParts(match)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime());
}

function validIsoDateOrTimestamp(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const match = isoDateOrTimestamp.exec(value);
    if (!match || !validCalendarParts(match)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime());
}

function validCalendarParts(match: RegExpExecArray): boolean {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (
        calendar.getUTCFullYear() !== year ||
        calendar.getUTCMonth() !== month - 1 ||
        calendar.getUTCDate() !== day
    )
        return false;
    if (match[4] !== undefined) {
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        const second = Number(match[6]);
        if (hour > 23 || minute > 59 || second > 59) return false;
        const offset = match[8];
        if (
            offset &&
            offset !== "Z" &&
            (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)
        )
            return false;
    }
    return true;
}

function validBudget(value: unknown): value is number {
    return (
        typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    );
}

function validRef(value: unknown): value is ContextSourceRefV0 {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).kind === "string" &&
        typeof (value as Record<string, unknown>).id === "string" &&
        typeof (value as Record<string, unknown>).version === "string"
    );
}

/**
 * Produce a bounded, deterministic evidence snapshot from canonical registry
 * entries. Callers can supply refs in any order; the snapshot is canonicalized
 * before the hash is calculated.
 */
export function createEvidenceSnapshotV0(input: EvidenceSnapshotInputV0): EvidenceSnapshotResultV0 {
    const invalidIssues: EvidenceSnapshotIssueV0[] = [];
    if (!validBudget(input.budgets?.maxSources) || !validBudget(input.budgets?.maxExcerptChars))
        invalidIssues.push({
            path: "budgets",
            code: "invalid_budget",
            message: "Snapshot source and excerpt budgets must be finite non-negative integers.",
            status: 400,
        });
    if (!validStrictIsoTimestamp(input.asOf))
        invalidIssues.push({
            path: "asOf",
            code: "invalid_as_of",
            message: "Snapshot asOf must be a strict ISO timestamp.",
            status: 400,
        });
    const registryAsOf = input.registry?.scope?.reportWindow?.asOf;
    if (!validStrictIsoTimestamp(registryAsOf) || registryAsOf !== input.asOf)
        invalidIssues.push({
            path: "asOf",
            code: "as_of_mismatch",
            message: "Snapshot asOf must match the trusted registry report window.",
            status: 409,
        });
    if (!Array.isArray(input.refs) || !input.refs.every(validRef))
        invalidIssues.push({
            path: "refs",
            code: "invalid_refs",
            message: "Snapshot refs must be complete source references.",
            status: 400,
        });
    if (invalidIssues.length) return { ok: false, issues: invalidIssues };
    const refs = [...new Map(input.refs.map(ref => [contextSourceKeyV0(ref), ref])).values()].sort(
        (a, b) => contextSourceKeyV0(a).localeCompare(contextSourceKeyV0(b))
    );
    const issues: EvidenceSnapshotIssueV0[] = [];
    if (refs.length > input.budgets.maxSources)
        issues.push({
            path: "refs",
            code: "source_budget_exceeded",
            message: "Evidence sources exceed the aggregate source budget.",
            status: 409,
        });
    const entries: EvidenceSnapshotEntryV0[] = [];
    let totalExcerptChars = 0;
    for (const [index, ref] of refs.entries()) {
        const resolved = input.registry.get(ref);
        if (!resolved) {
            issues.push({
                path: `refs[${index}]`,
                code: "source_not_found",
                message: `Source ${contextSourceKeyV0(ref)} is not registered.`,
                status: 404,
            });
            continue;
        }
        if (!validIsoDateOrTimestamp(resolved.sourceDate)) {
            issues.push({
                path: `refs[${index}].sourceDate`,
                code: "invalid_source_date",
                message: "Registered source date is invalid.",
                status: 400,
            });
            continue;
        }
        if (Date.parse(resolved.sourceDate) > Date.parse(input.asOf)) {
            issues.push({
                path: `refs[${index}].sourceDate`,
                code: "invalid_source_date",
                message: "Registered source date cannot be later than snapshot asOf.",
                status: 409,
            });
            continue;
        }
        if (resolved.access === "revoked") {
            issues.push({
                path: `refs[${index}]`,
                code: "source_revoked",
                message: `Source ${contextSourceKeyV0(ref)} is revoked.`,
                status: 403,
            });
            continue;
        }
        totalExcerptChars += resolved.excerpt.length;
        if (totalExcerptChars > input.budgets.maxExcerptChars) {
            issues.push({
                path: `refs[${index}]`,
                code: "excerpt_budget_exceeded",
                message: "Evidence excerpts exceed the aggregate excerpt budget.",
                status: 409,
            });
            continue;
        }
        entries.push({
            source: resolved.source,
            contentHash: resolved.contentHash,
            excerpt: resolved.excerpt,
            ...(resolved.provenance ? { provenance: resolved.provenance } : {}),
            ...(resolved.citation ? { citation: resolved.citation } : {}),
        });
    }
    if (issues.length) return { ok: false, issues };
    const frozenEntries = Object.freeze(entries.map(entry => Object.freeze(entry)));
    const snapshot: EvidenceSnapshotV0 = Object.freeze({
        contractVersion: "v0-assembly-1",
        asOf: input.asOf,
        entries: frozenEntries,
        totalExcerptChars,
        contentFingerprint: fingerprint(frozenEntries),
    });
    return { ok: true, snapshot, issues: [] };
}

export { fingerprint as evidenceSnapshotFingerprintV0 };
