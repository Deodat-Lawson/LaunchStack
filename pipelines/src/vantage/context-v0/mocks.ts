import { createHash } from "node:crypto";
import type { GenerationResult } from "../contract-v1";
import type {
    ContextManifestV0,
    ContextResearchResultV0,
    ContextSourceEntryV0,
    ContextSourceRefV0,
    DynamicRetrievalBundleV0,
    DynamicRetrievalInputV0,
    RequiredContextBundleV0,
    BusinessRoleContextV0,
} from "../proposals/context-v0";
import { createContextAwareGenerationAdapter } from "./adapters";
import type { freezeFromState } from "./adapters";
import type {
    ContextAssemblerPortV0,
    ContextAssemblyOutputV0,
    ContextCurrentStateV0,
    ContextGenerationEnvelopeV0,
    ContextGenerationPortV0,
    ContextPipelinePortsV0,
    ContextTransactionV0,
    GenerationRuntime,
    GuardedCommitPortV0,
    RoleContextPortV0,
    ServerContextPortV0,
} from "./ports";
import { assembleContextManifestV0 } from "./assembler";
import { createSourceRegistryV0 } from "./registry";
import type { TrustedContextSourceV0 } from "./contracts";

const clone = <T>(value: T): T => structuredClone(value);

export interface FixtureV0Overrides {
    roleContext?: BusinessRoleContextV0;
    requiredContext?: RequiredContextBundleV0;
    sourceCatalog?: ContextSourceEntryV0[];
    retrieval?: DynamicRetrievalBundleV0;
    research?: ContextResearchResultV0;
    manifest?: ContextManifestV0;
    currentState?: ContextCurrentStateV0;
    trustedCatalog?: TrustedContextSourceV0[];
}

/** Test-owned fixture data; production source does not read repository JSON. */
export interface FixtureV0Input {
    roleContext: BusinessRoleContextV0;
    requiredBundle: RequiredContextBundleV0;
    retrievalBundle: DynamicRetrievalBundleV0;
    researchResult: ContextResearchResultV0;
    manifest: ContextManifestV0;
    retrievalInput: { sourceCatalog: ContextSourceEntryV0[] };
}

function trustedFixtureCatalog(entries: readonly ContextSourceEntryV0[]): TrustedContextSourceV0[] {
    return entries.map(entry => ({
        ...clone(entry),
        content: entry.excerpt,
        provenance: {
            connector: "fixture",
            locator: entry.source.id,
            retrievedAt: entry.checkedAt,
        },
        ...(entry.source.kind === "public" && entry.source.id === "public-market-report"
            ? {
                  citation: {
                      title: "Public market report",
                      url: "https://example.test/public-market-report",
                      sourceDate: "2026-10-18T00:00:00Z",
                      accessedAt: "2026-10-19T11:45:00Z",
                      provenance: "approved-public-provider",
                  },
              }
            : {}),
    }));
}

function buildFixtureAssembly(
    input: Parameters<ContextAssemblerPortV0["assemble"]>[0],
    currentState: ContextCurrentStateV0,
    catalog: ContextSourceEntryV0[],
    trustedCatalog: TrustedContextSourceV0[]
) {
    // Research cannot mint trusted source records. Public fixture sources are
    // supplied by the fixture server catalog below, exactly like production
    // server-owned catalog data.
    const registryResult = createSourceRegistryV0({
        actor: input.requiredContext.actor,
        reportWindow: input.reportWindow,
        trustedCatalog,
    });
    if (!registryResult.ok)
        throw new Error(`Fixture registry failed: ${registryResult.issues[0]?.message}`);
    const roleProfiles = Object.fromEntries(
        input.roleContext.roleIds.map(roleId => [
            roleId,
            currentState.roleProfileVersions[roleId] ?? "fixture-profile-v1",
        ])
    );
    const retrievalInput: DynamicRetrievalInputV0 = input.retrievalInput ?? {
        contractVersion: "v0-proposed",
        actor: input.requiredContext.actor,
        verifiedRoleContext: input.roleContext,
        reportWindow: input.reportWindow,
        sourceCatalog: catalog,
        budgets: input.budgets,
    };
    const assembled = assembleContextManifestV0({
        runId: input.runId,
        inputVersion: input.inputVersion,
        actor: input.requiredContext.actor,
        reportWindow: input.reportWindow,
        roleContext: input.roleContext,
        roleProfileVersions: roleProfiles,
        required: input.requiredContext,
        retrievalInput,
        retrieval: input.retrieval,
        researchPlan: input.researchPlan,
        researchResult: input.research,
        registry: registryResult.registry,
        budgets: input.budgets,
        trustedPublicProjections: input.trustedPublicProjections,
    });
    if (!assembled.ok) throw new Error(`Fixture assembler failed: ${assembled.issues[0]?.message}`);
    return assembled.value;
}

export function createFixtureV0Ports(
    fixtureInput: FixtureV0Input,
    overrides: FixtureV0Overrides = {}
): ContextPipelinePortsV0 & {
    fixture: {
        roleContext: BusinessRoleContextV0;
        requiredContext: RequiredContextBundleV0;
        retrieval: DynamicRetrievalBundleV0;
        research: ContextResearchResultV0;
        manifest: ContextManifestV0;
    };
} {
    const fixture = {
        roleContext: clone(overrides.roleContext ?? fixtureInput.roleContext),
        requiredContext: clone(overrides.requiredContext ?? fixtureInput.requiredBundle),
        retrieval: clone(overrides.retrieval ?? fixtureInput.retrievalBundle),
        research: clone(overrides.research ?? fixtureInput.researchResult),
        manifest: clone(overrides.manifest ?? fixtureInput.manifest),
    };
    const catalog = clone(
        overrides.sourceCatalog ?? [
            ...fixtureInput.retrievalInput.sourceCatalog,
            ...fixtureInput.manifest.sourceRegistry.filter(entry => entry.source.kind === "public"),
        ]
    );
    const trustedCatalog = clone(overrides.trustedCatalog ?? trustedFixtureCatalog(catalog));
    const defaultState: ContextCurrentStateV0 = {
        actorAclDigest: fixture.requiredContext.actor.aclDigest,
        principalRef: fixture.requiredContext.actor.principalRef,
        companyId: fixture.requiredContext.actor.companyId,
        sourceVersions: clone(fixture.manifest.sourceVersions),
        sourceFingerprints: Object.fromEntries(
            fixture.manifest.sourceRegistry.map(entry => [
                `${entry.source.kind}:${entry.source.id}@${entry.source.version}`,
                createHash("sha256").update(entry.excerpt, "utf8").digest("hex"),
            ])
        ),
        sourceAudiences: Object.fromEntries(
            catalog.map(entry => [
                `${entry.source.kind}:${entry.source.id}@${entry.source.version}`,
                JSON.stringify(entry.audience),
            ])
        ),
        sourceAccess: Object.fromEntries(
            catalog.map(entry => [
                `${entry.source.kind}:${entry.source.id}@${entry.source.version}`,
                entry.access,
            ])
        ),
        sourceEntries: clone(catalog),
        roleMapVersion: fixture.manifest.roleMapVersion,
        roleProfileVersions: Object.fromEntries(
            fixture.roleContext.roleIds.map(roleId => [
                roleId,
                fixture.manifest.roleProfileVersions[roleId] ?? "fixture-profile-v1",
            ])
        ),
        companyArchitectureVersion: fixture.manifest.companyArchitectureVersion,
        personalStarVersions: clone(fixture.manifest.personalStarVersions),
    };
    const currentState = clone(overrides.currentState ?? defaultState);
    const roles: RoleContextPortV0 = {
        async resolveBusinessRoles() {
            return clone(fixture.roleContext);
        },
        async resolveRequiredContext() {
            return clone(fixture.requiredContext);
        },
    };
    const server: ServerContextPortV0 = {
        async resolveAuthenticatedActor() {
            return clone(fixture.requiredContext.actor);
        },
        async sourceCatalog() {
            return clone(catalog);
        },
        async currentState() {
            return clone(currentState);
        },
    };
    const assembler: ContextAssemblerPortV0 = {
        assemble(input) {
            return buildFixtureAssembly(input, currentState, catalog, trustedCatalog);
        },
    };
    return {
        roles,
        server,
        retrieval: {
            async retrieve() {
                return clone(fixture.retrieval);
            },
        },
        assembler,
        research: {
            async research() {
                return clone(fixture.research);
            },
        },
        fixture,
    };
}

export interface MockTransactionBoundary extends GuardedCommitPortV0<unknown> {
    persistCalls: number;
    runCalls: number;
    transactionToken: ContextTransactionV0;
    persistTransaction?: ContextTransactionV0;
    events: string[];
}

export function createMockTransaction<T = unknown>(
    value?: T
): GuardedCommitPortV0<T> & {
    persistCalls: number;
    runCalls: number;
    transactionToken: ContextTransactionV0;
    persistTransaction?: ContextTransactionV0;
    events: string[];
} {
    let persistCalls = 0;
    let runCalls = 0;
    const transactionToken: ContextTransactionV0 = { fixtureTransaction: "v0-fixture-transaction" };
    const events: string[] = [];
    let persistTransaction: ContextTransactionV0 | undefined;
    return {
        get persistCalls() {
            return persistCalls;
        },
        get runCalls() {
            return runCalls;
        },
        transactionToken,
        get persistTransaction() {
            return persistTransaction;
        },
        events,
        async run(callback) {
            runCalls++;
            events.push("run");
            return callback(transactionToken);
        },
        async persist(transaction, _input) {
            if (transaction !== transactionToken)
                throw new Error("Fixture persistence escaped its transaction boundary.");
            persistCalls++;
            persistTransaction = transaction;
            events.push("persist");
            return value as T;
        },
    };
}

/** A context-aware fixture generator with no model, ranking or network behavior. */
export function createMockContextAwareGenerator(
    fixtureResult: GenerationResult,
    citationRefs: ContextSourceRefV0[] = []
): ContextGenerationPortV0 {
    return createContextAwareGenerationAdapter(async envelope => {
        // Read the exact input to make accidental v1 transformations observable
        // in tests; the fixture result remains deterministic.
        void envelope.v1Input;
        return { v1Result: clone(fixtureResult), citationRefs: clone(citationRefs) };
    });
}

export function createMockExistingGenerationPort(fixtureResult: GenerationResult) {
    return async (_input: ContextGenerationEnvelopeV0["v1Input"], _runtime: GenerationRuntime) =>
        clone(fixtureResult);
}

export function createMockEnvelope(
    output: ContextAssemblyOutputV0,
    freeze: ReturnType<typeof freezeFromState>,
    v1Input: ContextGenerationEnvelopeV0["v1Input"]
): ContextGenerationEnvelopeV0 {
    return {
        v1Input,
        manifest: output.manifest,
        evidenceSnapshot: output.evidenceSnapshot,
        freeze,
    };
}
