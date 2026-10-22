import type {
    BusinessRoleContextV0,
    ContextResearchPlanV0,
    ContextResearchResultV0,
    ContextSourceEntryV0,
    ContextSourceRefV0,
    DynamicRetrievalInputV0,
    RequiredContextBundleV0,
    ContextScopeV0,
} from "../proposals/context-v0";
import { canonicalRefs as canonicalV1Refs } from "../rules-v1";
import { validateGenerationResult as validateFrozenV1Result } from "../validate-generation-v1";
import {
    contextSourceKeyV0,
    validateBusinessRoleContext,
    validateContextResearchPlan,
    validateContextResearchResult,
    validateDynamicRetrievalBundle,
    validateDynamicRetrievalInput,
    validateRequiredContextBundle,
} from "../proposals/context-v0";
import type {
    ContextAssemblyInputV0,
    ContextCurrentStateV0,
    ContextGenerationEnvelopeV0,
    ContextGenerationPortV0,
    ContextGenerationResultV0,
    ContextPipelineInputV0,
    ContextPipelineOutputV0,
    ContextPipelinePortsV0,
    ContextPortIssueV0,
    ContextFreezeV0,
    ContextManifestV0,
    EvidenceSnapshotV0,
    GenerationResult,
    GenerationInput,
    GenerationPort,
    GenerationRuntime,
    GuardedCommitInputV0,
    GuardedCommitPortV0,
} from "./ports";
import { ContextPortErrorV0 } from "./ports";
import { evidenceSnapshotFingerprintV0 } from "./evidence-snapshot";
export { ContextPortErrorV0 } from "./ports";

const issue = (
    code: string,
    message: string,
    status: ContextPortIssueV0["status"],
    path?: string
) => ({
    code,
    message,
    status,
    ...(path ? { path } : {}),
});

function fail(
    message: string,
    status: ContextPortIssueV0["status"],
    issues?: ContextPortIssueV0[]
): never {
    throw new ContextPortErrorV0(message, status, issues);
}

function deepFreeze<T>(value: T): T {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return value;
}

/** Clone before freezing so replaceable generators cannot mutate caller state. */
function immutableEnvelope(envelope: ContextGenerationEnvelopeV0): ContextGenerationEnvelopeV0 {
    return deepFreeze(structuredClone(envelope));
}

export function assertValidRoleContext(role: BusinessRoleContextV0, principalRef: string) {
    const checked = validateBusinessRoleContext(role);
    if (!checked.ok)
        fail(
            "Business role context failed validation.",
            403,
            checked.issues.map(x => ({ ...x }))
        );
    if (role.authenticatedPrincipalRef !== principalRef)
        fail("Business role context belongs to another actor.", 403, [
            issue(
                "principal_mismatch",
                "Role context principal differs from the authenticated actor.",
                403
            ),
        ]);
    return role;
}

export function assertValidRequiredContext(
    required: RequiredContextBundleV0,
    expected: { principalRef: string; companyId: string; aclDigest?: string; asOf?: string }
) {
    const checked = validateRequiredContextBundle(required, {
        expectedPrincipalRef: expected.principalRef,
        expectedCompanyId: expected.companyId,
    });
    if (!checked.ok) {
        const status = checked.issues.some(x => x.status === 403) ? 403 : 409;
        fail(
            "Required context failed validation.",
            status,
            checked.issues.map(x => ({ ...x }))
        );
    }
    if (required.status !== "complete" || required.coverage.missing.length > 0)
        fail("Mandatory context is unresolved.", 409, [
            issue(
                "missing_required_context",
                "Mandatory context must be complete before retrieval or research.",
                409
            ),
        ]);
    if (required.coverage.revoked.length > 0)
        fail("A mandatory context source is revoked.", 403, [
            issue("revoked_required_context", "A required source is no longer authorized.", 403),
        ]);
    if (
        required.actor.principalRef !== expected.principalRef ||
        required.actor.companyId !== expected.companyId
    )
        fail("Required context actor scope differs from the authenticated actor.", 403, [
            issue(
                "actor_scope_mismatch",
                "Required context is bound to another actor or company.",
                403
            ),
        ]);
    if (expected.aclDigest && required.actor.aclDigest !== expected.aclDigest)
        fail("Required context actor ACL is stale.", 403, [
            issue(
                "actor_acl_mismatch",
                "Required context ACL differs from the server-owned actor scope.",
                403
            ),
        ]);
    if (expected.asOf && required.asOf !== expected.asOf)
        fail("Required context cutoff differs from the requested report window.", 409, [
            issue("as_of_mismatch", "Required context was resolved at a different cutoff.", 409),
        ]);
    return required;
}

export function assertValidRetrievalInput(input: DynamicRetrievalInputV0) {
    const checked = validateDynamicRetrievalInput(input);
    if (!checked.ok)
        fail(
            "Dynamic retrieval input failed validation.",
            409,
            checked.issues.map(x => ({ ...x }))
        );
    return input;
}

/**
 * The plan boundary is an allow-list projection.  Unknown keys are dropped,
 * and public work requires an exact server-approved binding.
 */
export function sanitizeResearchPlan(
    value: unknown,
    trustedPublicProjections: readonly {
        projectionId: string;
        query: string;
        approvalToken: string;
    }[] = []
): ContextResearchPlanV0 {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("Research plan must be an object.", 400);
    const raw = value as Record<string, unknown>;
    const mode = raw.mode;
    if (mode !== "STOP" && mode !== "internal" && mode !== "public")
        fail("Research mode is invalid.", 400);
    const projections: ContextResearchPlanV0["publicSafeQueryProjection"] = Array.isArray(
        raw.publicSafeQueryProjection
    )
        ? raw.publicSafeQueryProjection.flatMap(item => {
              if (!item || typeof item !== "object" || Array.isArray(item)) return [];
              const p = item as Record<string, unknown>;
              if (
                  typeof p.projectionId !== "string" ||
                  typeof p.query !== "string" ||
                  typeof p.purpose !== "string" ||
                  typeof p.approvalToken !== "string" ||
                  typeof p.validatedAt !== "string"
              )
                  return [];
              const binding = trustedPublicProjections.find(
                  x =>
                      x.projectionId === p.projectionId &&
                      x.query === p.query &&
                      x.approvalToken === p.approvalToken
              );
              return binding
                  ? [
                        {
                            projectionId: p.projectionId,
                            query: p.query,
                            // Public tools receive a fixed purpose label; a user supplied
                            // purpose can carry private notes even when the query is bound.
                            purpose: "Approved public context lookup",
                            approvalToken: p.approvalToken,
                            validatedAt: p.validatedAt,
                        },
                    ]
                  : [];
          })
        : [];
    if (mode === "public" && projections.length === 0)
        fail("Public research needs an exact trusted query projection binding.", 403, [
            issue("unbound_public_projection", "Public research was fail-closed.", 403),
        ]);
    const internalSourceRefs: ContextSourceRefV0[] = Array.isArray(raw.internalSourceRefs)
        ? raw.internalSourceRefs.flatMap(item => {
              if (!item || typeof item !== "object" || Array.isArray(item)) return [];
              const r = item as Record<string, unknown>;
              return typeof r.kind === "string" &&
                  typeof r.id === "string" &&
                  typeof r.version === "string"
                  ? [{ kind: r.kind, id: r.id, version: r.version } as ContextSourceRefV0]
                  : [];
          })
        : [];
    const budgets = raw.budgets;
    if (!budgets || typeof budgets !== "object" || Array.isArray(budgets))
        fail("Research budgets are required.", 400);
    const rawBudgets = budgets as Record<string, unknown>;
    const safeBudgets = {
        maxSources: rawBudgets.maxSources,
        maxExcerptChars: rawBudgets.maxExcerptChars,
        timeoutMs: rawBudgets.timeoutMs,
        maxQueries: rawBudgets.maxQueries,
        maxTokens: rawBudgets.maxTokens,
    } as ContextResearchPlanV0["budgets"];
    const plan = {
        contractVersion: "v0-proposed" as const,
        mode,
        gapPurpose:
            mode === "public"
                ? "Approved public context lookup"
                : typeof raw.gapPurpose === "string" && raw.gapPurpose.trim()
                  ? raw.gapPurpose
                  : "No optional research requested",
        internalSourceRefs: mode === "public" ? [] : internalSourceRefs,
        publicSafeQueryProjection: mode === "public" ? projections : [],
        budgets: safeBudgets,
    } satisfies ContextResearchPlanV0;
    const checked = validateContextResearchPlan(plan, {
        trustedPublicProjections: projections.map(p => ({
            projectionId: p.projectionId,
            query: p.query,
            approvalToken: p.approvalToken,
        })),
    });
    if (!checked.ok)
        fail(
            "Research plan failed validation.",
            400,
            checked.issues.map(x => ({ ...x }))
        );
    return plan;
}

function stoppedResearch(asOf: string, gapPurpose = ""): ContextResearchResultV0 {
    return {
        contractVersion: "v0-proposed",
        mode: "STOP",
        gapPurpose,
        publicSafeQueryProjection: [],
        internalSourceRefs: [],
        citations: [],
        failures: [],
        status: "stopped",
        asOf,
    };
}

function unavailableResearch(plan: ContextResearchPlanV0, asOf: string): ContextResearchResultV0 {
    return {
        contractVersion: "v0-proposed",
        mode: plan.mode,
        gapPurpose: plan.gapPurpose,
        publicSafeQueryProjection: plan.publicSafeQueryProjection,
        internalSourceRefs: plan.internalSourceRefs,
        citations: [],
        failures: [
            { code: "source_unavailable", message: "Optional research provider unavailable." },
        ],
        status: "failed",
        asOf,
    };
}

function assertInternalResearchRefs(
    plan: ContextResearchPlanV0,
    catalog: readonly ContextSourceEntryV0[],
    actor: ContextScopeV0
) {
    const byKey = new Map(catalog.map(entry => [contextSourceKeyV0(entry.source), entry]));
    for (const ref of plan.internalSourceRefs) {
        const entry = byKey.get(contextSourceKeyV0(ref));
        if (!entry)
            fail("Research source is not in the trusted server catalog.", 404, [
                issue("research_source_missing", contextSourceKeyV0(ref), 404),
            ]);
        if (entry.access !== "allowed")
            fail("Research source is not authorized.", 403, [
                issue("research_source_revoked", contextSourceKeyV0(ref), 403),
            ]);
        if (
            entry.companyId !== actor.companyId ||
            (entry.audience.kind === "actor" && entry.audience.principalRef !== actor.principalRef)
        )
            fail("Research source crosses the actor or company boundary.", 403, [
                issue("research_source_scope", contextSourceKeyV0(ref), 403),
            ]);
    }
}

export async function runContextV0Pipeline(
    input: ContextPipelineInputV0,
    ports: ContextPipelinePortsV0
): Promise<ContextPipelineOutputV0> {
    const authenticatedActor = await ports.server.resolveAuthenticatedActor({
        principalRef: input.principalRef,
        companyId: input.companyId,
        signal: input.signal,
    });
    if (
        authenticatedActor.principalRef !== input.principalRef ||
        authenticatedActor.companyId !== input.companyId
    )
        fail("Authenticated actor scope does not match the request.", 403, [
            issue(
                "actor_scope_mismatch",
                "Server actor scope differs from the request identity.",
                403
            ),
        ]);
    const roleContext = assertValidRoleContext(
        await ports.roles.resolveBusinessRoles({ ...input, requestedRoleIds: input.roleIds }),
        input.principalRef
    );
    const requiredContext = assertValidRequiredContext(
        await ports.roles.resolveRequiredContext({ ...input, roleContext }),
        { ...input, aclDigest: authenticatedActor.aclDigest, asOf: input.reportWindow.asOf }
    );
    if (requiredContext.actor.aclDigest !== authenticatedActor.aclDigest)
        fail("Required context ACL is stale.", 403, [
            issue(
                "actor_acl_mismatch",
                "Required context ACL differs from the server-owned actor scope.",
                403
            ),
        ]);
    const sourceCatalog = await ports.server.sourceCatalog({ ...input, roleContext });
    const retrievalInput: DynamicRetrievalInputV0 = {
        contractVersion: "v0-proposed",
        actor: authenticatedActor,
        verifiedRoleContext: roleContext,
        reportWindow: input.reportWindow,
        sourceCatalog,
        budgets: input.budgets,
    };
    assertValidRetrievalInput(retrievalInput);
    const retrieval = await ports.retrieval.retrieve(retrievalInput);
    const retrievalChecked = validateDynamicRetrievalBundle(retrieval, retrievalInput);
    if (!retrievalChecked.ok)
        fail(
            "Dynamic retrieval failed validation.",
            409,
            retrievalChecked.issues.map(x => ({ ...x }))
        );
    const base: ContextAssemblyInputV0 = {
        runId: input.runId,
        inputVersion: input.inputVersion,
        roleContext,
        requiredContext,
        retrieval,
        retrievalInput,
        research: stoppedResearch(input.reportWindow.asOf),
        reportWindow: input.reportWindow,
        budgets: input.budgets,
    };
    let researchPlan: ContextResearchPlanV0 = sanitizeResearchPlan(
        {
            contractVersion: "v0-proposed",
            mode: "STOP",
            gapPurpose: "No optional research requested",
            internalSourceRefs: [],
            publicSafeQueryProjection: [],
            budgets: input.budgets,
        },
        ports.trustedPublicProjections
    );
    if (ports.planResearch)
        researchPlan = sanitizeResearchPlan(
            await ports.planResearch(base),
            ports.trustedPublicProjections
        );
    assertInternalResearchRefs(researchPlan, sourceCatalog, authenticatedActor);
    let research = stoppedResearch(input.reportWindow.asOf, researchPlan.gapPurpose);
    if (researchPlan.mode !== "STOP") {
        if (!ports.research) research = unavailableResearch(researchPlan, input.reportWindow.asOf);
        else {
            const candidate = await ports.research.research(researchPlan);
            const checked = validateContextResearchResult(candidate, researchPlan, {
                trustedPublicProjections: researchPlan.publicSafeQueryProjection.map(p => ({
                    projectionId: p.projectionId,
                    query: p.query,
                    approvalToken: p.approvalToken,
                })),
            });
            if (!checked.ok)
                fail(
                    "Context research failed validation.",
                    409,
                    checked.issues.map(x => ({ ...x }))
                );
            research = candidate;
        }
    }
    const assembled = await ports.assembler.assemble({
        ...base,
        research,
        researchPlan,
        trustedPublicProjections: ports.trustedPublicProjections,
    });
    // The assembler freeze remains the artifact returned to consumers.  The
    // server-owned current state is captured only to verify every field before
    // that artifact can cross the boundary.
    const authoritativeFreeze = await captureFreeze(
        ports.server,
        authenticatedActor,
        assembled.manifest.sourceRegistry.map(x => x.source)
    );
    assertManifestFreezeBinding(assembled.manifest, assembled.freeze, assembled.evidenceSnapshot);
    assertFreezeMatchesAuthoritative(assembled.freeze, authoritativeFreeze, assembled.manifest);
    return { ...assembled, research };
}

export const createContextV0Orchestrator = runContextV0Pipeline;

export interface RunContextV0GenerationInputV0 {
    context: ContextPipelineInputV0;
    v1Input: GenerationInput;
    runtime: GenerationRuntime;
    ports: ContextPipelinePortsV0;
    generator: ContextGenerationPortV0;
    commit?: GuardedCommitPortV0<unknown>;
}

export async function runContextV0Generation(input: RunContextV0GenerationInputV0) {
    const context = await runContextV0Pipeline(input.context, input.ports);
    const envelope = immutableEnvelope({
        v1Input: input.v1Input,
        manifest: context.manifest,
        evidenceSnapshot: context.evidenceSnapshot,
        freeze: context.freeze,
    });
    assertEnvelopeBinding(envelope);
    const generated = await input.generator(envelope, input.runtime);
    assertGeneratedResultBinding(envelope, generated);
    await assertGenerationFreshness(envelope, input.ports.server);
    const result = { context, envelope, generated };
    if (!input.commit) return result;
    const persisted = await commitContextGeneration(
        { envelope, generated },
        input.ports.server,
        input.commit
    );
    return { ...result, persisted };
}

function assertManifestFreezeBinding(
    manifest: ContextManifestV0,
    freeze: ContextFreezeV0,
    snapshot: EvidenceSnapshotV0
) {
    assertSnapshotBinding(manifest, freeze, snapshot);
    if (
        freeze.actorACL.principalRef !== manifest.actor.principalRef ||
        freeze.actorACL.companyId !== manifest.actor.companyId ||
        freeze.actorACL.aclDigest !== manifest.actor.aclDigest ||
        JSON.stringify(freeze.actorACL.audience) !== JSON.stringify(manifest.actor.audience)
    )
        fail("Context freeze does not bind to the assembled actor ACL.", 409, [
            issue("manifest_freeze_mismatch", "Actor ACL changed before generation.", 409),
        ]);
    for (const [key, version] of Object.entries(manifest.sourceVersions)) {
        const frozen = freeze.sources.find(value => contextSourceKeyV0(value.ref) === key);
        if (!frozen || frozen.ref.version !== version)
            fail("Context freeze does not bind to the assembled manifest.", 409, [
                issue(
                    "manifest_freeze_mismatch",
                    `Manifest source ${key} is not in the freeze.`,
                    409
                ),
            ]);
    }
    if (
        freeze.roleMapVersion !== manifest.roleMapVersion ||
        !sameRecord(freeze.roleProfileVersions, manifest.roleProfileVersions) ||
        freeze.companyArchitecture.ref.version !== manifest.companyArchitectureVersion
    )
        fail("Context freeze does not bind to role or architecture versions.", 409, [
            issue(
                "manifest_freeze_mismatch",
                "Role or architecture version changed before generation.",
                409
            ),
        ]);
    for (const [id, version] of Object.entries(manifest.personalStarVersions)) {
        const star = freeze.personalStars.find(value => value.ref.id === id);
        if (!star || star.ref.version !== version)
            fail("Context freeze does not bind to personal-star versions.", 409, [
                issue(
                    "manifest_freeze_mismatch",
                    `Personal star ${id} changed before generation.`,
                    409
                ),
            ]);
    }
    const registryByKey = new Map(
        manifest.sourceRegistry.map(entry => [contextSourceKeyV0(entry.source), entry])
    );
    for (const frozen of freeze.sources) {
        const entry = registryByKey.get(contextSourceKeyV0(frozen.ref));
        if (
            !entry ||
            frozen.ref.version !== entry.source.version ||
            frozen.aclDigest !== entry.aclDigest ||
            frozen.access !== entry.access ||
            JSON.stringify(frozen.audience) !== JSON.stringify(entry.audience)
        )
            fail("Context freeze does not bind to the assembled source registry.", 409, [
                issue(
                    "manifest_freeze_mismatch",
                    `Source ${contextSourceKeyV0(frozen.ref)} changed before generation.`,
                    409
                ),
            ]);
    }
}

function assertSnapshotBinding(
    manifest: ContextManifestV0,
    freeze: ContextFreezeV0,
    snapshot: EvidenceSnapshotV0
) {
    if (snapshot.manifestFingerprint !== manifest.contextFingerprint)
        fail("Evidence snapshot is bound to a different context manifest.", 409, [
            issue(
                "snapshot_manifest_mismatch",
                "Evidence bytes were not produced for the frozen manifest.",
                409
            ),
        ]);
    if (snapshot.asOf !== manifest.reportWindow.asOf)
        fail("Evidence snapshot cutoff differs from the context manifest.", 409, [
            issue(
                "snapshot_as_of_mismatch",
                "Evidence snapshot must use the manifest report cutoff.",
                409
            ),
        ]);
    if (snapshot.contentFingerprint !== evidenceSnapshotFingerprintV0(snapshot.entries))
        fail("Evidence snapshot content fingerprint is invalid.", 409, [
            issue(
                "snapshot_fingerprint_mismatch",
                "Evidence bytes do not match their declared fingerprint.",
                409
            ),
        ]);
    const totalExcerptChars = snapshot.entries.reduce(
        (total, entry) => total + entry.excerpt.length,
        0
    );
    if (snapshot.totalExcerptChars !== totalExcerptChars)
        fail("Evidence snapshot excerpt total is invalid.", 409, [
            issue(
                "snapshot_excerpt_total_mismatch",
                "Evidence excerpt accounting does not match the snapshot bytes.",
                409
            ),
        ]);
    const manifestRefs = new Map(
        manifest.sourceRegistry.map(entry => [contextSourceKeyV0(entry.source), entry])
    );
    const freezeRefs = new Map(freeze.sources.map(entry => [contextSourceKeyV0(entry.ref), entry]));
    const snapshotRefs = new Map(
        snapshot.entries.map(entry => [contextSourceKeyV0(entry.source), entry])
    );
    if (
        manifestRefs.size !== freezeRefs.size ||
        manifestRefs.size !== snapshotRefs.size ||
        [...manifestRefs.keys()].some(key => !freezeRefs.has(key) || !snapshotRefs.has(key))
    )
        fail("Evidence snapshot references do not match the frozen manifest.", 409, [
            issue(
                "snapshot_refs_mismatch",
                "Manifest, freeze and snapshot source references must be identical.",
                409
            ),
        ]);
    for (const [key, entry] of snapshotRefs) {
        const manifestEntry = manifestRefs.get(key)!;
        const frozen = freezeRefs.get(key)!;
        if (
            entry.source.version !== manifestEntry.source.version ||
            entry.excerpt !== manifestEntry.excerpt ||
            entry.contentHash !== frozen.contentHash ||
            frozen.ref.version !== entry.source.version
        )
            fail("Evidence snapshot content is not bound to the frozen registry.", 409, [
                issue(
                    "snapshot_entry_mismatch",
                    `Evidence source ${key} changed from the frozen registry.`,
                    409
                ),
            ]);
    }
}

export function assertEnvelopeBinding(envelope: ContextGenerationEnvelopeV0) {
    const period = envelope.v1Input.reportPeriod;
    const window = envelope.manifest.reportWindow;
    const sameInstant = (left: string, right: string) => {
        const leftMs = Date.parse(left);
        const rightMs = Date.parse(right);
        return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
    };
    if (
        envelope.v1Input.runId !== envelope.manifest.runId ||
        !sameInstant(period.startInclusive, window.startInclusive) ||
        !sameInstant(period.endExclusive, window.endExclusive) ||
        !sameInstant(period.asOf, window.asOf)
    )
        fail("V1 input is bound to a different context run or report window.", 409, [
            issue(
                "v1_context_window_mismatch",
                "The V1 generation input must use the same run and report window as the V0 manifest.",
                409
            ),
        ]);
    assertManifestFreezeBinding(envelope.manifest, envelope.freeze, envelope.evidenceSnapshot);
    return envelope;
}

function assertFreezeMatchesAuthoritative(
    assembled: ContextFreezeV0,
    authoritative: ContextFreezeV0,
    manifest: ContextManifestV0
) {
    const sameHash = (
        a: ContextFreezeV0["companyArchitecture"],
        b: ContextFreezeV0["companyArchitecture"]
    ) =>
        contextSourceKeyV0(a.ref) === contextSourceKeyV0(b.ref) &&
        a.contentHash === b.contentHash &&
        a.aclDigest === b.aclDigest &&
        a.access === b.access &&
        JSON.stringify(a.audience) === JSON.stringify(b.audience);
    const identityMismatch =
        assembled.actorACL.principalRef !== authoritative.actorACL.principalRef ||
        assembled.actorACL.companyId !== authoritative.actorACL.companyId ||
        assembled.actorACL.aclDigest !== authoritative.actorACL.aclDigest ||
        JSON.stringify(assembled.actorACL.audience) !==
            JSON.stringify(authoritative.actorACL.audience) ||
        assembled.roleMapVersion !== authoritative.roleMapVersion ||
        !sameRecord(assembled.roleProfileVersions, authoritative.roleProfileVersions) ||
        !sameHash(assembled.companyArchitecture, authoritative.companyArchitecture);
    if (identityMismatch)
        fail("Server-owned context changed while assembling the manifest.", 409, [
            issue(
                "context_freeze_mismatch",
                "Actor, role, profile, architecture or ACL state changed before generation.",
                409
            ),
        ]);
    const expectedStars = new Map(
        assembled.personalStars.map(value => [contextSourceKeyV0(value.ref), value])
    );
    const actualStars = new Map(
        authoritative.personalStars.map(value => [contextSourceKeyV0(value.ref), value])
    );
    if (
        expectedStars.size !== actualStars.size ||
        [...expectedStars].some(
            ([key, value]) => !actualStars.has(key) || !sameHash(value, actualStars.get(key)!)
        )
    )
        fail("Server-owned personal-star state changed while assembling the manifest.", 409, [
            issue(
                "context_freeze_mismatch",
                "Personal-star ACL, audience or content changed before generation.",
                409
            ),
        ]);
    const expectedSources = new Map(
        assembled.sources.map(value => [contextSourceKeyV0(value.ref), value])
    );
    const actualSources = new Map(
        authoritative.sources.map(value => [contextSourceKeyV0(value.ref), value])
    );
    const manifestKeys = Object.keys(manifest.sourceVersions);
    if (
        expectedSources.size !== actualSources.size ||
        expectedSources.size !== manifestKeys.length ||
        [...expectedSources].some(
            ([key, value]) => !actualSources.has(key) || !sameHash(value, actualSources.get(key)!)
        )
    )
        fail("Server-owned source state changed while assembling the manifest.", 409, [
            issue(
                "context_freeze_mismatch",
                "Source version, content, ACL or audience changed before generation.",
                409
            ),
        ]);
}

export async function captureFreeze(
    server: ContextPipelinePortsV0["server"],
    actor: ContextScopeV0,
    sourceRefs: readonly ContextSourceRefV0[]
): Promise<ContextFreezeV0> {
    const state = await server.currentState({ actor, sourceRefs });
    assertSufficientCurrentState(state, sourceRefs, actor);
    return freezeFromState(state, sourceRefs);
}

/** Missing server-owned freshness metadata is an unavailable boundary, never a reason to skip a check. */
export function assertSufficientCurrentState(
    state: ContextCurrentStateV0,
    refs?: readonly ContextSourceRefV0[],
    actor?: ContextScopeV0
) {
    if (
        !Array.isArray(state.sourceEntries) ||
        !state.sourceVersions ||
        !state.sourceFingerprints ||
        !state.sourceAudiences ||
        !state.sourceAccess ||
        typeof state.sourceVersions !== "object" ||
        typeof state.sourceFingerprints !== "object" ||
        typeof state.sourceAudiences !== "object" ||
        typeof state.sourceAccess !== "object"
    )
        fail("Trusted current-state metadata is unavailable.", 503, [
            issue(
                "freshness_metadata_unavailable",
                "Source ACL, audience and content metadata are required.",
                503
            ),
        ]);
    if (
        typeof state.actorAclDigest !== "string" ||
        typeof state.principalRef !== "string" ||
        typeof state.companyId !== "string" ||
        typeof state.roleMapVersion !== "string" ||
        typeof state.companyArchitectureVersion !== "string" ||
        !state.roleProfileVersions ||
        !state.personalStarVersions
    )
        fail("Trusted current-state identity metadata is unavailable.", 503, [
            issue(
                "freshness_metadata_unavailable",
                "Actor, role and version metadata are required.",
                503
            ),
        ]);
    const checkedRefs = refs ?? state.sourceEntries.map(entry => entry.source);
    if (actor && (state.principalRef !== actor.principalRef || state.companyId !== actor.companyId))
        fail("Trusted current-state actor scope is unavailable or changed.", 503, [
            issue(
                "freshness_actor_scope_unavailable",
                "Current-state actor scope did not bind to the authenticated actor.",
                503
            ),
        ]);
    if (actor && state.actorAclDigest !== actor.aclDigest)
        fail("Trusted current-state actor ACL is unavailable or changed.", 403, [
            issue(
                "freshness_actor_acl_mismatch",
                "Current-state actor ACL did not bind to the authenticated actor.",
                403
            ),
        ]);
    for (const ref of checkedRefs) {
        const key = contextSourceKeyV0(ref);
        if (
            state.sourceVersions[key] === undefined ||
            state.sourceFingerprints[key] === undefined ||
            state.sourceAudiences[key] === undefined ||
            state.sourceAccess[key] === undefined
        )
            fail("Trusted current-state metadata is incomplete.", 503, [
                issue(
                    "freshness_metadata_incomplete",
                    `Missing freshness metadata for ${key}.`,
                    503
                ),
            ]);
        const entry = state.sourceEntries.find(value => contextSourceKeyV0(value.source) === key);
        if (
            !entry ||
            state.sourceVersions[key] !== entry.source.version ||
            !state.sourceFingerprints[key]?.trim() ||
            state.sourceAudiences[key] !== JSON.stringify(entry.audience) ||
            state.sourceAccess[key] !== entry.access
        )
            fail("Trusted current-state metadata disagrees with the server source record.", 503, [
                issue(
                    "freshness_metadata_conflict",
                    `Inconsistent freshness metadata for ${key}.`,
                    503
                ),
            ]);
    }
}

export function freezeFromState(
    state: ContextCurrentStateV0,
    sourceRefs?: readonly ContextSourceRefV0[]
): ContextFreezeV0 {
    assertSufficientCurrentState(state, sourceRefs);
    const allEntries = state.sourceEntries;
    const selected = sourceRefs ? new Set(sourceRefs.map(contextSourceKeyV0)) : undefined;
    const entries = selected
        ? allEntries.filter(entry => selected.has(contextSourceKeyV0(entry.source)))
        : allEntries;
    if (
        !state.principalRef ||
        !state.companyId ||
        !state.actorAclDigest ||
        !state.roleMapVersion ||
        !state.companyArchitectureVersion
    )
        fail("Trusted current-state identity metadata is unavailable.", 503, [
            issue(
                "freshness_metadata_unavailable",
                "Actor, role and architecture identities are required.",
                503
            ),
        ]);
    const hashes = entries.map(entry => ({
        ref: entry.source,
        contentHash: state.sourceFingerprints[contextSourceKeyV0(entry.source)]!,
        aclDigest: entry.aclDigest,
        audience: entry.audience,
        access: entry.access,
    }));
    const companyArchitecture = hashes.find(
        value =>
            value.ref.kind === "company" && value.ref.version === state.companyArchitectureVersion
    );
    if (!companyArchitecture)
        fail("Trusted company architecture state is unavailable.", 503, [
            issue(
                "architecture_metadata_unavailable",
                "The current company architecture version is not in the trusted source state.",
                503
            ),
        ]);
    const stars = hashes.filter(
        value =>
            value.ref.kind === "doc" &&
            Object.prototype.hasOwnProperty.call(state.personalStarVersions, value.ref.id)
    );
    for (const [id, version] of Object.entries(state.personalStarVersions)) {
        if (!stars.some(value => value.ref.id === id && value.ref.version === version))
            fail("Trusted personal-star state is unavailable.", 503, [
                issue(
                    "star_metadata_unavailable",
                    `Personal star ${id} is not in the trusted source state.`,
                    503
                ),
            ]);
    }
    const stable = JSON.stringify({
        actor: state.actorAclDigest,
        sources: hashes,
        role: state.roleMapVersion,
        profiles: state.roleProfileVersions,
        architecture: state.companyArchitectureVersion,
        stars: state.personalStarVersions,
    });
    return {
        contractVersion: "v0-assembly-1",
        actorACL: {
            principalRef: state.principalRef,
            companyId: state.companyId,
            audience: { kind: "actor", principalRef: state.principalRef },
            aclDigest: state.actorAclDigest,
        },
        roleMapVersion: state.roleMapVersion,
        roleProfileVersions: { ...state.roleProfileVersions },
        companyArchitecture,
        personalStars: stars,
        sources: hashes,
        contentFingerprint: stable,
    };
}

function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => a[key] === b[key]);
}

export function assertFreezeCurrent(freeze: ContextFreezeV0, current: ContextCurrentStateV0) {
    assertSufficientCurrentState(
        current,
        freeze.sources.map(value => value.ref),
        freeze.actorACL
    );
    if (freeze.actorACL.aclDigest !== current.actorAclDigest)
        fail("Actor authorization changed during generation.", 403, [
            issue("actor_acl_changed", "Actor ACL was revoked or changed.", 403),
        ]);
    const currentFreeze = freezeFromState(
        current,
        freeze.sources.map(value => value.ref)
    );
    for (const frozen of freeze.sources) {
        const currentEntry = currentFreeze.sources.find(
            value => contextSourceKeyV0(value.ref) === contextSourceKeyV0(frozen.ref)
        );
        if (!currentEntry) {
            const logicalCurrent = currentFreeze.sources.find(
                value => value.ref.kind === frozen.ref.kind && value.ref.id === frozen.ref.id
            );
            if (logicalCurrent)
                fail("A cited source version changed during generation.", 409, [
                    issue(
                        "source_version_changed",
                        `Source ${frozen.ref.kind}:${frozen.ref.id} changed version.`,
                        409
                    ),
                ]);
            fail("A cited source is missing.", 404, [
                issue(
                    "source_missing",
                    `Source ${contextSourceKeyV0(frozen.ref)} no longer exists.`,
                    404
                ),
            ]);
        }
        const currentAccess =
            current.sourceAccess?.[contextSourceKeyV0(frozen.ref)] ??
            current.sourceEntries?.find(
                entry => contextSourceKeyV0(entry.source) === contextSourceKeyV0(frozen.ref)
            )?.access;
        if (currentAccess === "revoked")
            fail("A cited source was revoked.", 403, [
                issue(
                    "source_revoked",
                    `Source ${contextSourceKeyV0(frozen.ref)} is no longer authorized.`,
                    403
                ),
            ]);
        if (
            currentEntry.contentHash !== frozen.contentHash ||
            currentEntry.aclDigest !== frozen.aclDigest ||
            JSON.stringify(currentEntry.audience) !== JSON.stringify(frozen.audience) ||
            currentEntry.access !== frozen.access
        )
            fail("A cited source changed during generation.", 409, [
                issue(
                    "source_changed",
                    `Source ${contextSourceKeyV0(frozen.ref)} changed after the context freeze.`,
                    409
                ),
            ]);
    }
    if (
        current.roleMapVersion !== freeze.roleMapVersion ||
        !sameRecord(current.roleProfileVersions, freeze.roleProfileVersions) ||
        current.companyArchitectureVersion !== freeze.companyArchitecture.ref.version ||
        !sameRecord(
            current.personalStarVersions,
            Object.fromEntries(freeze.personalStars.map(value => [value.ref.id, value.ref.version]))
        )
    )
        fail("Role or required context changed during generation.", 409, [
            issue("context_changed", "Role/profile or required source versions changed.", 409),
        ]);
    return true;
}

function collectV1CitationRefs(result: GenerationResult): string[] {
    const refs: string[] = [];
    for (const topic of result.draft?.topics ?? []) {
        for (const fact of [...(topic.facts ?? []), ...(topic.conflicts ?? [])])
            for (const ref of fact.refs ?? []) if (typeof ref?.ref === "string") refs.push(ref.ref);
    }
    for (const enhancement of result.enhancements ?? [])
        for (const ref of enhancement.refs ?? [])
            if (typeof ref?.ref === "string") refs.push(ref.ref);
    return [...new Set(refs)].sort();
}

export interface ContextAwareGenerationSidecarV0 {
    v1Result: GenerationResult;
    /** Explicit canonical V0 refs. These may include doc/company/public refs. */
    citationRefs: ContextSourceRefV0[];
}

type ContextAwareGenerationResponseV0 = GenerationResult | ContextAwareGenerationSidecarV0;

function assertV1CitationsRegistered(result: GenerationResult, input: GenerationInput) {
    const refs = collectV1CitationRefs(result);
    const registered = canonicalV1Refs(input);
    const invalid = refs.filter(ref => !registered.has(ref));
    if (invalid.length)
        fail("Generator cited a source absent from the exact v1 input.", 403, [
            issue("v1_unregistered_citation", invalid.join(", "), 403),
        ]);
    return refs;
}

function isContextAwareSidecar(
    value: ContextAwareGenerationResponseV0
): value is ContextAwareGenerationSidecarV0 {
    return !!value && typeof value === "object" && "v1Result" in value && "citationRefs" in value;
}

export function assertGeneratedResultBinding(
    envelope: ContextGenerationEnvelopeV0,
    generated: ContextGenerationResultV0
) {
    if (generated.contextMode !== "aware-v0" && generated.contextMode !== "ignored-v0")
        fail("Generation result has an invalid context mode.", 409, [
            issue("invalid_context_mode", "Context mode must be aware-v0 or ignored-v0.", 409),
        ]);
    if (!Array.isArray(generated.citationRefs))
        fail("Generation result citations must be an array.", 409, [
            issue("invalid_citation_refs", "Canonical citation refs must be an array.", 409),
        ]);
    const validated = validateV1GenerationResult(generated.v1Result, envelope.v1Input);
    assertV1CitationsRegistered(validated, envelope.v1Input);
    if (generated.manifestFingerprint !== envelope.manifest.contextFingerprint)
        fail("Generation result is bound to a different context manifest.", 409, [
            issue(
                "manifest_fingerprint_mismatch",
                "The result was not generated from the frozen manifest.",
                409
            ),
        ]);
    assertCanonicalCitationRefs(envelope, generated.citationRefs);
    if (generated.contextMode === "ignored-v0" && generated.citationRefs.length > 0)
        fail("Ignored V0 generation cannot persist V0 citations.", 409, [
            issue(
                "ignored_context_citations",
                "Compatibility generation must emit zero V0 citations.",
                409
            ),
        ]);
    return validated;
}

async function assertGenerationFreshness(
    envelope: ContextGenerationEnvelopeV0,
    server: ContextPipelinePortsV0["server"]
) {
    const current = await server.currentState({
        actor: envelope.manifest.actor,
        sourceRefs: envelope.evidenceSnapshot.entries.map(entry => entry.source),
    });
    assertFreezeCurrent(envelope.freeze, current);
}

export function validateV1GenerationResult(
    result: unknown,
    input: GenerationInput
): GenerationResult {
    try {
        return validateFrozenV1Result(input, result);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "The frozen v1 result failed validation.";
        const status =
            typeof (error as { status?: unknown })?.status === "number" &&
            (error as { status: number }).status === 409
                ? 409
                : 500;
        fail("Generator returned an invalid v1 result.", status, [
            issue("invalid_v1_result", message, status),
        ]);
    }
}

function eligibleCitationRefs(envelope: ContextGenerationEnvelopeV0): Set<string> {
    const snapshot = new Set(
        envelope.evidenceSnapshot.entries.map(entry => contextSourceKeyV0(entry.source))
    );
    const registry = new Set(
        envelope.manifest.sourceRegistry.map(entry => contextSourceKeyV0(entry.source))
    );
    const freeze = new Set(envelope.freeze.sources.map(entry => contextSourceKeyV0(entry.ref)));
    return new Set([...snapshot].filter(key => registry.has(key) && freeze.has(key)));
}

function registeredRefs(envelope: ContextGenerationEnvelopeV0): Set<string> {
    const values = new Set<string>();
    for (const key of eligibleCitationRefs(envelope)) {
        values.add(key);
        const at = key.indexOf("@");
        values.add(at < 0 ? key : key.slice(0, at));
    }
    return values;
}

export function assertRegisteredCitations(
    envelope: ContextGenerationEnvelopeV0,
    refs: readonly string[]
) {
    const allowed = registeredRefs(envelope);
    const unversioned = refs.filter(ref => !ref.includes("@"));
    if (unversioned.length)
        fail("V0 citations must use exact versioned references.", 403, [
            issue("unversioned_citation", unversioned.join(", "), 403),
        ]);
    const byLogical = new Map<string, ContextSourceRefV0[]>();
    for (const entry of envelope.evidenceSnapshot.entries) {
        const logical = `${entry.source.kind}:${entry.source.id}`;
        const values = byLogical.get(logical) ?? [];
        values.push(entry.source);
        byLogical.set(logical, values);
    }
    for (const entry of envelope.manifest.sourceRegistry) {
        const logical = `${entry.source.kind}:${entry.source.id}`;
        const values = byLogical.get(logical) ?? [];
        if (!values.some(value => contextSourceKeyV0(value) === contextSourceKeyV0(entry.source)))
            values.push(entry.source);
        byLogical.set(logical, values);
    }
    const canonical: ContextSourceRefV0[] = [];
    const unknown = refs.filter(ref => {
        if (!allowed.has(ref)) return true;
        const at = ref.indexOf("@");
        const logical = at < 0 ? ref : ref.slice(0, at);
        const candidates = byLogical.get(logical) ?? [];
        const exact =
            at < 0 ? candidates : candidates.filter(value => contextSourceKeyV0(value) === ref);
        if (exact.length !== 1) return true;
        canonical.push(exact[0]!);
        return false;
    });
    if (unknown.length)
        fail("Generator cited an unregistered source.", 403, [
            issue("unregistered_citation", unknown.join(", "), 403),
        ]);
    return [...new Map(canonical.map(value => [contextSourceKeyV0(value), value])).values()].sort(
        (a, b) => contextSourceKeyV0(a).localeCompare(contextSourceKeyV0(b))
    );
}

/** Resolve a v1 id against the frozen source registry, returning canonical V0 objects. */
export function resolveV1CitationRefs(
    envelope: ContextGenerationEnvelopeV0,
    refs: readonly string[]
) {
    const byLogical = new Map<string, ContextSourceRefV0[]>();
    for (const entry of envelope.evidenceSnapshot.entries) {
        const logical = `${entry.source.kind}:${entry.source.id}`;
        byLogical.set(logical, [...(byLogical.get(logical) ?? []), entry.source]);
    }
    for (const entry of envelope.manifest.sourceRegistry) {
        const logical = `${entry.source.kind}:${entry.source.id}`;
        const values = byLogical.get(logical) ?? [];
        if (!values.some(value => contextSourceKeyV0(value) === contextSourceKeyV0(entry.source)))
            values.push(entry.source);
        byLogical.set(logical, values);
    }
    const eligible = eligibleCitationRefs(envelope);
    const resolved = refs.flatMap(ref => {
        const values = byLogical.get(ref);
        return values?.length === 1 && eligible.has(contextSourceKeyV0(values[0]!)) ? values : [];
    });
    if (resolved.length !== refs.length)
        fail("Generator cited an unregistered or ambiguous source.", 403, [
            issue("unregistered_citation", refs.join(", "), 403),
        ]);
    return [...new Map(resolved.map(value => [contextSourceKeyV0(value), value])).values()].sort(
        (a, b) => contextSourceKeyV0(a).localeCompare(contextSourceKeyV0(b))
    );
}

function resolveLegacyV1CitationRefs(
    envelope: ContextGenerationEnvelopeV0,
    refs: readonly string[]
) {
    // A v1 id has no version and therefore cannot identify doc/company/public
    // content safely. Legacy compatibility may only bridge the old event-like
    // namespaces when the frozen V0 registry has one exact version.
    const safe = refs.filter(ref => /^(ev|obs|cm):/.test(ref));
    return resolveV1CitationRefs(envelope, safe);
}

export function wrapExistingGenerationPort(existing: GenerationPort): ContextGenerationPortV0 {
    return async (envelope, runtime) => {
        const safeEnvelope = immutableEnvelope(envelope);
        assertEnvelopeBinding(safeEnvelope);
        // Compatibility adapter intentionally ignores V0 context.  It does not
        // claim that the existing model is role-conditioned and emits no V0 refs.
        const result = validateV1GenerationResult(
            await existing(safeEnvelope.v1Input, runtime),
            safeEnvelope.v1Input
        );
        return {
            v1Result: result,
            citationRefs: [],
            manifestFingerprint: safeEnvelope.manifest.contextFingerprint,
            contextMode: "ignored-v0",
        };
    };
}

export const createExistingGenerationAdapter = wrapExistingGenerationPort;

function assertCanonicalCitationRefs(
    envelope: ContextGenerationEnvelopeV0,
    refs: readonly ContextSourceRefV0[]
) {
    const allowed = eligibleCitationRefs(envelope);
    const keys = refs.map(ref =>
        ref &&
        typeof ref === "object" &&
        typeof ref.kind === "string" &&
        typeof ref.id === "string" &&
        typeof ref.version === "string" &&
        Object.keys(ref).every(key => key === "kind" || key === "id" || key === "version")
            ? contextSourceKeyV0(ref)
            : ""
    );
    const duplicate = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (duplicate.length)
        fail("Generation result contains duplicate canonical citations.", 403, [
            issue("duplicate_citation", [...new Set(duplicate)].join(", "), 403),
        ]);
    const unknownKeys = keys.filter(key => !key || !allowed.has(key));
    if (unknownKeys.length)
        fail("Generation result contains an unregistered canonical citation.", 403, [
            issue("unregistered_citation", unknownKeys.join(", "), 403),
        ]);
}

export function createContextAwareGenerationAdapter(
    generator: (
        envelope: ContextGenerationEnvelopeV0,
        runtime: GenerationRuntime
    ) => Promise<ContextAwareGenerationResponseV0>
): ContextGenerationPortV0 {
    return async (envelope, runtime) => {
        const safeEnvelope = immutableEnvelope(envelope);
        assertEnvelopeBinding(safeEnvelope);
        const response = await generator(safeEnvelope, runtime);
        const result = validateV1GenerationResult(
            isContextAwareSidecar(response) ? response.v1Result : response,
            safeEnvelope.v1Input
        );
        const refs = assertV1CitationsRegistered(result, safeEnvelope.v1Input);
        const canonicalRefs = isContextAwareSidecar(response)
            ? response.citationRefs
            : resolveLegacyV1CitationRefs(safeEnvelope, refs);
        assertCanonicalCitationRefs(safeEnvelope, canonicalRefs);
        return {
            v1Result: result,
            citationRefs: canonicalRefs,
            manifestFingerprint: safeEnvelope.manifest.contextFingerprint,
            contextMode: "aware-v0",
        };
    };
}

export async function commitContextGeneration<T>(
    input: GuardedCommitInputV0,
    currentState: ContextPipelinePortsV0["server"],
    commit: GuardedCommitPortV0<T>
): Promise<T> {
    const safeEnvelope = immutableEnvelope(input.envelope);
    const safeGenerated = deepFreeze(structuredClone(input.generated));
    assertEnvelopeBinding(safeEnvelope);
    const validated = assertGeneratedResultBinding(safeEnvelope, safeGenerated);
    const guardedInput: GuardedCommitInputV0 =
        validated === safeGenerated.v1Result
            ? { envelope: safeEnvelope, generated: safeGenerated }
            : { envelope: safeEnvelope, generated: { ...safeGenerated, v1Result: validated } };
    return commit.run(async transaction => {
        const current = await currentState.currentState({
            actor: guardedInput.envelope.manifest.actor,
            sourceRefs: guardedInput.envelope.evidenceSnapshot.entries.map(entry => entry.source),
            transaction,
        });
        assertFreezeCurrent(guardedInput.envelope.freeze, current);
        return commit.persist(transaction, guardedInput);
    });
}

export const guardedCommit = commitContextGeneration;
