/**
 * Proposed Week 2 context handoffs.
 *
 * This file is intentionally isolated from contract-v1 and is not exported by
 * the Vantage package entry point. The types describe a reviewable seam for
 * Joseph, Sophia and the TL assembler; they do not implement a role store,
 * source resolver, retriever, public search client or generation adapter.
 */

export const CONTEXT_V0_CONTRACT_VERSION = "v0-proposed" as const;

export type ContextSourceKindV0 = "ev" | "obs" | "cm" | "doc" | "company" | "public";

/** Object form is deliberate: this must never be confused with v1's ev:/obs:/cm: strings. */
export interface ContextSourceRefV0 {
    kind: ContextSourceKindV0;
    id: string;
    version: string;
}

export interface CompanyArchitectureRefV0 extends ContextSourceRefV0 {
    kind: "company";
    companyId: string;
    canonical: true;
    reviewState: "reviewed" | "unknowns-marked" | "unreviewed";
}

export type ContextHttpStatusV0 = 400 | 401 | 403 | 404 | 409 | 500 | 503;

export interface ContextValidationIssueV0 {
    path: string;
    code: string;
    message: string;
    status: ContextHttpStatusV0;
}

export interface ContextValidationResultV0<T> {
    ok: boolean;
    value?: T;
    issues: ContextValidationIssueV0[];
}

export interface ContextValidationOptionsV0 {
    expectedCompanyId?: string;
    expectedPrincipalRef?: string;
    expectedAclDigest?: string;
    knownCompanyIds?: readonly string[];
    trustedPublicProjections?: readonly {
        approvalToken: string;
        projectionId: string;
        query: string;
    }[];
}

export interface BusinessRoleV0 {
    roleId: string;
    description: string;
    responsibilities: string[];
    priorities: string[];
}

export interface BusinessRoleProvenanceV0 {
    kind: "server" | "directory" | "user-confirmed" | "fallback";
    source: string;
}

export interface BusinessRoleContextV0 {
    contractVersion: typeof CONTEXT_V0_CONTRACT_VERSION;
    authenticatedPrincipalRef: string;
    roleIds: string[];
    primaryRoleId?: string;
    mappingVersion: string;
    roles: BusinessRoleV0[];
    provenance: BusinessRoleProvenanceV0;
    userConfirmed: boolean;
    fallback: boolean;
}

export type ContextAudienceV0 = { kind: "actor"; principalRef: string };

export type ContextSourceAudienceV0 =
    | ContextAudienceV0
    | { kind: "company"; companyId: string }
    | { kind: "public" };

export interface ContextScopeV0 {
    principalRef: string;
    companyId: string;
    audience: ContextAudienceV0;
    aclDigest: string;
}

export interface ContextSourceEntryV0 {
    source: ContextSourceRefV0;
    companyId: string;
    access: "allowed" | "revoked";
    aclDigest: string;
    audience: ContextSourceAudienceV0;
    sourceDate: string;
    checkedAt: string;
    excerpt: string;
    /** Optional until the source adapter can return offsets; when present it is validated. */
    excerptOffsets?: { start: number; end: number; sourceVersion: string };
}

export interface RequiredContextSourceV0 extends ContextSourceEntryV0 {
    required: true;
}

export interface RequiredCompanyArchitectureSourceV0 extends RequiredContextSourceV0 {
    source: CompanyArchitectureRefV0;
    canonical: true;
}

export interface PersonalVantageStarSourceV0 extends RequiredContextSourceV0 {
    module: "vantage";
}

export interface RequiredContextCoverageV0 {
    checked: ContextSourceRefV0[];
    used: ContextSourceRefV0[];
    missing: ContextSourceRefV0[];
    revoked: ContextSourceRefV0[];
    omitted: ContextSourceRefV0[];
}

export interface RequiredContextBundleV0 {
    contractVersion: typeof CONTEXT_V0_CONTRACT_VERSION;
    asOf: string;
    actor: ContextScopeV0;
    companyArchitecture: RequiredCompanyArchitectureSourceV0;
    workspaceMandatoryDocuments: RequiredContextSourceV0[];
    personalVantageStars: PersonalVantageStarSourceV0[];
    constraints: string[];
    coverage: RequiredContextCoverageV0;
    status: "complete" | "partial" | "blocked";
}

export interface ContextReportWindowV0 {
    startInclusive: string;
    endExclusive: string;
    asOf: string;
}

export interface ContextBudgetsV0 {
    maxSources: number;
    maxExcerptChars: number;
    timeoutMs: number;
    maxQueries: number;
    maxTokens: number;
}

export interface DynamicRetrievalInputV0 {
    contractVersion: typeof CONTEXT_V0_CONTRACT_VERSION;
    actor: ContextScopeV0;
    verifiedRoleContext: BusinessRoleContextV0;
    reportWindow: ContextReportWindowV0;
    sourceCatalog: ContextSourceEntryV0[];
    budgets: ContextBudgetsV0;
}

export interface DynamicRetrievalItemV0 extends ContextSourceEntryV0 {
    roleIds: string[];
    rank: number;
    selectionReason: string;
    dedupKey: string;
}

export interface ContextOmissionV0 {
    source?: ContextSourceRefV0;
    reason: "budget" | "duplicate" | "out-of-scope" | "revoked" | "timeout" | "invalid";
}

export interface ContextFailureV0 {
    code: "timeout" | "source_unavailable" | "permission_denied" | "invalid_source" | "internal";
    message: string;
    source?: ContextSourceRefV0;
}

export interface DynamicRetrievalBundleV0 {
    contractVersion: typeof CONTEXT_V0_CONTRACT_VERSION;
    actor: ContextScopeV0;
    reportWindow: ContextReportWindowV0;
    roleMatches: DynamicRetrievalItemV0[];
    recentChanges: DynamicRetrievalItemV0[];
    unresolvedOlderItems: DynamicRetrievalItemV0[];
    sourceRegistry: ContextSourceEntryV0[];
    deduped: ContextSourceRefV0[];
    omissions: ContextOmissionV0[];
    failures: ContextFailureV0[];
    status: "complete" | "partial" | "timeout";
}

export interface PublicSafeQueryProjectionV0 {
    projectionId: string;
    query: string;
    purpose: string;
    approvalToken: string;
    validatedAt: string;
}

export type ContextResearchModeV0 = "STOP" | "internal" | "public";

export interface ContextResearchPlanV0 {
    contractVersion: typeof CONTEXT_V0_CONTRACT_VERSION;
    mode: ContextResearchModeV0;
    gapPurpose: string;
    internalSourceRefs: ContextSourceRefV0[];
    publicSafeQueryProjection: PublicSafeQueryProjectionV0[];
    budgets: ContextBudgetsV0;
}

export interface PublicCitationV0 {
    source: ContextSourceRefV0 & { kind: "public" };
    title: string;
    url: string;
    sourceDate: string;
    accessedAt: string;
    provenance: string;
}

export interface ContextResearchResultV0 {
    contractVersion: typeof CONTEXT_V0_CONTRACT_VERSION;
    mode: ContextResearchModeV0;
    gapPurpose: string;
    publicSafeQueryProjection: PublicSafeQueryProjectionV0[];
    internalSourceRefs: ContextSourceRefV0[];
    citations: PublicCitationV0[];
    failures: ContextFailureV0[];
    status: "complete" | "partial" | "stopped" | "failed";
    asOf: string;
}

export interface ContextManifestCoverageV0 extends RequiredContextCoverageV0 {
    researchOmitted: ContextSourceRefV0[];
}

export interface ContextResearchStateV0 {
    mode: ContextResearchModeV0;
    status: ContextResearchResultV0["status"];
    citationRefs: ContextSourceRefV0[];
    failures: ContextFailureV0[];
}

export interface ContextManifestV0 {
    contractVersion: typeof CONTEXT_V0_CONTRACT_VERSION;
    runId: string;
    inputVersion: string;
    contextFingerprint: string;
    actor: ContextScopeV0;
    reportWindow: ContextReportWindowV0;
    roleMapVersion: string;
    roleIds: string[];
    roleProfileVersions: Record<string, string>;
    companyArchitectureVersion: string;
    personalStarVersions: Record<string, string>;
    sourceVersions: Record<string, string>;
    sourceRegistry: ContextSourceEntryV0[];
    coverage: ContextManifestCoverageV0;
    omissions: ContextOmissionV0[];
    research: ContextResearchStateV0;
    status: "complete" | "partial" | "blocked";
}

export interface ContextManifestConsumerResultV0 {
    accepted: boolean;
    registeredSourceRefs: ContextSourceRefV0[];
    issues: ContextValidationIssueV0[];
}

export interface ContextManifestConsumerV0 {
    consume(manifest: unknown): ContextManifestConsumerResultV0;
}

const sourceKinds = new Set<ContextSourceKindV0>(["ev", "obs", "cm", "doc", "company", "public"]);
const researchModes = new Set<ContextResearchModeV0>(["STOP", "internal", "public"]);
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoTimestampPattern =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const validCalendarDate = (year: number, month: number, day: number): boolean => {
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const represented = new Date(Date.UTC(year, month - 1, day));
    return (
        represented.getUTCFullYear() === year &&
        represented.getUTCMonth() === month - 1 &&
        represented.getUTCDate() === day
    );
};
const isoDate = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    const dateOnly = dateOnlyPattern.exec(value);
    if (dateOnly)
        return validCalendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    const timestamp = isoTimestampPattern.exec(value);
    if (!timestamp) return false;
    const [, year, month, day, hour, minute, second, , offset] = timestamp;
    if (!offset) return false;
    if (
        !validCalendarDate(Number(year), Number(month), Number(day)) ||
        Number(hour) > 23 ||
        Number(minute) > 59 ||
        Number(second) > 59 ||
        (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))
    )
        return false;
    return Number.isFinite(Date.parse(value));
};
const nonEmpty = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const array = (value: unknown): value is unknown[] => Array.isArray(value);
const strings = (value: unknown): value is string[] => array(value) && value.every(nonEmpty);
const unique = (values: string[]) => new Set(values).size === values.length;
const encodeSourcePart = (value: string): string =>
    /[\\:@]/.test(value)
        ? `~${value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("@", "\\@")}`
        : value;
const sourceKey = (source: ContextSourceRefV0): string =>
    `${source.kind}:${encodeSourcePart(source.id)}@${encodeSourcePart(source.version)}`;

function audienceKey(value: unknown): string {
    if (!object(value) || typeof value.kind !== "string") return "";
    if (value.kind === "actor") return `actor:${String(value.principalRef)}`;
    if (value.kind === "company") return `company:${String(value.companyId)}`;
    return value.kind;
}

function sameAuthorizedSourceMetadata(
    selected: ContextSourceEntryV0,
    authorized: ContextSourceEntryV0
): boolean {
    return (
        selected.companyId === authorized.companyId &&
        selected.access === "allowed" &&
        authorized.access === "allowed" &&
        selected.aclDigest === authorized.aclDigest &&
        audienceKey(selected.audience) === audienceKey(authorized.audience)
    );
}

function result<T>(value: T): ContextValidationResultV0<T> {
    return { ok: true, value, issues: [] };
}

function invalid<T>(issues: ContextValidationIssueV0[]): ContextValidationResultV0<T> {
    return { ok: false, issues };
}

function issue(
    path: string,
    code: string,
    message: string,
    status: ContextHttpStatusV0 = 400
): ContextValidationIssueV0 {
    return { path, code, message, status };
}

function asFiniteNumber(value: unknown, path: string, issues: ContextValidationIssueV0[]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        issues.push(
            issue(path, "invalid_budget", "Budget values must be finite non-negative numbers.")
        );
}

function validateBudgets(value: unknown, path: string, issues: ContextValidationIssueV0[]) {
    if (!object(value)) {
        issues.push(issue(path, "invalid_budget", "Budgets are required."));
        return;
    }
    for (const key of ["maxSources", "maxExcerptChars", "timeoutMs", "maxQueries", "maxTokens"])
        asFiniteNumber(value[key], `${path}.${key}`, issues);
}

function validateAudience(
    value: unknown,
    path: string,
    issues: ContextValidationIssueV0[],
    options: ContextValidationOptionsV0 = {}
) {
    if (!object(value) || !nonEmpty(value.kind)) {
        issues.push(issue(path, "invalid_audience", "An audience kind is required."));
        return;
    }
    if (value.kind === "actor") {
        if (!nonEmpty(value.principalRef))
            issues.push(
                issue(
                    `${path}.principalRef`,
                    "invalid_audience",
                    "Actor audience needs a principal."
                )
            );
        if (options.expectedCompanyId && value.principalRef === "")
            issues.push(issue(path, "invalid_audience", "Actor audience cannot be empty."));
    } else if (value.kind === "company") {
        if (!nonEmpty(value.companyId))
            issues.push(
                issue(`${path}.companyId`, "invalid_audience", "Company audience needs a company.")
            );
        if (options.expectedCompanyId && value.companyId !== options.expectedCompanyId)
            issues.push(
                issue(
                    `${path}.companyId`,
                    "cross_company",
                    "Audience crosses the authenticated company boundary.",
                    403
                )
            );
    } else if (value.kind !== "public") {
        issues.push(issue(`${path}.kind`, "invalid_audience", "Unknown audience kind."));
    }
}

function validateScope(
    value: unknown,
    path: string,
    issues: ContextValidationIssueV0[],
    options: ContextValidationOptionsV0 = {}
): value is ContextScopeV0 {
    if (!object(value)) {
        issues.push(issue(path, "invalid_scope", "Actor scope is required."));
        return false;
    }
    if (!nonEmpty(value.principalRef))
        issues.push(issue(`${path}.principalRef`, "invalid_scope", "Principal is required."));
    if (!nonEmpty(value.companyId))
        issues.push(issue(`${path}.companyId`, "invalid_scope", "Company is required."));
    if (options.expectedCompanyId && value.companyId !== options.expectedCompanyId)
        issues.push(
            issue(
                `${path}.companyId`,
                "cross_company",
                "Context crosses the authenticated company boundary.",
                403
            )
        );
    if (options.expectedPrincipalRef && value.principalRef !== options.expectedPrincipalRef)
        issues.push(
            issue(
                `${path}.principalRef`,
                "principal_mismatch",
                "Context principal does not match the server-resolved actor.",
                403
            )
        );
    if (options.knownCompanyIds && !options.knownCompanyIds.includes(value.companyId as string))
        issues.push(
            issue(
                `${path}.companyId`,
                "unknown_company",
                "Company is not registered for this context.",
                404
            )
        );
    if (!nonEmpty(value.aclDigest))
        issues.push(
            issue(
                `${path}.aclDigest`,
                "missing_acl_digest",
                "Server-resolved ACL digest is required.",
                403
            )
        );
    if (options.expectedAclDigest && value.aclDigest !== options.expectedAclDigest)
        issues.push(
            issue(
                `${path}.aclDigest`,
                "acl_digest_mismatch",
                "ACL digest does not match the server-resolved actor scope.",
                403
            )
        );
    validateAudience(value.audience, `${path}.audience`, issues, options);
    if (object(value.audience) && value.audience.kind !== "actor")
        issues.push(
            issue(
                `${path}.audience`,
                "invalid_scope_audience",
                "V0 actor scope is limited to the authenticated actor.",
                403
            )
        );
    if (
        object(value.audience) &&
        value.audience.kind === "actor" &&
        value.audience.principalRef !== value.principalRef
    )
        issues.push(
            issue(
                `${path}.audience.principalRef`,
                "principal_mismatch",
                "Actor audience must match scope principal.",
                403
            )
        );
    return true;
}

function validateSourceRef(
    value: unknown,
    path: string,
    issues: ContextValidationIssueV0[],
    expectedKind?: ContextSourceKindV0
): value is ContextSourceRefV0 {
    if (!object(value) || !sourceKinds.has(value.kind as ContextSourceKindV0)) {
        issues.push(
            issue(
                path,
                "invalid_source_ref",
                "A proposed object source ref with a known kind is required."
            )
        );
        return false;
    }
    if (expectedKind && value.kind !== expectedKind)
        issues.push(
            issue(`${path}.kind`, "invalid_source_kind", `Expected source kind ${expectedKind}.`)
        );
    if (!nonEmpty(value.id) || value.id.includes(" "))
        issues.push(
            issue(`${path}.id`, "invalid_source_ref", "Source ID must be a non-empty opaque token.")
        );
    if (!nonEmpty(value.version))
        issues.push(
            issue(`${path}.version`, "missing_source_version", "Exact source version is required.")
        );
    return true;
}

function validateDateOrder(
    start: unknown,
    end: unknown,
    asOf: unknown,
    path: string,
    issues: ContextValidationIssueV0[]
) {
    if (!isoDate(start))
        issues.push(
            issue(
                `${path}.startInclusive`,
                "invalid_date",
                "Start must be an ISO date or timestamp."
            )
        );
    if (!isoDate(end))
        issues.push(
            issue(`${path}.endExclusive`, "invalid_date", "End must be an ISO date or timestamp.")
        );
    if (!isoDate(asOf))
        issues.push(
            issue(`${path}.asOf`, "invalid_date", "asOf must be an ISO date or timestamp.")
        );
    if (isoDate(start) && isoDate(end) && Date.parse(start) >= Date.parse(end))
        issues.push(
            issue(path, "invalid_window", "The report window must be half-open and ordered.")
        );
    if (isoDate(end) && isoDate(asOf) && Date.parse(asOf) < Date.parse(end))
        issues.push(issue(path, "invalid_window", "asOf cannot precede the report end."));
}

function validateRoleContextShape(
    value: unknown,
    path: string,
    issues: ContextValidationIssueV0[]
) {
    if (!object(value)) {
        issues.push(
            issue(path, "invalid_role_context", "Verified business role context is required.")
        );
        return;
    }
    if (value.contractVersion !== CONTEXT_V0_CONTRACT_VERSION)
        issues.push(
            issue(
                `${path}.contractVersion`,
                "wrong_contract_version",
                "Only the proposed context version is accepted."
            )
        );
    if (!nonEmpty(value.authenticatedPrincipalRef))
        issues.push(
            issue(
                `${path}.authenticatedPrincipalRef`,
                "invalid_role_context",
                "Authenticated principal is required."
            )
        );
    if (!strings(value.roleIds) || !unique(value.roleIds))
        issues.push(
            issue(`${path}.roleIds`, "invalid_role_context", "roleIds must be unique opaque IDs.")
        );
    if (!nonEmpty(value.mappingVersion))
        issues.push(
            issue(
                `${path}.mappingVersion`,
                "missing_mapping_version",
                "Role mapping version is required."
            )
        );
    if (!array(value.roles)) {
        issues.push(
            issue(`${path}.roles`, "invalid_role_context", "Role descriptions are required.")
        );
    } else {
        const roleIds = new Set(strings(value.roleIds) ? value.roleIds : []);
        const described = new Set<string>();
        value.roles.forEach((role, index) => {
            if (!object(role) || !nonEmpty(role.roleId)) {
                issues.push(
                    issue(`${path}.roles[${index}]`, "invalid_role", "Each role needs a roleId.")
                );
                return;
            }
            if (described.has(role.roleId))
                issues.push(
                    issue(
                        `${path}.roles[${index}].roleId`,
                        "duplicate_role",
                        "Role IDs must be unique."
                    )
                );
            described.add(role.roleId);
            if (!roleIds.has(role.roleId))
                issues.push(
                    issue(
                        `${path}.roles[${index}].roleId`,
                        "role_escalation",
                        "Role description is outside roleIds.",
                        403
                    )
                );
            if (
                !nonEmpty(role.description) ||
                !strings(role.responsibilities) ||
                !strings(role.priorities)
            )
                issues.push(
                    issue(
                        `${path}.roles[${index}]`,
                        "invalid_role",
                        "Role description, responsibilities and priorities are required."
                    )
                );
        });
        for (const roleId of roleIds)
            if (!described.has(roleId))
                issues.push(
                    issue(
                        `${path}.roles`,
                        "missing_role_description",
                        `No description is supplied for ${roleId}.`
                    )
                );
    }
    if (
        value.primaryRoleId !== undefined &&
        (!nonEmpty(value.primaryRoleId) ||
            !strings(value.roleIds) ||
            !value.roleIds.includes(value.primaryRoleId))
    )
        issues.push(
            issue(
                `${path}.primaryRoleId`,
                "role_escalation",
                "primaryRoleId must be one of roleIds.",
                403
            )
        );
    const provenance = object(value.provenance) ? value.provenance : undefined;
    if (
        !provenance ||
        !["server", "directory", "user-confirmed", "fallback"].includes(
            provenance.kind as string
        ) ||
        !nonEmpty(provenance.source)
    )
        issues.push(
            issue(
                `${path}.provenance`,
                "invalid_provenance",
                "Role provenance kind and source are required."
            )
        );
    if (typeof value.userConfirmed !== "boolean")
        issues.push(
            issue(`${path}.userConfirmed`, "invalid_role_context", "userConfirmed must be boolean.")
        );
    if (typeof value.fallback !== "boolean")
        issues.push(issue(`${path}.fallback`, "invalid_role_context", "fallback must be boolean."));
    if (value.fallback === true && provenance?.kind !== "fallback")
        issues.push(
            issue(
                `${path}.fallback`,
                "invalid_fallback",
                "Fallback context must declare fallback provenance."
            )
        );
}

function validateSourceEntry(
    value: unknown,
    path: string,
    issues: ContextValidationIssueV0[],
    options: ContextValidationOptionsV0 = {},
    asOf?: string
): value is ContextSourceEntryV0 {
    if (!object(value)) {
        issues.push(issue(path, "invalid_source", "Source entry is required."));
        return false;
    }
    const sourceOk = validateSourceRef(value.source, `${path}.source`, issues);
    const sourceKind = object(value.source)
        ? (value.source.kind as ContextSourceKindV0)
        : undefined;
    if (!nonEmpty(value.companyId))
        issues.push(issue(`${path}.companyId`, "invalid_source", "Source company is required."));
    if (options.expectedCompanyId && value.companyId !== options.expectedCompanyId)
        issues.push(
            issue(
                `${path}.companyId`,
                "cross_company",
                "Source crosses the authenticated company boundary.",
                403
            )
        );
    if (options.knownCompanyIds && !options.knownCompanyIds.includes(value.companyId as string))
        issues.push(
            issue(`${path}.companyId`, "unknown_company", "Source company is unknown.", 404)
        );
    if (value.access !== "allowed" && value.access !== "revoked")
        issues.push(
            issue(
                `${path}.access`,
                "invalid_source_access",
                "Source access must be allowed or revoked."
            )
        );
    if (!nonEmpty(value.aclDigest))
        issues.push(
            issue(`${path}.aclDigest`, "missing_acl_digest", "Source ACL digest is required.", 403)
        );
    validateAudience(value.audience, `${path}.audience`, issues, options);
    if (
        object(value.audience) &&
        value.audience.kind === "actor" &&
        options.expectedPrincipalRef &&
        value.audience.principalRef !== options.expectedPrincipalRef
    )
        issues.push(
            issue(
                `${path}.audience.principalRef`,
                "principal_mismatch",
                "Actor source audience does not match the server-resolved actor.",
                403
            )
        );
    if (sourceKind === "public" && (!object(value.audience) || value.audience.kind !== "public"))
        issues.push(
            issue(
                `${path}.audience`,
                "public_source_audience_mismatch",
                "Public sources must use public source audience metadata.",
                403
            )
        );
    if (
        sourceKind !== undefined &&
        sourceKind !== "public" &&
        object(value.audience) &&
        value.audience.kind === "public"
    )
        issues.push(
            issue(
                `${path}.audience`,
                "private_public_audience",
                "Private source kinds cannot be relabeled as public.",
                403
            )
        );
    if (!isoDate(value.sourceDate))
        issues.push(issue(`${path}.sourceDate`, "invalid_date", "Source date is required."));
    if (asOf && isoDate(value.sourceDate) && Date.parse(value.sourceDate) > Date.parse(asOf))
        issues.push(
            issue(`${path}.sourceDate`, "outside_as_of", "Source date is later than asOf.", 409)
        );
    if (!isoDate(value.checkedAt))
        issues.push(issue(`${path}.checkedAt`, "invalid_date", "ACL check time is required."));
    if (typeof value.excerpt !== "string" || value.excerpt.length > 12000)
        issues.push(
            issue(`${path}.excerpt`, "invalid_excerpt", "Excerpt must be a bounded string.")
        );
    if (value.excerptOffsets !== undefined) {
        if (
            !object(value.excerptOffsets) ||
            typeof value.excerptOffsets.start !== "number" ||
            typeof value.excerptOffsets.end !== "number" ||
            !nonEmpty(value.excerptOffsets.sourceVersion) ||
            !Number.isInteger(value.excerptOffsets.start) ||
            !Number.isInteger(value.excerptOffsets.end) ||
            value.excerptOffsets.start < 0 ||
            value.excerptOffsets.end < value.excerptOffsets.start
        )
            issues.push(
                issue(
                    `${path}.excerptOffsets`,
                    "invalid_excerpt_offsets",
                    "Excerpt offsets must be ordered non-negative integers."
                )
            );
        if (
            object(value.excerptOffsets) &&
            object(value.source) &&
            nonEmpty(value.excerptOffsets.sourceVersion) &&
            value.excerptOffsets.sourceVersion !== value.source.version
        )
            issues.push(
                issue(
                    `${path}.excerptOffsets.sourceVersion`,
                    "source_version_mismatch",
                    "Excerpt source version must match the canonical source ref.",
                    409
                )
            );
        if (
            object(value.excerptOffsets) &&
            typeof value.excerptOffsets.end === "number" &&
            typeof value.excerptOffsets.start === "number" &&
            typeof value.excerpt === "string" &&
            value.excerptOffsets.end - value.excerptOffsets.start !== value.excerpt.length
        )
            issues.push(
                issue(
                    `${path}.excerptOffsets`,
                    "excerpt_offset_mismatch",
                    "Excerpt offsets must bound the supplied excerpt."
                )
            );
    }
    if (value.access === "revoked" && value.excerpt !== "")
        issues.push(
            issue(
                `${path}.excerpt`,
                "revoked_source_body",
                "Revoked sources cannot carry a cacheable excerpt.",
                403
            )
        );
    return sourceOk;
}

function validateRefArray(value: unknown, path: string, issues: ContextValidationIssueV0[]) {
    if (!array(value)) {
        issues.push(issue(path, "invalid_source_refs", "A source-ref array is required."));
        return [] as ContextSourceRefV0[];
    }
    const refs: ContextSourceRefV0[] = [];
    value.forEach((ref, index) => {
        if (validateSourceRef(ref, `${path}[${index}]`, issues)) refs.push(ref);
    });
    if (!unique(refs.map(sourceKey)))
        issues.push(issue(path, "duplicate_source_ref", "Source refs must be unique."));
    return refs;
}

function validateCoverage(value: unknown, path: string, issues: ContextValidationIssueV0[]) {
    if (!object(value)) {
        issues.push(issue(path, "invalid_coverage", "Coverage is required."));
        return {
            checked: [],
            used: [],
            missing: [],
            revoked: [],
            omitted: [],
        } as RequiredContextCoverageV0;
    }
    return {
        checked: validateRefArray(value.checked, `${path}.checked`, issues),
        used: validateRefArray(value.used, `${path}.used`, issues),
        missing: validateRefArray(value.missing, `${path}.missing`, issues),
        revoked: validateRefArray(value.revoked, `${path}.revoked`, issues),
        omitted: validateRefArray(value.omitted, `${path}.omitted`, issues),
    };
}

function validateCoverageAgainstRegistry(
    coverage: RequiredContextCoverageV0,
    registry: ContextSourceEntryV0[],
    path: string,
    issues: ContextValidationIssueV0[]
) {
    const entries = new Map(
        registry
            .filter(entry => object(entry) && object(entry.source))
            .map(entry => [sourceKey(entry.source as unknown as ContextSourceRefV0), entry])
    );
    const checked = new Set(coverage.checked.map(sourceKey));
    const revoked = new Set(coverage.revoked.map(sourceKey));
    const missing = new Set(coverage.missing.map(sourceKey));
    for (const ref of [...coverage.used, ...coverage.checked]) {
        if (!entries.has(sourceKey(ref)))
            issues.push(
                issue(
                    path,
                    "source_version_mismatch",
                    `Source ${sourceKey(ref)} is not in the registry.`,
                    409
                )
            );
    }
    for (const ref of coverage.used) {
        const entry = entries.get(sourceKey(ref));
        if (
            revoked.has(sourceKey(ref)) ||
            missing.has(sourceKey(ref)) ||
            entry?.access === "revoked"
        )
            issues.push(
                issue(
                    path,
                    "revoked_or_missing_source",
                    `Source ${sourceKey(ref)} cannot be used.`,
                    403
                )
            );
    }
    for (const entry of registry)
        if (
            entry.access === "allowed" &&
            !checked.has(sourceKey(entry.source)) &&
            entry.source.kind !== "public"
        )
            issues.push(
                issue(
                    path,
                    "unchecked_source",
                    `Source ${sourceKey(entry.source)} was not permission checked.`,
                    403
                )
            );
}

export function validateBusinessRoleContext(
    value: unknown
): ContextValidationResultV0<BusinessRoleContextV0> {
    const issues: ContextValidationIssueV0[] = [];
    validateRoleContextShape(value, "roleContext", issues);
    return issues.length ? invalid(issues) : result(value as BusinessRoleContextV0);
}

export function validateRequiredContextBundle(
    value: unknown,
    options: ContextValidationOptionsV0 = {}
): ContextValidationResultV0<RequiredContextBundleV0> {
    const issues: ContextValidationIssueV0[] = [];
    if (!object(value))
        return invalid([issue("bundle", "invalid_bundle", "Required context bundle is required.")]);
    if (value.contractVersion !== CONTEXT_V0_CONTRACT_VERSION)
        issues.push(
            issue(
                "bundle.contractVersion",
                "wrong_contract_version",
                "Only the proposed context version is accepted."
            )
        );
    if (!isoDate(value.asOf))
        issues.push(issue("bundle.asOf", "invalid_date", "asOf is required."));
    validateScope(value.actor, "bundle.actor", issues, options);
    const actor = object(value.actor) ? value.actor : undefined;
    const companyId = actor?.companyId as string | undefined;
    const entries: ContextSourceEntryV0[] = [];
    if (!object(value.companyArchitecture)) {
        issues.push(
            issue(
                "bundle.companyArchitecture",
                "missing_company_architecture",
                "Canonical Company Architecture is mandatory.",
                403
            )
        );
    } else {
        const source = value.companyArchitecture.source;
        validateSourceEntry(
            value.companyArchitecture,
            "bundle.companyArchitecture",
            issues,
            {
                ...options,
                expectedCompanyId: companyId,
                expectedPrincipalRef: actor?.principalRef as string | undefined,
            },
            value.asOf as string
        );
        validateSourceRef(source, "bundle.companyArchitecture.source", issues, "company");
        if (value.companyArchitecture.canonical !== true)
            issues.push(
                issue(
                    "bundle.companyArchitecture.canonical",
                    "non_canonical_company_architecture",
                    "The Company Architecture ref must be canonical."
                )
            );
        if (
            !object(value.companyArchitecture.source) ||
            !["reviewed", "unknowns-marked", "unreviewed"].includes(
                value.companyArchitecture.source.reviewState as string
            )
        )
            issues.push(
                issue(
                    "bundle.companyArchitecture.source.reviewState",
                    "invalid_company_review_state",
                    "Company Architecture review state is required."
                )
            );
        if (value.companyArchitecture.required !== true)
            issues.push(
                issue(
                    "bundle.companyArchitecture.required",
                    "invalid_required_source",
                    "Mandatory sources must be marked required."
                )
            );
        if (
            !object(value.companyArchitecture.audience) ||
            value.companyArchitecture.audience.kind !== "company"
        )
            issues.push(
                issue(
                    "bundle.companyArchitecture.audience",
                    "invalid_audience",
                    "Company Architecture is company audience."
                )
            );
        if (object(value.companyArchitecture.source))
            entries.push(value.companyArchitecture as unknown as ContextSourceEntryV0);
    }
    for (const [field, expectedAudience] of [
        ["workspaceMandatoryDocuments", "company"],
        ["personalVantageStars", "actor"],
    ] as const) {
        if (!array(value[field])) {
            issues.push(
                issue(`bundle.${field}`, "missing_required_sources", `${field} is mandatory.`, 403)
            );
            continue;
        }
        value[field].forEach((entry, index) => {
            const entryPath = `bundle.${field}[${index}]`;
            validateSourceEntry(
                entry,
                entryPath,
                issues,
                {
                    ...options,
                    expectedCompanyId: companyId,
                    expectedPrincipalRef: actor?.principalRef as string | undefined,
                },
                value.asOf as string
            );
            if (!object(entry) || entry.required !== true)
                issues.push(
                    issue(
                        `${entryPath}.required`,
                        "invalid_required_source",
                        "Mandatory sources must be marked required."
                    )
                );
            if (
                !object(entry) ||
                (object(entry.audience) && entry.audience.kind !== expectedAudience)
            )
                issues.push(
                    issue(
                        `${entryPath}.audience`,
                        "invalid_audience",
                        `${field} has the wrong audience.`
                    )
                );
            if (object(entry) && entry.access === "revoked")
                issues.push(
                    issue(
                        entryPath,
                        "revoked_required_source",
                        "Revoked required context blocks completion.",
                        403
                    )
                );
            if (field === "personalVantageStars") {
                if (!object(entry) || entry.module !== "vantage")
                    issues.push(
                        issue(
                            `${entryPath}.module`,
                            "invalid_star_module",
                            "Personal stars must be scoped to Vantage."
                        )
                    );
                if (
                    object(entry) &&
                    object(entry.audience) &&
                    entry.audience.kind === "actor" &&
                    entry.audience.principalRef !== actor?.principalRef
                )
                    issues.push(
                        issue(
                            `${entryPath}.audience.principalRef`,
                            "principal_mismatch",
                            "Personal stars must belong to the actor.",
                            403
                        )
                    );
            }
            if (object(entry)) entries.push(entry as unknown as RequiredContextSourceV0);
        });
    }
    const coverage = validateCoverage(value.coverage, "bundle.coverage", issues);
    if (!unique(entries.map(entry => sourceKey(entry.source))))
        issues.push(
            issue("bundle", "duplicate_source_ref", "Required source refs must be unique.")
        );
    const allKeys = new Set(entries.map(entry => sourceKey(entry.source)));
    for (const ref of coverage.checked)
        if (!allKeys.has(sourceKey(ref)))
            issues.push(
                issue(
                    "bundle.coverage.checked",
                    "source_version_mismatch",
                    `Checked source ${sourceKey(ref)} is not required by this bundle.`,
                    409
                )
            );
    for (const ref of coverage.used)
        if (!allKeys.has(sourceKey(ref)))
            issues.push(
                issue(
                    "bundle.coverage.used",
                    "source_version_mismatch",
                    `Used source ${sourceKey(ref)} is not required by this bundle.`,
                    409
                )
            );
    const checkedKeys = new Set(coverage.checked.map(sourceKey));
    for (const entry of entries)
        if (!checkedKeys.has(sourceKey(entry.source)))
            issues.push(
                issue(
                    "bundle.coverage.checked",
                    "required_source_unchecked",
                    `Required source ${sourceKey(entry.source)} was not checked.`,
                    403
                )
            );
    if (!strings(value.constraints))
        issues.push(
            issue(
                "bundle.constraints",
                "missing_constraints",
                "Required context constraints must be explicit."
            )
        );
    const blocked =
        coverage.missing.length > 0 ||
        coverage.revoked.length > 0 ||
        entries.some(entry => entry.access === "revoked");
    if (value.status === "complete" && blocked)
        issues.push(
            issue(
                "bundle.status",
                "required_context_incomplete",
                "A complete bundle cannot omit or use revoked required context.",
                403
            )
        );
    if (value.status === "blocked" && !blocked)
        issues.push(
            issue(
                "bundle.status",
                "invalid_status",
                "Blocked status requires missing or revoked required context."
            )
        );
    if (!["complete", "partial", "blocked"].includes(value.status as string))
        issues.push(issue("bundle.status", "invalid_status", "Invalid required-context status."));
    return issues.length ? invalid(issues) : result(value as unknown as RequiredContextBundleV0);
}

export function validateDynamicRetrievalInput(
    value: unknown,
    options: ContextValidationOptionsV0 = {}
): ContextValidationResultV0<DynamicRetrievalInputV0> {
    const issues: ContextValidationIssueV0[] = [];
    if (!object(value))
        return invalid([issue("input", "invalid_input", "Dynamic retrieval input is required.")]);
    if (value.contractVersion !== CONTEXT_V0_CONTRACT_VERSION)
        issues.push(
            issue(
                "input.contractVersion",
                "wrong_contract_version",
                "Only the proposed context version is accepted."
            )
        );
    validateScope(value.actor, "input.actor", issues, options);
    validateRoleContextShape(value.verifiedRoleContext, "input.verifiedRoleContext", issues);
    if (
        object(value.actor) &&
        object(value.verifiedRoleContext) &&
        value.actor.principalRef !== value.verifiedRoleContext.authenticatedPrincipalRef
    )
        issues.push(
            issue(
                "input.verifiedRoleContext.authenticatedPrincipalRef",
                "principal_mismatch",
                "Role context must belong to the actor.",
                403
            )
        );
    if (
        object(value.actor) &&
        options.expectedCompanyId &&
        value.actor.companyId !== options.expectedCompanyId
    )
        issues.push(
            issue(
                "input.actor.companyId",
                "cross_company",
                "Retrieval actor crosses the company boundary.",
                403
            )
        );
    if (!object(value.reportWindow))
        issues.push(issue("input.reportWindow", "invalid_window", "Report window is required."));
    else
        validateDateOrder(
            value.reportWindow.startInclusive,
            value.reportWindow.endExclusive,
            value.reportWindow.asOf,
            "input.reportWindow",
            issues
        );
    validateBudgets(value.budgets, "input.budgets", issues);
    if (!array(value.sourceCatalog))
        issues.push(
            issue(
                "input.sourceCatalog",
                "missing_source_catalog",
                "Authorized source catalog is required."
            )
        );
    else {
        const keys: string[] = [];
        value.sourceCatalog.forEach((entry, index) => {
            validateSourceEntry(
                entry,
                `input.sourceCatalog[${index}]`,
                issues,
                {
                    ...options,
                    expectedCompanyId: object(value.actor)
                        ? (value.actor.companyId as string)
                        : options.expectedCompanyId,
                    expectedPrincipalRef: object(value.actor)
                        ? (value.actor.principalRef as string)
                        : options.expectedPrincipalRef,
                },
                object(value.reportWindow) ? (value.reportWindow.asOf as string) : undefined
            );
            if (object(entry) && object(entry.source))
                keys.push(sourceKey(entry.source as unknown as ContextSourceRefV0));
        });
        if (!unique(keys))
            issues.push(
                issue(
                    "input.sourceCatalog",
                    "duplicate_source_ref",
                    "Source catalog refs must be unique."
                )
            );
    }
    return issues.length ? invalid(issues) : result(value as unknown as DynamicRetrievalInputV0);
}

function validateRetrievalItem(
    value: unknown,
    path: string,
    issues: ContextValidationIssueV0[],
    options: ContextValidationOptionsV0,
    asOf?: string
) {
    validateSourceEntry(value, path, issues, options, asOf);
    if (!object(value)) return;
    if (value.access === "revoked")
        issues.push(
            issue(
                `${path}.access`,
                "revoked_selected_source",
                "A retrieval item cannot select a revoked source.",
                403
            )
        );
    if (!strings(value.roleIds) || !unique(value.roleIds))
        issues.push(
            issue(`${path}.roleIds`, "invalid_role_match", "Matched role IDs must be unique.")
        );
    if (typeof value.rank !== "number" || !Number.isFinite(value.rank) || value.rank < 0)
        issues.push(issue(`${path}.rank`, "invalid_rank", "Rank must be finite and non-negative."));
    if (!nonEmpty(value.selectionReason))
        issues.push(
            issue(
                `${path}.selectionReason`,
                "missing_selection_reason",
                "Selection reason is required."
            )
        );
    if (!nonEmpty(value.dedupKey))
        issues.push(
            issue(`${path}.dedupKey`, "missing_dedup_key", "A deterministic dedup key is required.")
        );
}

export function validateDynamicRetrievalBundle(
    value: unknown,
    input?: DynamicRetrievalInputV0,
    options: ContextValidationOptionsV0 = {}
): ContextValidationResultV0<DynamicRetrievalBundleV0> {
    const issues: ContextValidationIssueV0[] = [];
    if (!object(value))
        return invalid([
            issue("bundle", "invalid_retrieval_bundle", "Dynamic retrieval bundle is required."),
        ]);
    if (value.contractVersion !== CONTEXT_V0_CONTRACT_VERSION)
        issues.push(
            issue(
                "bundle.contractVersion",
                "wrong_contract_version",
                "Only the proposed context version is accepted."
            )
        );
    validateScope(value.actor, "bundle.actor", issues, {
        ...options,
        expectedCompanyId: input?.actor.companyId ?? options.expectedCompanyId,
        expectedPrincipalRef: input?.actor.principalRef ?? options.expectedPrincipalRef,
    });
    if (!object(value.reportWindow))
        issues.push(issue("bundle.reportWindow", "invalid_window", "Report window is required."));
    else
        validateDateOrder(
            value.reportWindow.startInclusive,
            value.reportWindow.endExclusive,
            value.reportWindow.asOf,
            "bundle.reportWindow",
            issues
        );
    const asOf = object(value.reportWindow) ? (value.reportWindow.asOf as string) : undefined;
    const sourceOptions = {
        ...options,
        expectedCompanyId: input?.actor.companyId ?? options.expectedCompanyId,
        expectedPrincipalRef: input?.actor.principalRef ?? options.expectedPrincipalRef,
    };
    if (!array(value.sourceRegistry))
        issues.push(
            issue(
                "bundle.sourceRegistry",
                "missing_source_registry",
                "Authorized source registry is required."
            )
        );
    const registry = array(value.sourceRegistry) ? value.sourceRegistry : [];
    registry.forEach((entry, index) =>
        validateSourceEntry(entry, `bundle.sourceRegistry[${index}]`, issues, sourceOptions, asOf)
    );
    if (registry.some(entry => object(entry) && entry.access === "revoked"))
        issues.push(
            issue(
                "bundle.sourceRegistry",
                "revoked_source_registry",
                "A retrieval registry cannot contain revoked selected sources.",
                403
            )
        );
    const keys = registry
        .filter(object)
        .filter(entry => object(entry.source))
        .map(entry => sourceKey(entry.source as ContextSourceRefV0));
    if (!unique(keys))
        issues.push(
            issue(
                "bundle.sourceRegistry",
                "duplicate_source_ref",
                "Source registry refs must be unique."
            )
        );
    const categories = ["roleMatches", "recentChanges", "unresolvedOlderItems"] as const;
    const seen = new Set<string>();
    for (const category of categories) {
        if (!array(value[category])) {
            issues.push(
                issue(
                    `bundle.${category}`,
                    "invalid_retrieval_items",
                    "Retrieval result category is required."
                )
            );
            continue;
        }
        value[category].forEach((item, index) => {
            validateRetrievalItem(
                item,
                `bundle.${category}[${index}]`,
                issues,
                sourceOptions,
                asOf
            );
            if (object(item) && object(item.source)) {
                const key = sourceKey(item.source as unknown as ContextSourceRefV0);
                if (seen.has(key))
                    issues.push(
                        issue(
                            `bundle.${category}[${index}]`,
                            "duplicate_retrieval_source",
                            "A source may appear in only one retrieval category."
                        )
                    );
                seen.add(key);
                if (!keys.includes(key))
                    issues.push(
                        issue(
                            `bundle.${category}[${index}].source`,
                            "source_version_mismatch",
                            "Retrieved source is absent from registry.",
                            409
                        )
                    );
                if (
                    input &&
                    strings(item.roleIds) &&
                    item.roleIds.some(roleId => !input.verifiedRoleContext.roleIds.includes(roleId))
                )
                    issues.push(
                        issue(
                            `bundle.${category}[${index}].roleIds`,
                            "role_escalation",
                            "Retrieval result names a role outside verified role context.",
                            403
                        )
                    );
            }
        });
    }
    const deduped = validateRefArray(value.deduped, "bundle.deduped", issues);
    if (!array(value.omissions))
        issues.push(issue("bundle.omissions", "invalid_omissions", "Omissions are required."));
    if (!array(value.failures))
        issues.push(issue("bundle.failures", "invalid_failures", "Failure records are required."));
    if (!["complete", "partial", "timeout"].includes(value.status as string))
        issues.push(issue("bundle.status", "invalid_status", "Invalid retrieval status."));
    if (
        value.status === "timeout" &&
        !(array(value.failures) && value.failures.some(f => object(f) && f.code === "timeout"))
    )
        issues.push(
            issue(
                "bundle.status",
                "missing_timeout_failure",
                "Timeout status requires a timeout failure."
            )
        );
    if (deduped.some(ref => !seen.has(sourceKey(ref))))
        issues.push(
            issue(
                "bundle.deduped",
                "invalid_dedup",
                "Deduped refs must identify a returned source."
            )
        );
    if (input) {
        const selectedItems = categories.flatMap(category =>
            array(value[category]) ? value[category].filter(object) : []
        );
        if (selectedItems.length > input.budgets.maxSources)
            issues.push(
                issue(
                    "bundle",
                    "source_budget_exceeded",
                    "Selected retrieval items exceed maxSources.",
                    409
                )
            );
        const excerptChars = selectedItems.reduce(
            (total, item) => total + (typeof item.excerpt === "string" ? item.excerpt.length : 0),
            0
        );
        if (excerptChars > input.budgets.maxExcerptChars)
            issues.push(
                issue(
                    "bundle",
                    "excerpt_budget_exceeded",
                    "Selected retrieval excerpts exceed aggregate maxExcerptChars.",
                    409
                )
            );
        const authorized = new Map(
            input.sourceCatalog.map(entry => [sourceKey(entry.source), entry])
        );
        const checkAuthorized = (entry: Record<string, unknown>, path: string) => {
            const source = object(entry.source)
                ? (entry.source as unknown as ContextSourceRefV0)
                : undefined;
            const allowed = source ? authorized.get(sourceKey(source)) : undefined;
            if (!allowed)
                issues.push(
                    issue(
                        `${path}.source`,
                        "unauthorized_source",
                        "Selected source is absent from the authorized input catalog.",
                        403
                    )
                );
            else if (
                !sameAuthorizedSourceMetadata(entry as unknown as ContextSourceEntryV0, allowed)
            )
                issues.push(
                    issue(
                        path,
                        "source_metadata_mismatch",
                        "Selected source ACL or audience metadata differs from the authorized catalog.",
                        403
                    )
                );
        };
        selectedItems.forEach((item, index) => checkAuthorized(item, `bundle.selected[${index}]`));
        registry
            .filter(object)
            .forEach((entry, index) => checkAuthorized(entry, `bundle.sourceRegistry[${index}]`));
    }
    return issues.length ? invalid(issues) : result(value as unknown as DynamicRetrievalBundleV0);
}

function validateProjection(
    value: unknown,
    path: string,
    issues: ContextValidationIssueV0[],
    options: ContextValidationOptionsV0
) {
    if (
        !object(value) ||
        !nonEmpty(value.projectionId) ||
        !nonEmpty(value.query) ||
        !nonEmpty(value.purpose) ||
        !nonEmpty(value.approvalToken) ||
        !isoDate(value.validatedAt)
    ) {
        issues.push(
            issue(
                path,
                "invalid_public_projection",
                "A server-validated public-safe query projection is required.",
                403
            )
        );
        return;
    }
    if (!/^psqv0_[A-Za-z0-9._-]+$/.test(value.approvalToken))
        issues.push(
            issue(
                `${path}.approvalToken`,
                "untrusted_public_projection",
                "Public query approval must be minted by the server.",
                403
            )
        );
    const trusted = options.trustedPublicProjections?.find(
        candidate =>
            candidate.approvalToken === value.approvalToken &&
            candidate.projectionId === value.projectionId &&
            candidate.query === value.query
    );
    if (!trusted)
        issues.push(
            issue(
                `${path}`,
                "untrusted_public_projection",
                "Public research requires a server-trusted projection/token/content binding.",
                403
            )
        );
}

export function validateContextResearchPlan(
    value: unknown,
    options: ContextValidationOptionsV0 = {}
): ContextValidationResultV0<ContextResearchPlanV0> {
    const issues: ContextValidationIssueV0[] = [];
    if (!object(value))
        return invalid([issue("plan", "invalid_research_plan", "Research plan is required.")]);
    if (value.contractVersion !== CONTEXT_V0_CONTRACT_VERSION)
        issues.push(
            issue(
                "plan.contractVersion",
                "wrong_contract_version",
                "Only the proposed context version is accepted."
            )
        );
    if (!researchModes.has(value.mode as ContextResearchModeV0))
        issues.push(
            issue("plan.mode", "invalid_research_mode", "Mode must be STOP, internal or public.")
        );
    if (!nonEmpty(value.gapPurpose))
        issues.push(
            issue("plan.gapPurpose", "missing_gap_purpose", "Research purpose is required.")
        );
    validateBudgets(value.budgets, "plan.budgets", issues);
    const internal = validateRefArray(value.internalSourceRefs, "plan.internalSourceRefs", issues);
    if (!array(value.publicSafeQueryProjection))
        issues.push(
            issue(
                "plan.publicSafeQueryProjection",
                "invalid_public_projection",
                "Projection array is required."
            )
        );
    const projections = array(value.publicSafeQueryProjection)
        ? value.publicSafeQueryProjection
        : [];
    projections.forEach((projection, index) =>
        validateProjection(projection, `plan.publicSafeQueryProjection[${index}]`, issues, options)
    );
    if (value.mode === "STOP" && (internal.length > 0 || projections.length > 0))
        issues.push(
            issue(
                "plan",
                "stop_plan_has_work",
                "STOP cannot carry internal sources or public queries."
            )
        );
    if (value.mode === "internal" && projections.length > 0)
        issues.push(
            issue(
                "plan.publicSafeQueryProjection",
                "public_query_not_allowed",
                "Internal research cannot carry public query projections.",
                403
            )
        );
    if (value.mode === "public" && projections.length === 0)
        issues.push(
            issue(
                "plan.publicSafeQueryProjection",
                "missing_public_projection",
                "Public research requires an approved query projection.",
                403
            )
        );
    if (
        object(value.budgets) &&
        typeof value.budgets.maxQueries === "number" &&
        projections.length > value.budgets.maxQueries
    )
        issues.push(
            issue(
                "plan.publicSafeQueryProjection",
                "query_budget_exceeded",
                "Research projections exceed maxQueries.",
                409
            )
        );
    return issues.length ? invalid(issues) : result(value as unknown as ContextResearchPlanV0);
}

export function validateContextResearchResult(
    value: unknown,
    plan?: ContextResearchPlanV0,
    options: ContextValidationOptionsV0 = {}
): ContextValidationResultV0<ContextResearchResultV0> {
    const issues: ContextValidationIssueV0[] = [];
    if (!object(value))
        return invalid([
            issue("result", "invalid_research_result", "Research result is required."),
        ]);
    if (value.contractVersion !== CONTEXT_V0_CONTRACT_VERSION)
        issues.push(
            issue(
                "result.contractVersion",
                "wrong_contract_version",
                "Only the proposed context version is accepted."
            )
        );
    if (!researchModes.has(value.mode as ContextResearchModeV0))
        issues.push(
            issue("result.mode", "invalid_research_mode", "Mode must be STOP, internal or public.")
        );
    if (!nonEmpty(value.gapPurpose))
        issues.push(
            issue("result.gapPurpose", "missing_gap_purpose", "Research purpose is required.")
        );
    if (!isoDate(value.asOf))
        issues.push(issue("result.asOf", "invalid_date", "Research asOf is required."));
    validateRefArray(value.internalSourceRefs, "result.internalSourceRefs", issues);
    if (!array(value.publicSafeQueryProjection))
        issues.push(
            issue(
                "result.publicSafeQueryProjection",
                "invalid_public_projection",
                "Projection array is required."
            )
        );
    const projections = array(value.publicSafeQueryProjection)
        ? value.publicSafeQueryProjection
        : [];
    projections.forEach((projection, index) =>
        validateProjection(
            projection,
            `result.publicSafeQueryProjection[${index}]`,
            issues,
            options
        )
    );
    if (!array(value.citations))
        issues.push(issue("result.citations", "invalid_citations", "Citations are required."));
    else
        value.citations.forEach((citation, index) => {
            if (!object(citation)) {
                issues.push(
                    issue(`result.citations[${index}]`, "invalid_citation", "Citation is required.")
                );
                return;
            }
            validateSourceRef(
                citation.source,
                `result.citations[${index}].source`,
                issues,
                "public"
            );
            if (
                !nonEmpty(citation.title) ||
                !nonEmpty(citation.url) ||
                !isoDate(citation.sourceDate) ||
                !isoDate(citation.accessedAt) ||
                !nonEmpty(citation.provenance)
            )
                issues.push(
                    issue(
                        `result.citations[${index}]`,
                        "invalid_citation",
                        "Public citations require URL, dates and provenance."
                    )
                );
            if (
                isoDate(citation.sourceDate) &&
                isoDate(value.asOf) &&
                Date.parse(citation.sourceDate) > Date.parse(value.asOf)
            )
                issues.push(
                    issue(
                        `result.citations[${index}].sourceDate`,
                        "outside_as_of",
                        "Public source is later than asOf.",
                        409
                    )
                );
        });
    if (plan) {
        if (plan.mode !== value.mode)
            issues.push(
                issue("result.mode", "research_mode_mismatch", "Result mode must match its plan.")
            );
        if (plan.mode === "STOP" && projections.length > 0)
            issues.push(
                issue(
                    "result.publicSafeQueryProjection",
                    "stop_plan_has_work",
                    "STOP results cannot carry public query projections."
                )
            );
        if (plan.mode === "internal" && projections.length > 0)
            issues.push(
                issue(
                    "result.publicSafeQueryProjection",
                    "public_query_not_allowed",
                    "Internal results cannot carry public query projections.",
                    403
                )
            );
        if (
            object(plan.budgets) &&
            typeof plan.budgets.maxQueries === "number" &&
            projections.length > plan.budgets.maxQueries
        )
            issues.push(
                issue(
                    "result.publicSafeQueryProjection",
                    "query_budget_exceeded",
                    "Research result projections exceed the plan maxQueries budget.",
                    409
                )
            );
        if (plan.mode === "public" && projections.length === 0)
            issues.push(
                issue(
                    "result.publicSafeQueryProjection",
                    "missing_public_projection",
                    "Public result must retain its approved projection.",
                    403
                )
            );
    }
    if (!["complete", "partial", "stopped", "failed"].includes(value.status as string))
        issues.push(issue("result.status", "invalid_status", "Invalid research status."));
    return issues.length ? invalid(issues) : result(value as unknown as ContextResearchResultV0);
}

export function validateContextManifest(
    value: unknown,
    options: ContextValidationOptionsV0 = {}
): ContextValidationResultV0<ContextManifestV0> {
    const issues: ContextValidationIssueV0[] = [];
    if (!object(value))
        return invalid([issue("manifest", "invalid_manifest", "Context manifest is required.")]);
    if (value.contractVersion !== CONTEXT_V0_CONTRACT_VERSION)
        issues.push(
            issue(
                "manifest.contractVersion",
                "wrong_contract_version",
                "Only the proposed context version is accepted."
            )
        );
    for (const field of [
        "runId",
        "inputVersion",
        "contextFingerprint",
        "roleMapVersion",
        "companyArchitectureVersion",
    ])
        if (!nonEmpty(value[field]))
            issues.push(
                issue(`manifest.${field}`, "missing_manifest_field", `${field} is required.`)
            );
    validateScope(value.actor, "manifest.actor", issues, options);
    if (!object(value.reportWindow))
        issues.push(issue("manifest.reportWindow", "invalid_window", "Report window is required."));
    else
        validateDateOrder(
            value.reportWindow.startInclusive,
            value.reportWindow.endExclusive,
            value.reportWindow.asOf,
            "manifest.reportWindow",
            issues
        );
    if (!strings(value.roleIds) || !unique(value.roleIds))
        issues.push(
            issue("manifest.roleIds", "invalid_role_ids", "Manifest role IDs must be unique.")
        );
    for (const mapField of ["roleProfileVersions", "personalStarVersions", "sourceVersions"])
        if (
            !object(value[mapField]) ||
            Object.entries(value[mapField]).some(([k, v]) => !nonEmpty(k) || !nonEmpty(v))
        )
            issues.push(
                issue(
                    `manifest.${mapField}`,
                    "invalid_versions",
                    "Version maps must contain exact non-empty versions."
                )
            );
    if (!array(value.sourceRegistry))
        issues.push(
            issue(
                "manifest.sourceRegistry",
                "missing_source_registry",
                "Manifest source registry is required."
            )
        );
    const registry = array(value.sourceRegistry) ? value.sourceRegistry : [];
    const sourceOptions = {
        ...options,
        expectedPrincipalRef: object(value.actor)
            ? (value.actor.principalRef as string)
            : options.expectedPrincipalRef,
    };
    registry.forEach((entry, index) =>
        validateSourceEntry(
            entry,
            `manifest.sourceRegistry[${index}]`,
            issues,
            sourceOptions,
            object(value.reportWindow) ? (value.reportWindow.asOf as string) : undefined
        )
    );
    const registryKeys = registry
        .filter(object)
        .filter(entry => object(entry.source))
        .map(entry => sourceKey(entry.source as ContextSourceRefV0));
    if (!unique(registryKeys))
        issues.push(
            issue(
                "manifest.sourceRegistry",
                "duplicate_source_ref",
                "Manifest registry refs must be unique."
            )
        );
    const coverage = validateCoverage(value.coverage, "manifest.coverage", issues);
    validateCoverageAgainstRegistry(
        coverage,
        registry as ContextSourceEntryV0[],
        "manifest.coverage",
        issues
    );
    if (!array(value.omissions))
        issues.push(
            issue("manifest.omissions", "invalid_omissions", "Manifest omissions are required.")
        );
    if (
        !object(value.research) ||
        !researchModes.has(value.research?.mode as ContextResearchModeV0) ||
        !["complete", "partial", "stopped", "failed"].includes(value.research?.status as string)
    )
        issues.push(
            issue(
                "manifest.research",
                "invalid_research_state",
                "Manifest research state is required."
            )
        );
    const citationRefs =
        object(value.research) && array(value.research.citationRefs)
            ? validateRefArray(
                  value.research.citationRefs,
                  "manifest.research.citationRefs",
                  issues
              )
            : [];
    const registryRefKeys = new Set(registryKeys);
    citationRefs.forEach((ref, index) => {
        if (ref.kind !== "public")
            issues.push(
                issue(
                    `manifest.research.citationRefs[${index}].kind`,
                    "invalid_citation_source",
                    "Research citations must use public source refs.",
                    403
                )
            );
        if (!registryRefKeys.has(sourceKey(ref)))
            issues.push(
                issue(
                    `manifest.research.citationRefs[${index}]`,
                    "citation_source_unregistered",
                    "Research citation must match an exact source registry ref and version.",
                    409
                )
            );
    });
    const blocked =
        coverage.missing.length > 0 ||
        coverage.revoked.length > 0 ||
        registry.some(entry => object(entry) && entry.access === "revoked");
    if (value.status === "complete" && blocked)
        issues.push(
            issue(
                "manifest.status",
                "required_context_incomplete",
                "A complete manifest cannot use missing or revoked sources.",
                403
            )
        );
    if (value.status === "blocked" && !blocked)
        issues.push(
            issue(
                "manifest.status",
                "invalid_status",
                "Blocked manifest requires missing or revoked sources."
            )
        );
    if (!["complete", "partial", "blocked"].includes(value.status as string))
        issues.push(issue("manifest.status", "invalid_status", "Invalid manifest status."));
    if (object(value.sourceVersions)) {
        for (const entry of registry) {
            if (!object(entry)) continue;
            if (!object(entry.source)) continue;
            const key = sourceKey(entry.source as unknown as ContextSourceRefV0);
            if (
                value.sourceVersions[key] !==
                (entry.source as unknown as ContextSourceRefV0).version
            )
                issues.push(
                    issue(
                        `manifest.sourceVersions.${key}`,
                        "source_version_mismatch",
                        "Manifest source version does not match registry.",
                        409
                    )
                );
        }
    }
    return issues.length ? invalid(issues) : result(value as unknown as ContextManifestV0);
}

/** Stable, deterministic helper for adapters that need to remove duplicate refs before handoff. */
export function dedupeContextSourceRefs(refs: readonly ContextSourceRefV0[]): ContextSourceRefV0[] {
    const seen = new Set<string>();
    return refs.filter(ref => {
        const key = sourceKey(ref);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** A validation-only consumer proving the manifest seam without implementing generation. */
export function createContextManifestConsumerStub(
    options: ContextValidationOptionsV0 = {}
): ContextManifestConsumerV0 {
    return {
        consume(manifest: unknown): ContextManifestConsumerResultV0 {
            const bindingIssues: ContextValidationIssueV0[] = [];
            if (!nonEmpty(options.expectedCompanyId))
                bindingIssues.push(
                    issue(
                        "consumer.expectedCompanyId",
                        "missing_server_binding",
                        "A manifest consumer requires a server-resolved company binding.",
                        403
                    )
                );
            if (!nonEmpty(options.expectedPrincipalRef))
                bindingIssues.push(
                    issue(
                        "consumer.expectedPrincipalRef",
                        "missing_server_binding",
                        "A manifest consumer requires a server-resolved principal binding.",
                        403
                    )
                );
            if (!nonEmpty(options.expectedAclDigest))
                bindingIssues.push(
                    issue(
                        "consumer.expectedAclDigest",
                        "missing_server_binding",
                        "A manifest consumer requires a server-resolved ACL digest binding.",
                        403
                    )
                );
            if (bindingIssues.length)
                return { accepted: false, registeredSourceRefs: [], issues: bindingIssues };
            const checked = validateContextManifest(manifest, options);
            if (!checked.ok || !checked.value)
                return { accepted: false, registeredSourceRefs: [], issues: checked.issues };
            return {
                accepted: true,
                registeredSourceRefs: checked.value.sourceRegistry.map(entry => entry.source),
                issues: [],
            };
        },
    };
}

export { sourceKey as contextSourceKeyV0 };
