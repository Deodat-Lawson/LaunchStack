import { createHash } from "node:crypto";
import {
    contextSourceKeyV0,
    type ContextSourceEntryV0,
    type ContextSourceRefV0,
} from "../proposals/context-v0";
import type {
    RegisteredContextSourceV0,
    SourceRegistryBuildResultV0,
    SourceRegistryInputV0,
    SourceRegistryIssueV0,
    SourceRegistrySelectionResultV0,
    SourceRegistryV0,
    TrustedContextSourceV0,
} from "./contracts";

const privateKinds = new Set(["ev", "obs", "cm", "doc", "company"]);

function issue(
    path: string,
    code: SourceRegistryIssueV0["code"],
    message: string,
    status: SourceRegistryIssueV0["status"] = 400
): SourceRegistryIssueV0 {
    return { path, code, message, status };
}

function hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function freeze<T>(value: T): T {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    return value;
}

function audienceKey(value: ContextSourceEntryV0["audience"]): string {
    if (value.kind === "actor") return `actor:${value.principalRef}`;
    if (value.kind === "company") return `company:${value.companyId}`;
    return "public";
}

function sameSecurityMetadata(a: ContextSourceEntryV0, b: ContextSourceEntryV0): boolean {
    return (
        a.companyId === b.companyId &&
        a.access === b.access &&
        a.aclDigest === b.aclDigest &&
        audienceKey(a.audience) === audienceKey(b.audience) &&
        a.sourceDate === b.sourceDate &&
        a.checkedAt === b.checkedAt
    );
}

function stable(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map(
            field => `${JSON.stringify(field)}:${stable((value as Record<string, unknown>)[field])}`
        )
        .join(",")}}`;
}

function sameCanonicalMetadata(a: TrustedContextSourceV0, b: TrustedContextSourceV0): boolean {
    return (
        sameSecurityMetadata(a, b) &&
        a.excerpt === b.excerpt &&
        (a.content ?? a.excerpt) === (b.content ?? b.excerpt) &&
        stable(a.provenance) === stable(b.provenance) &&
        stable(a.citation) === stable(b.citation) &&
        stable(a.excerptOffsets) === stable(b.excerptOffsets)
    );
}

function validDate(value: string): boolean {
    if (typeof value !== "string") return false;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
        const date = new Date(
            Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
        );
        return (
            date.getUTCFullYear() === Number(dateOnly[1]) &&
            date.getUTCMonth() === Number(dateOnly[2]) - 1 &&
            date.getUTCDate() === Number(dateOnly[3])
        );
    }
    return (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
        Number.isFinite(Date.parse(value))
    );
}

function validateCatalogEntry(
    entry: TrustedContextSourceV0,
    index: number,
    input: SourceRegistryInputV0
): SourceRegistryIssueV0[] {
    const path = `trustedCatalog[${index}]`;
    const issues: SourceRegistryIssueV0[] = [];
    const ref = entry.source;
    if (!ref?.kind || !ref.id || !ref.version)
        issues.push(
            issue(`${path}.source`, "invalid_catalog", "A canonical source ref is required.")
        );
    if (entry.companyId !== input.actor.companyId)
        issues.push(
            issue(`${path}.companyId`, "cross_company", "Source crosses the company boundary.", 403)
        );
    if (entry.access !== "allowed" && entry.access !== "revoked")
        issues.push(
            issue(`${path}.access`, "invalid_catalog", "Trusted source access is invalid.")
        );
    if (!entry.aclDigest)
        issues.push(
            issue(`${path}.aclDigest`, "invalid_catalog", "Trusted ACL digest is required.", 403)
        );
    if (!validDate(entry.sourceDate) || !validDate(entry.checkedAt))
        issues.push(issue(path, "invalid_catalog", "Source and ACL check dates must be valid."));
    if (
        validDate(entry.sourceDate) &&
        validDate(input.reportWindow.asOf) &&
        Date.parse(entry.sourceDate) > Date.parse(input.reportWindow.asOf)
    )
        issues.push(
            issue(
                `${path}.sourceDate`,
                "future_source",
                "Source is newer than the report asOf.",
                409
            )
        );
    if (typeof entry.excerpt !== "string" || entry.excerpt.length > 12000)
        issues.push(
            issue(`${path}.excerpt`, "invalid_excerpt", "Canonical excerpts must be bounded.")
        );
    const canonicalContent = entry.content ?? entry.excerpt;
    if (typeof canonicalContent !== "string")
        issues.push(issue(`${path}.content`, "invalid_excerpt", "Canonical content must be text."));
    if (entry.access === "revoked" && entry.excerpt !== "")
        issues.push(
            issue(
                `${path}.excerpt`,
                "invalid_excerpt",
                "Revoked sources cannot expose excerpts.",
                403
            )
        );
    if (entry.provenance && !entry.provenance.connector)
        issues.push(
            issue(`${path}.provenance`, "invalid_catalog", "Source provenance needs a connector.")
        );
    if (entry.citation) {
        if (!entry.citation.title || !entry.citation.url || !entry.citation.provenance)
            issues.push(
                issue(`${path}.citation`, "invalid_catalog", "Citation metadata is incomplete.")
            );
        if (!validDate(entry.citation.sourceDate) || !validDate(entry.citation.accessedAt))
            issues.push(
                issue(`${path}.citation`, "invalid_catalog", "Citation dates must be valid.")
            );
    }
    if (ref.kind === "public") {
        if (entry.audience.kind !== "public")
            issues.push(
                issue(
                    `${path}.audience`,
                    "public_relabel",
                    "Public refs must have public audience metadata.",
                    403
                )
            );
    } else {
        if (entry.audience.kind === "public")
            issues.push(
                issue(
                    `${path}.audience`,
                    "public_relabel",
                    "Private refs cannot be relabeled public.",
                    403
                )
            );
        if (
            entry.audience.kind === "actor" &&
            entry.audience.principalRef !== input.actor.principalRef
        )
            issues.push(
                issue(
                    `${path}.audience.principalRef`,
                    "cross_actor",
                    "Source crosses the actor boundary.",
                    403
                )
            );
        if (entry.audience.kind === "company" && entry.audience.companyId !== input.actor.companyId)
            issues.push(
                issue(
                    `${path}.audience.companyId`,
                    "cross_company",
                    "Source crosses the company boundary.",
                    403
                )
            );
    }
    if (entry.source.kind === "company" && entry.audience.kind !== "company")
        issues.push(
            issue(
                `${path}.audience`,
                "public_relabel",
                "Company sources must use company audience metadata.",
                403
            )
        );
    if (!privateKinds.has(entry.source.kind) && entry.source.kind !== "public")
        issues.push(issue(`${path}.source.kind`, "invalid_catalog", "Unknown source kind."));
    return issues;
}

function makeRegistered(entry: TrustedContextSourceV0): RegisteredContextSourceV0 {
    const canonicalContent = entry.content ?? entry.excerpt;
    const contentHash = entry.contentHash ?? hashContent(canonicalContent);
    if (
        !/^[a-f0-9]{64}$/i.test(contentHash) ||
        contentHash.toLowerCase() !== hashContent(canonicalContent)
    )
        throw new Error("invalid content hash");
    return {
        source: clone(entry.source),
        companyId: entry.companyId,
        access: entry.access,
        aclDigest: entry.aclDigest,
        audience: clone(entry.audience),
        sourceDate: entry.sourceDate,
        checkedAt: entry.checkedAt,
        excerpt: entry.excerpt,
        ...(entry.excerptOffsets ? { excerptOffsets: clone(entry.excerptOffsets) } : {}),
        contentHash,
        ...(entry.provenance ? { provenance: clone(entry.provenance) } : {}),
        ...(entry.citation ? { citation: clone(entry.citation) } : {}),
    };
}

function selectionMatches(
    canonical: RegisteredContextSourceV0,
    selected: ContextSourceEntryV0
): boolean {
    return sameSecurityMetadata(canonical, selected);
}

class ImmutableSourceRegistry implements SourceRegistryV0 {
    readonly scope: SourceRegistryV0["scope"];
    readonly entries: readonly RegisteredContextSourceV0[];
    private readonly byRef: ReadonlyMap<string, RegisteredContextSourceV0>;

    constructor(input: SourceRegistryInputV0, entries: readonly RegisteredContextSourceV0[]) {
        this.scope = freeze(clone({ actor: input.actor, reportWindow: input.reportWindow }));
        this.entries = freeze(clone(entries));
        this.byRef = new Map(this.entries.map(entry => [contextSourceKeyV0(entry.source), entry]));
    }

    get(ref: ContextSourceRefV0): RegisteredContextSourceV0 | undefined {
        return this.byRef.get(contextSourceKeyV0(ref));
    }

    has(ref: ContextSourceRefV0): boolean {
        return this.byRef.has(contextSourceKeyV0(ref));
    }

    resolve(selection: ContextSourceRefV0 | ContextSourceEntryV0): SourceRegistrySelectionResultV0 {
        const ref =
            selection && typeof selection === "object" && "source" in selection
                ? selection.source
                : selection;
        if (!ref?.kind || !ref.id || !ref.version)
            return {
                ok: false,
                issues: [
                    issue(
                        "selection.source",
                        "source_not_found",
                        "A complete source ref is required.",
                        404
                    ),
                ],
            };
        const canonical = this.get(ref);
        if (!canonical)
            return {
                ok: false,
                issues: [
                    issue(
                        "selection.source",
                        "source_not_found",
                        `Source ${contextSourceKeyV0(ref)} is not in the trusted catalog.`,
                        404
                    ),
                ],
            };
        if (canonical.access === "revoked")
            return {
                ok: false,
                issues: [
                    issue(
                        "selection",
                        "source_revoked",
                        `Source ${contextSourceKeyV0(ref)} is revoked.`,
                        403
                    ),
                ],
            };
        if ("companyId" in selection && !selectionMatches(canonical, selection))
            return {
                ok: false,
                issues: [
                    issue(
                        "selection",
                        "selection_metadata_mismatch",
                        `Selection metadata does not match the server-trusted source ${contextSourceKeyV0(ref)}.`,
                        403
                    ),
                ],
            };
        return { ok: true, source: canonical };
    }
}

/** Build a pure immutable registry from server-trusted catalog contents. */
export function createSourceRegistryV0(input: SourceRegistryInputV0): SourceRegistryBuildResultV0 {
    const issues: SourceRegistryIssueV0[] = [];
    const byRef = new Map<string, TrustedContextSourceV0>();
    for (const [index, entry] of input.trustedCatalog.entries()) {
        issues.push(...validateCatalogEntry(entry, index, input));
        const key = contextSourceKeyV0(entry.source);
        const previous = byRef.get(key);
        if (previous) {
            const sameContent =
                (previous.content ?? previous.excerpt) === (entry.content ?? entry.excerpt);
            const previousHash =
                previous.contentHash ?? hashContent(previous.content ?? previous.excerpt);
            const entryHash = entry.contentHash ?? hashContent(entry.content ?? entry.excerpt);
            if (
                !sameCanonicalMetadata(previous, entry) ||
                !sameContent ||
                previousHash !== entryHash
            )
                issues.push(
                    issue(
                        `trustedCatalog[${index}]`,
                        "conflicting_source_metadata",
                        `Conflicting records share source ref ${key}.`,
                        409
                    )
                );
            continue;
        }
        byRef.set(key, entry);
    }
    if (issues.length) return { ok: false, issues: freeze(clone(issues)) };
    let entries: RegisteredContextSourceV0[];
    try {
        entries = [...byRef.values()]
            .map(makeRegistered)
            .sort((a, b) =>
                contextSourceKeyV0(a.source).localeCompare(contextSourceKeyV0(b.source))
            );
    } catch {
        return {
            ok: false,
            issues: [
                issue(
                    "trustedCatalog",
                    "invalid_content_hash",
                    "Canonical content hash is invalid."
                ),
            ],
        };
    }
    const registry = new ImmutableSourceRegistry(input, entries);
    return { ok: true, registry, issues: [] };
}

export const buildSourceRegistryV0 = createSourceRegistryV0;
export const createImmutableSourceRegistryV0 = createSourceRegistryV0;

export { ImmutableSourceRegistry };
