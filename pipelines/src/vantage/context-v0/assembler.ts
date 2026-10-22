import { createHash } from "node:crypto";
import {
    contextSourceKeyV0,
    validateBusinessRoleContext,
    validateContextManifest,
    validateContextResearchPlan,
    validateContextResearchResult,
    validateDynamicRetrievalBundle,
    validateDynamicRetrievalInput,
    validateRequiredContextBundle,
    type ContextFailureV0,
    type ContextManifestCoverageV0,
    type ContextOmissionV0,
    type ContextResearchStateV0,
    type ContextSourceEntryV0,
    type ContextSourceRefV0,
    type DynamicRetrievalBundleV0,
} from "../proposals/context-v0";
import { createEvidenceSnapshotV0 } from "./evidence-snapshot";
import { createSourceRegistryV0 } from "./registry";
import type {
    AssembleContextManifestInputV0,
    AssembleContextManifestResultV0,
    AssembledContextManifestV0,
    ContextAssemblyIssueV0,
    ContextFreezeV0,
    ContextRetrievalStateV0,
    ContextVersionHashV0,
    SourceRegistryV0,
} from "./contracts";

function stable(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
        .join(",")}}`;
}

function hash(value: unknown): string {
    return createHash("sha256").update(stable(value), "utf8").digest("hex");
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

function key(ref: ContextSourceRefV0): string {
    return contextSourceKeyV0(ref);
}

function sortedRefs(refs: Iterable<ContextSourceRefV0>): ContextSourceRefV0[] {
    return [...new Map([...refs].map(ref => [key(ref), ref])).values()].sort((a, b) =>
        key(a).localeCompare(key(b))
    );
}

function sortedStrings(values: Iterable<string>): string[] {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function canonicalFailures(failures: readonly ContextFailureV0[]): ContextFailureV0[] {
    const unique = new Map<string, ContextFailureV0>();
    for (const failure of failures) {
        const identity = stable(failure);
        if (!unique.has(identity)) unique.set(identity, failure);
    }
    return [...unique.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, failure]) => failure);
}

function canonicalOmissions(omissions: readonly ContextOmissionV0[]): ContextOmissionV0[] {
    const unique = new Map<string, ContextOmissionV0>();
    for (const omission of omissions) {
        const identity = stable(omission);
        if (!unique.has(identity)) unique.set(identity, omission);
    }
    return [...unique.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, omission]) => omission);
}

function assemblyIssue(
    path: string,
    code: string,
    message: string,
    status: ContextAssemblyIssueV0["status"] = 400
): ContextAssemblyIssueV0 {
    return { path, code, message, status };
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): value is string {
    return typeof value === "string";
}

function sourceRefShape(value: unknown): value is ContextSourceRefV0 {
    return (
        record(value) &&
        stringValue(value.kind) &&
        stringValue(value.id) &&
        stringValue(value.version)
    );
}

function audienceShape(value: unknown): boolean {
    if (!record(value) || !stringValue(value.kind)) return false;
    if (value.kind === "actor") return stringValue(value.principalRef);
    if (value.kind === "company") return stringValue(value.companyId);
    return value.kind === "public";
}

function sourceEntryShape(value: unknown): boolean {
    return (
        record(value) &&
        sourceRefShape(value.source) &&
        stringValue(value.companyId) &&
        (value.access === "allowed" || value.access === "revoked") &&
        stringValue(value.aclDigest) &&
        audienceShape(value.audience) &&
        stringValue(value.sourceDate) &&
        stringValue(value.checkedAt) &&
        stringValue(value.excerpt)
    );
}

function omissionShape(value: unknown): boolean {
    return (
        record(value) &&
        (value.source === undefined || sourceRefShape(value.source)) &&
        ["budget", "duplicate", "out-of-scope", "revoked", "timeout", "invalid"].includes(
            value.reason as string
        )
    );
}

function failureShape(value: unknown): boolean {
    return (
        record(value) &&
        stringValue(value.code) &&
        stringValue(value.message) &&
        (value.source === undefined || sourceRefShape(value.source))
    );
}

function reportWindowShape(value: unknown): boolean {
    return (
        record(value) &&
        stringValue(value.startInclusive) &&
        stringValue(value.endExclusive) &&
        stringValue(value.asOf)
    );
}

function actorShape(value: unknown): boolean {
    return (
        record(value) &&
        stringValue(value.principalRef) &&
        stringValue(value.companyId) &&
        stringValue(value.aclDigest) &&
        audienceShape(value.audience)
    );
}

function budgetsShape(value: unknown): boolean {
    return (
        record(value) &&
        ["maxSources", "maxExcerptChars", "timeoutMs", "maxQueries", "maxTokens"].every(
            field => typeof value[field] === "number"
        )
    );
}

function sourceArrayShape(value: unknown): boolean {
    return Array.isArray(value) && value.every(sourceRefShape);
}

function sourceEntryArrayShape(value: unknown): boolean {
    return Array.isArray(value) && value.every(sourceEntryShape);
}

/**
 * Validators intentionally report semantic issues, but malformed handoffs
 * must be rejected before any assembler code dereferences their nested data.
 */
function structuralIssuesV0(value: unknown): ContextAssemblyIssueV0[] {
    const issues: ContextAssemblyIssueV0[] = [];
    const malformed = (path: string, message: string) =>
        issues.push(assemblyIssue(path, "malformed_handoff", message));
    if (!record(value)) {
        malformed("input", "Assembly input must be an object.");
        return issues;
    }
    if (!stringValue(value.runId)) malformed("runId", "runId must be a string.");
    if (!actorShape(value.actor)) malformed("actor", "Authenticated actor scope is malformed.");
    if (!reportWindowShape(value.reportWindow))
        malformed("reportWindow", "Report window is malformed.");
    if (!record(value.roleContext)) malformed("roleContext", "Role context must be an object.");
    else {
        if (!Array.isArray(value.roleContext.roleIds))
            malformed("roleContext.roleIds", "Role IDs must be an array.");
        if (!Array.isArray(value.roleContext.roles))
            malformed("roleContext.roles", "Role descriptions must be an array.");
        if (!stringValue(value.roleContext.authenticatedPrincipalRef))
            malformed(
                "roleContext.authenticatedPrincipalRef",
                "Authenticated principal must be a string."
            );
        if (!stringValue(value.roleContext.mappingVersion))
            malformed("roleContext.mappingVersion", "Role mapping version must be a string.");
    }
    if (!record(value.roleProfileVersions) || Array.isArray(value.roleProfileVersions))
        malformed("roleProfileVersions", "Role profile versions must be an object.");
    if (!record(value.required)) malformed("required", "Required context must be an object.");
    else {
        const required = value.required;
        if (!stringValue(required.asOf))
            malformed("required.asOf", "Required asOf must be a string.");
        if (!sourceEntryShape(required.companyArchitecture))
            malformed("required.companyArchitecture", "Company architecture source is malformed.");
        if (!sourceEntryArrayShape(required.workspaceMandatoryDocuments))
            malformed(
                "required.workspaceMandatoryDocuments",
                "Mandatory document sources must be an array of source entries."
            );
        if (!sourceEntryArrayShape(required.personalVantageStars))
            malformed(
                "required.personalVantageStars",
                "Personal star sources must be an array of source entries."
            );
        if (!record(required.coverage))
            malformed("required.coverage", "Coverage must be an object.");
        else {
            for (const field of ["checked", "used", "missing", "revoked", "omitted"])
                if (!sourceArrayShape(required.coverage[field]))
                    malformed(`required.coverage.${field}`, "Coverage refs must be arrays.");
        }
    }
    if (!record(value.retrievalInput))
        malformed("retrievalInput", "Retrieval input must be an object.");
    else {
        const retrievalInput = value.retrievalInput;
        if (!actorShape(retrievalInput.actor))
            malformed("retrievalInput.actor", "Retrieval actor is malformed.");
        if (!reportWindowShape(retrievalInput.reportWindow))
            malformed("retrievalInput.reportWindow", "Retrieval report window is malformed.");
        if (!sourceEntryArrayShape(retrievalInput.sourceCatalog))
            malformed("retrievalInput.sourceCatalog", "Retrieval source catalog is malformed.");
        if (!budgetsShape(retrievalInput.budgets))
            malformed("retrievalInput.budgets", "Retrieval budgets are malformed.");
        if (!record(retrievalInput.verifiedRoleContext))
            malformed("retrievalInput.verifiedRoleContext", "Verified role context is malformed.");
    }
    if (!record(value.budgets) || !budgetsShape(value.budgets))
        malformed("budgets", "Assembly budgets are malformed.");
    if (!record(value.registry)) malformed("registry", "Source registry must be an object.");
    else {
        if (!record(value.registry.scope))
            malformed("registry.scope", "Registry scope is malformed.");
        else {
            if (!actorShape(value.registry.scope.actor))
                malformed("registry.scope.actor", "Registry actor scope is malformed.");
            if (!reportWindowShape(value.registry.scope.reportWindow))
                malformed("registry.scope.reportWindow", "Registry report window is malformed.");
        }
        if (typeof value.registry.resolve !== "function")
            malformed("registry.resolve", "Registry resolver is required.");
        if (typeof value.registry.get !== "function")
            malformed("registry.get", "Registry lookup is required.");
    }
    const retrieval = value.retrieval;
    if (retrieval !== undefined) {
        if (!record(retrieval)) malformed("retrieval", "Retrieval bundle must be an object.");
        else {
            for (const lane of [
                "roleMatches",
                "recentChanges",
                "unresolvedOlderItems",
                "sourceRegistry",
            ]) {
                const entries = retrieval[lane];
                if (!Array.isArray(entries))
                    malformed(`retrieval.${lane}`, "Retrieval entries must be arrays.");
                else if (lane !== "sourceRegistry") {
                    entries.forEach((entry, index) => {
                        if (!sourceEntryShape(entry))
                            malformed(
                                `retrieval.${lane}[${index}]`,
                                "Retrieval source entry is malformed."
                            );
                        else if (!Array.isArray((entry as Record<string, unknown>).roleIds))
                            malformed(
                                `retrieval.${lane}[${index}].roleIds`,
                                "Retrieval roles must be an array."
                            );
                    });
                } else if (!entries.every(sourceEntryShape))
                    malformed(
                        "retrieval.sourceRegistry",
                        "Retrieval source registry entries are malformed."
                    );
            }
            if (!sourceArrayShape(retrieval.deduped))
                malformed("retrieval.deduped", "Deduped refs must be an array.");
            if (!Array.isArray(retrieval.omissions) || !retrieval.omissions.every(omissionShape))
                malformed("retrieval.omissions", "Retrieval omissions are malformed.");
            if (!Array.isArray(retrieval.failures) || !retrieval.failures.every(failureShape))
                malformed("retrieval.failures", "Retrieval failures are malformed.");
        }
    }
    const researchPlan = value.researchPlan;
    if (researchPlan !== undefined) {
        if (!record(researchPlan)) malformed("researchPlan", "Research plan must be an object.");
        else {
            if (!sourceArrayShape(researchPlan.internalSourceRefs))
                malformed("researchPlan.internalSourceRefs", "Research refs must be an array.");
            if (!Array.isArray(researchPlan.publicSafeQueryProjection))
                malformed(
                    "researchPlan.publicSafeQueryProjection",
                    "Research projections must be an array."
                );
            if (!budgetsShape(researchPlan.budgets))
                malformed("researchPlan.budgets", "Research budgets are malformed.");
        }
    }
    const researchResult = value.researchResult;
    if (researchResult !== undefined) {
        if (!record(researchResult))
            malformed("researchResult", "Research result must be an object.");
        else {
            if (!Array.isArray(researchResult.citations))
                malformed("researchResult.citations", "Research citations must be an array.");
            else
                researchResult.citations.forEach((citation, index) => {
                    if (!record(citation) || !sourceRefShape(citation.source))
                        malformed(
                            `researchResult.citations[${index}]`,
                            "Research citation is malformed."
                        );
                });
            if (!sourceArrayShape(researchResult.internalSourceRefs))
                malformed("researchResult.internalSourceRefs", "Research refs must be an array.");
            if (!Array.isArray(researchResult.publicSafeQueryProjection))
                malformed(
                    "researchResult.publicSafeQueryProjection",
                    "Research projections must be an array."
                );
            if (
                !Array.isArray(researchResult.failures) ||
                !researchResult.failures.every(failureShape)
            )
                malformed("researchResult.failures", "Research failures are malformed.");
        }
    }
    if (
        value.trustedPublicProjections !== undefined &&
        !Array.isArray(value.trustedPublicProjections)
    )
        malformed("trustedPublicProjections", "Trusted projections must be an array.");
    return issues;
}

function validatorIssues(
    issues: readonly { path: string; code: string; message: string; status?: number }[],
    output: ContextAssemblyIssueV0[],
    options: { ignoreDuplicateRetrieval?: boolean } = {}
) {
    for (const item of issues) {
        if (options.ignoreDuplicateRetrieval && item.code === "duplicate_retrieval_source")
            continue;
        const status = item.status;
        output.push({
            path: item.path,
            code: item.code,
            message: item.message,
            status:
                status === 403 || status === 404 || status === 409 || status === 503 ? status : 400,
        });
    }
}

function sameActorScope(
    a: AssembleContextManifestInputV0["actor"],
    b: AssembleContextManifestInputV0["actor"]
): boolean {
    return (
        a.principalRef === b.principalRef &&
        a.companyId === b.companyId &&
        a.aclDigest === b.aclDigest &&
        a.audience.kind === b.audience.kind &&
        a.audience.principalRef === b.audience.principalRef
    );
}

function sameReportWindow(
    a: AssembleContextManifestInputV0["reportWindow"],
    b: AssembleContextManifestInputV0["reportWindow"]
): boolean {
    return (
        a.startInclusive === b.startInclusive &&
        a.endExclusive === b.endExclusive &&
        a.asOf === b.asOf
    );
}

function normalizeRetrieval(value: DynamicRetrievalBundleV0): DynamicRetrievalBundleV0 {
    const seen = new Set<string>();
    const dedupe = <T extends ContextSourceEntryV0>(items: readonly T[], seenRefs = seen): T[] => {
        const result: T[] = [];
        for (const item of items) {
            if (seenRefs.has(key(item.source))) continue;
            seenRefs.add(key(item.source));
            result.push(item);
        }
        return result;
    };
    const refs = [...new Map(value.deduped.map(ref => [key(ref), ref])).values()];
    const sourceRegistrySeen = new Set<string>();
    return {
        ...value,
        roleMatches: dedupe(value.roleMatches),
        recentChanges: dedupe(value.recentChanges),
        unresolvedOlderItems: dedupe(value.unresolvedOlderItems),
        sourceRegistry: dedupe(value.sourceRegistry, sourceRegistrySeen),
        deduped: refs,
    };
}

function canonicalRetrievalItems(retrieval: DynamicRetrievalBundleV0) {
    return [
        ["roleMatches", retrieval.roleMatches] as const,
        ["recentChanges", retrieval.recentChanges] as const,
        ["unresolvedOlderItems", retrieval.unresolvedOlderItems] as const,
    ];
}

function citationMatches(
    citation: {
        title: string;
        url: string;
        sourceDate: string;
        accessedAt: string;
        provenance: string;
    },
    canonical: NonNullable<ReturnType<SourceRegistryV0["get"]>>["citation"]
): boolean {
    return Boolean(
        canonical &&
            citation.title === canonical.title &&
            citation.url === canonical.url &&
            citation.sourceDate === canonical.sourceDate &&
            citation.accessedAt === canonical.accessedAt &&
            citation.provenance === canonical.provenance
    );
}

function contextVersionHashes(
    refs: readonly ContextSourceRefV0[],
    registry: SourceRegistryV0
): ContextVersionHashV0[] {
    return sortedRefs(refs).flatMap(ref => {
        const source = registry.get(ref);
        return source
            ? [
                  {
                      ref: source.source,
                      contentHash: source.contentHash,
                      aclDigest: source.aclDigest,
                      audience: source.audience,
                      access: source.access,
                  },
              ]
            : [];
    });
}

function buildFreeze(
    input: AssembleContextManifestInputV0,
    selectedRefs: readonly ContextSourceRefV0[],
    registry: SourceRegistryV0,
    companyArchitecture: ContextSourceRefV0,
    personalStars: readonly ContextSourceRefV0[]
): ContextFreezeV0 {
    const sources = contextVersionHashes(selectedRefs, registry);
    const freezeValue = {
        contractVersion: "v0-assembly-1" as const,
        actorACL: clone(input.actor),
        roleMapVersion: input.roleContext.mappingVersion,
        roleProfileVersions: Object.fromEntries(
            Object.entries(input.roleProfileVersions).sort(([a], [b]) => a.localeCompare(b))
        ),
        companyArchitecture: contextVersionHashes([companyArchitecture], registry)[0]!,
        personalStars: contextVersionHashes(personalStars, registry),
        sources,
    };
    return freeze({ ...freezeValue, contentFingerprint: hash(freezeValue) });
}

/** Assemble an immutable, permission-checked ContextManifest and evidence snapshot. */
export function assembleContextManifestV0(
    input: AssembleContextManifestInputV0
): AssembleContextManifestResultV0 {
    const structuralIssues = structuralIssuesV0(input as unknown);
    if (structuralIssues.length) return { ok: false, status: "blocked", issues: structuralIssues };
    const issues: ContextAssemblyIssueV0[] = [];
    const validationOptions = {
        expectedCompanyId: input.actor.companyId,
        expectedPrincipalRef: input.actor.principalRef,
        expectedAclDigest: input.actor.aclDigest,
        trustedPublicProjections: input.trustedPublicProjections,
    };
    validatorIssues(validateBusinessRoleContext(input.roleContext).issues, issues);
    validatorIssues(
        validateRequiredContextBundle(input.required, validationOptions).issues,
        issues
    );
    validatorIssues(
        validateDynamicRetrievalInput(input.retrievalInput, validationOptions).issues,
        issues
    );
    if (!sameActorScope(input.actor, input.registry.scope.actor))
        issues.push(
            assemblyIssue(
                "registry.scope",
                "registry_scope_mismatch",
                "Registry scope does not match the authenticated actor, ACL or audience.",
                403
            )
        );
    if (!sameReportWindow(input.reportWindow, input.registry.scope.reportWindow))
        issues.push(
            assemblyIssue(
                "registry.scope.reportWindow",
                "registry_scope_mismatch",
                "Registry report window does not match the requested window.",
                409
            )
        );
    if (input.required.asOf !== input.reportWindow.asOf)
        issues.push(
            assemblyIssue(
                "required.asOf",
                "required_as_of_mismatch",
                "Required context must be resolved for the requested report asOf.",
                409
            )
        );
    if (input.required.status !== "complete")
        issues.push(
            assemblyIssue(
                "required.status",
                "required_context_incomplete",
                "Required context did not complete.",
                403
            )
        );
    if (input.roleContext.authenticatedPrincipalRef !== input.actor.principalRef)
        issues.push(
            assemblyIssue(
                "roleContext.authenticatedPrincipalRef",
                "principal_mismatch",
                "Role context belongs to another actor.",
                403
            )
        );
    for (const roleId of input.roleContext.roleIds) {
        if (!input.roleProfileVersions[roleId])
            issues.push(
                assemblyIssue(
                    `roleProfileVersions.${roleId}`,
                    "missing_role_profile_version",
                    `A profile version is required for role ${roleId}.`,
                    409
                )
            );
    }

    const selected = new Map<string, ContextSourceRefV0>();
    const selectedLogical = new Map<string, string>();
    const missing: ContextSourceRefV0[] = [];
    const revoked: ContextSourceRefV0[] = [];
    const checked = new Map<string, ContextSourceRefV0>();
    const omitted = new Map<string, ContextOmissionV0>();
    const addSelected = (ref: ContextSourceRefV0, path: string) => {
        const logical = `${ref.kind}:${ref.id}`;
        const priorVersion = selectedLogical.get(logical);
        if (priorVersion && priorVersion !== ref.version) {
            issues.push(
                assemblyIssue(
                    path,
                    "source_version_conflict",
                    `Selected source ${logical} has conflicting versions.`,
                    409
                )
            );
            missing.push(ref);
            return false;
        }
        selectedLogical.set(logical, ref.version);
        selected.set(key(ref), ref);
        checked.set(key(ref), ref);
        return true;
    };

    const requiredCoverageChecked = new Set(input.required.coverage?.checked?.map(key) ?? []);
    const requiredEntries: ContextSourceEntryV0[] = [
        input.required.companyArchitecture,
        ...input.required.workspaceMandatoryDocuments,
        ...input.required.personalVantageStars,
    ];
    const requiredEntryKeys = new Set(
        requiredEntries.filter(Boolean).map(entry => key(entry.source))
    );
    for (const ref of input.required.coverage.checked.concat(
        input.required.coverage.missing,
        input.required.coverage.revoked,
        input.required.coverage.omitted
    )) {
        if (!requiredEntryKeys.has(key(ref))) {
            issues.push(
                assemblyIssue(
                    "required",
                    "missing_required_source",
                    `Required source ${key(ref)} was not returned by the required-context provider.`,
                    403
                )
            );
            missing.push(ref);
        }
    }
    const companyArchitectureRef = input.required.companyArchitecture?.source;
    const personalStarRefs = input.required.personalVantageStars.map(entry => entry.source);
    for (const [index, entry] of requiredEntries.entries()) {
        if (!entry?.source) {
            issues.push(
                assemblyIssue(
                    `required[${index}]`,
                    "missing_required_source",
                    "Required source is missing.",
                    403
                )
            );
            continue;
        }
        const resolved = input.registry.resolve(entry);
        if (!resolved.ok) {
            validatorIssues(resolved.issues, issues);
            if (input.registry.get(entry.source)?.access === "revoked") revoked.push(entry.source);
            else missing.push(entry.source);
            continue;
        }
        if (!requiredCoverageChecked.has(key(entry.source))) {
            issues.push(
                assemblyIssue(
                    `required.coverage.checked`,
                    "unchecked_required_source",
                    `Required source ${key(entry.source)} was not checked.`,
                    403
                )
            );
            missing.push(entry.source);
        }
        addSelected(resolved.source.source, `required[${index}]`);
    }
    for (const ref of input.required.coverage?.omitted ?? []) {
        issues.push(
            assemblyIssue(
                "required.coverage.omitted",
                "omitted_required_source",
                `Required source ${key(ref)} was explicitly omitted.`,
                403
            )
        );
        if (!missing.some(existing => key(existing) === key(ref))) missing.push(ref);
        omitted.set(key(ref), { source: ref, reason: "invalid" });
    }

    const laneProvenance = new Map<
        string,
        {
            lanes: Set<"roleMatches" | "recentChanges" | "unresolvedOlderItems">;
            reasons: Set<string>;
            ref: ContextSourceRefV0;
        }
    >();
    let retrievalState: ContextRetrievalStateV0;
    if (!input.retrieval) {
        retrievalState = {
            status: "not-run",
            selectedRefs: [],
            omissions: [],
            failures: [],
            laneProvenance: [],
        };
    } else {
        const normalized = normalizeRetrieval(input.retrieval);
        validatorIssues(
            validateDynamicRetrievalBundle(normalized, input.retrievalInput, validationOptions)
                .issues,
            issues,
            {
                ignoreDuplicateRetrieval: true,
            }
        );
        for (const [lane, items] of canonicalRetrievalItems(input.retrieval)) {
            for (const [index, item] of items.entries()) {
                const logical = `${item.source.kind}:${item.source.id}`;
                const priorVersion = selectedLogical.get(logical);
                if (priorVersion && priorVersion !== item.source.version) {
                    issues.push(
                        assemblyIssue(
                            `retrieval.${lane}[${index}]`,
                            "source_version_conflict",
                            `Selected source ${logical} has conflicting versions.`,
                            409
                        )
                    );
                    missing.push(item.source);
                    continue;
                }
                const resolved = input.registry.resolve(item);
                if (!resolved.ok) {
                    validatorIssues(resolved.issues, issues);
                    if (input.registry.get(item.source)?.access === "revoked")
                        revoked.push(item.source);
                    else omitted.set(key(item.source), { source: item.source, reason: "invalid" });
                    continue;
                }
                if (!item.roleIds.every(roleId => input.roleContext.roleIds.includes(roleId))) {
                    issues.push(
                        assemblyIssue(
                            `retrieval.${lane}[${index}].roleIds`,
                            "role_escalation",
                            "Retrieval item claims an unverified role.",
                            403
                        )
                    );
                    omitted.set(key(item.source), { source: item.source, reason: "invalid" });
                    continue;
                }
                addSelected(resolved.source.source, `retrieval.${lane}[${index}]`);
                const provenance = laneProvenance.get(key(item.source)) ?? {
                    lanes: new Set<"roleMatches" | "recentChanges" | "unresolvedOlderItems">(),
                    reasons: new Set<string>(),
                    ref: resolved.source.source,
                };
                provenance.lanes.add(lane);
                provenance.reasons.add(item.selectionReason);
                laneProvenance.set(key(item.source), provenance);
            }
        }
        for (const item of input.retrieval.omissions)
            if (item.source) omitted.set(key(item.source), item);
        retrievalState = {
            status: input.retrieval.status,
            selectedRefs: sortedRefs([...laneProvenance.values()].map(value => value.ref)),
            omissions: canonicalOmissions([...omitted.values()]),
            failures: canonicalFailures(input.retrieval.failures),
            laneProvenance: [...laneProvenance.values()]
                .sort((a, b) => key(a.ref).localeCompare(key(b.ref)))
                .map(value => ({
                    source: value.ref,
                    lanes: sortedStrings(value.lanes) as (
                        | "roleMatches"
                        | "recentChanges"
                        | "unresolvedOlderItems"
                    )[],
                    reasons: sortedStrings(value.reasons),
                })),
        };
    }

    const researchCitationRefs: ContextSourceRefV0[] = [];
    let researchState: ContextResearchStateV0 = {
        mode: "STOP",
        status: "stopped",
        citationRefs: [],
        failures: [],
    };
    if (input.researchPlan) {
        validatorIssues(
            validateContextResearchPlan(input.researchPlan, {
                trustedPublicProjections: input.trustedPublicProjections,
            }).issues,
            issues
        );
        researchState = {
            mode: input.researchPlan.mode,
            status: "stopped",
            citationRefs: [],
            failures: [],
        };
        if (input.researchResult) {
            validatorIssues(
                validateContextResearchResult(input.researchResult, input.researchPlan, {
                    trustedPublicProjections: input.trustedPublicProjections,
                }).issues,
                issues
            );
            researchState = {
                mode: input.researchResult.mode,
                status: input.researchResult.status,
                citationRefs: [],
                failures: canonicalFailures(input.researchResult.failures),
            };
            for (const [index, citation] of input.researchResult.citations.entries()) {
                const resolved = input.registry.resolve(citation.source);
                if (!resolved.ok) {
                    validatorIssues(resolved.issues, issues);
                    issues.push(
                        assemblyIssue(
                            `researchResult.citations[${index}]`,
                            "citation_source_unregistered",
                            "Research citation must preexist in the trusted source registry.",
                            403
                        )
                    );
                    continue;
                }
                if (
                    citation.source.kind !== "public" ||
                    resolved.source.audience.kind !== "public"
                ) {
                    issues.push(
                        assemblyIssue(
                            `researchResult.citations[${index}]`,
                            "invalid_citation_source",
                            "Research citations must be public sources.",
                            403
                        )
                    );
                    continue;
                }
                if (!resolved.source.citation) {
                    issues.push(
                        assemblyIssue(
                            `researchResult.citations[${index}]`,
                            "missing_citation_metadata",
                            "Trusted registry citation metadata is required.",
                            403
                        )
                    );
                    continue;
                }
                if (!citationMatches(citation, resolved.source.citation)) {
                    issues.push(
                        assemblyIssue(
                            `researchResult.citations[${index}]`,
                            "citation_metadata_mismatch",
                            "Citation metadata does not match the trusted registry.",
                            403
                        )
                    );
                    continue;
                }
                researchCitationRefs.push(resolved.source.source);
                addSelected(resolved.source.source, `researchResult.citations[${index}]`);
            }
            for (const [index, ref] of input.researchResult.internalSourceRefs.entries()) {
                const resolved = input.registry.resolve(ref);
                if (!resolved.ok) {
                    validatorIssues(resolved.issues, issues);
                    issues.push(
                        assemblyIssue(
                            `researchResult.internalSourceRefs[${index}]`,
                            "research_source_unregistered",
                            "Internal research sources must preexist in the trusted source registry.",
                            403
                        )
                    );
                    continue;
                }
                addSelected(resolved.source.source, `researchResult.internalSourceRefs[${index}]`);
            }
            if (input.researchResult.publicSafeQueryProjection.length > input.budgets.maxQueries)
                issues.push(
                    assemblyIssue(
                        "researchResult.publicSafeQueryProjection",
                        "query_budget_exceeded",
                        "Research projections exceed the aggregate query budget.",
                        409
                    )
                );
            researchState = { ...researchState, citationRefs: sortedRefs(researchCitationRefs) };
        }
    }

    const selectedRefs = sortedRefs(selected.values());
    const sourceRegistry = selectedRefs.flatMap(ref => {
        const source = input.registry.get(ref);
        return source ? [source] : [];
    });
    const actualMissing = sortedRefs(missing);
    const actualRevoked = sortedRefs(revoked);
    const coverage: ContextManifestCoverageV0 = {
        checked: sortedRefs(checked.values()),
        used: selectedRefs,
        missing: actualMissing,
        revoked: actualRevoked,
        omitted: sortedRefs(
            [...omitted.values()].flatMap(value => (value.source ? [value.source] : []))
        ),
        researchOmitted: [],
    };
    const omissions = canonicalOmissions([...omitted.values()]);
    const sourceVersions = Object.fromEntries(selectedRefs.map(ref => [key(ref), ref.version]));
    const roleProfileVersions = Object.fromEntries(
        Object.entries(input.roleProfileVersions).sort(([a], [b]) => a.localeCompare(b))
    );
    const companyArchitectureVersion = companyArchitectureRef?.version ?? "unknown";
    const personalStarVersions = Object.fromEntries(
        personalStarRefs
            .sort((a, b) => key(a).localeCompare(key(b)))
            .map(ref => [ref.id, ref.version])
    );
    const blocked = issues.length > 0 || actualMissing.length > 0 || actualRevoked.length > 0;
    const retrievalPartial =
        input.retrieval?.status === "partial" || input.retrieval?.status === "timeout";
    const researchPartial =
        input.researchResult?.status === "partial" ||
        input.researchResult?.status === "failed" ||
        input.researchResult?.status === "stopped";
    const status = blocked
        ? "blocked"
        : retrievalPartial || researchPartial
          ? "partial"
          : "complete";
    if (
        status === "blocked" &&
        actualMissing.length === 0 &&
        actualRevoked.length === 0 &&
        requiredEntries.length > 0
    )
        coverage.missing = [requiredEntries[0]!.source];
    const retrievalStateValue = retrievalState;
    const fingerprintInput = {
        inputVersion: input.inputVersion ?? "v0-assembly-1",
        actor: input.actor,
        reportWindow: input.reportWindow,
        roleMapVersion: input.roleContext.mappingVersion,
        roleIds: sortedStrings(input.roleContext.roleIds),
        roleProfileVersions,
        companyArchitectureVersion,
        personalStarVersions,
        sourceRegistry,
        coverage,
        omissions,
        research: researchState,
        retrievalState: retrievalStateValue,
    };
    const manifestWithoutFingerprint = {
        contractVersion: "v0-proposed" as const,
        runId: input.runId,
        inputVersion: input.inputVersion ?? "v0-assembly-1",
        actor: input.actor,
        reportWindow: input.reportWindow,
        roleMapVersion: input.roleContext.mappingVersion,
        roleIds: sortedStrings(input.roleContext.roleIds),
        roleProfileVersions,
        companyArchitectureVersion,
        personalStarVersions,
        sourceVersions,
        sourceRegistry,
        coverage,
        omissions,
        research: researchState,
        status,
        selectedRefs,
        retrievalState: retrievalStateValue,
    };
    const manifest: AssembledContextManifestV0 = freeze(
        clone({
            ...manifestWithoutFingerprint,
            contextFingerprint: hash(fingerprintInput),
        } as AssembledContextManifestV0)
    );
    const manifestValidation = validateContextManifest(manifest);
    validatorIssues(manifestValidation.issues, issues);
    if (issues.length || status === "blocked")
        return { ok: false, status: "blocked", issues, manifest };

    const snapshot = createEvidenceSnapshotV0({
        registry: input.registry,
        refs: selectedRefs,
        asOf: input.reportWindow.asOf,
        budgets: input.budgets,
    });
    if (!snapshot.ok) {
        validatorIssues(snapshot.issues, issues);
        return {
            ok: false,
            status: "blocked",
            issues,
            manifest: { ...manifest, status: "blocked" },
        };
    }
    const freezeValue = buildFreeze(
        input,
        selectedRefs,
        input.registry,
        companyArchitectureRef,
        personalStarRefs
    );
    const evidenceSnapshot = freeze({
        ...snapshot.snapshot,
        manifestFingerprint: manifest.contextFingerprint,
    });
    const value = freeze({ manifest, evidenceSnapshot, freeze: freezeValue });
    return { ok: true, status, value, issues: [] };
}

export { createSourceRegistryV0 };
export const assembleContextV0 = assembleContextManifestV0;
