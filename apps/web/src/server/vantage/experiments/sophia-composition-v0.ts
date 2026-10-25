/** Opt-in synthetic experiment only. No routes, model calls, embedding calls or production saves. */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { company, document, documentVersions } from "@launchstack/store/schema";
import { getDb, toRows } from "@launchstack/store/client";
import {
    generationSnapshot,
    vantageEvidence,
    vantageMetricDefinitions,
    vantageMetricObservations,
    vantageAgendas,
    vantageAgendaTopics,
    vantageCommitments,
    vantageContractState,
    type GenerationInput,
} from "@launchstack/pipelines/vantage";
import {
    assembleContextManifestV0,
    contextSourceKeyV0,
    createSourceRegistryV0,
    commitContextGeneration,
    runDynamicContextV0,
    type BusinessRoleContextV0,
    type ContextBudgetsV0,
    type ContextCurrentStateV0,
    type ContextPipelineOutputV0,
    type ContextReportWindowV0,
    type ContextScopeV0,
    type ContextSourceRefV0,
    type RequiredContextBundleV0,
    type RetrievalMetadataV0,
    type RetrievalSearchPortV0,
    type TrustedContextSourceV0,
    type GuardedCommitInputV0,
    type ContextTransactionV0,
} from "@launchstack/pipelines/vantage/context-v0";
import { resolveDocumentScope, scopedDocumentWhere, scopeAllows } from "~/lib/authz/scope";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import {
    createCompanyArchitectureAdapterV0,
    type CapturedCompanyArchitectureV0,
    type CompanyArchitectureTransactionV0,
} from "../company-architecture";

export const SOPHIA_SYNTHETIC_COMPANY_PREFIX = "Vantage Sophia synthetic ";
export const SOPHIA_SYNTHETIC_DOCUMENT_PREFIX = "vantage-sophia-synthetic/";
const MAX_DOCUMENTS = 128;
type Reader = Pick<typeof db, "select" | "execute">;
type Dependencies = Parameters<typeof createCompanyArchitectureAdapterV0>[0] & {
    syntheticOnly?: true;
    resolveJosephFixture?: () => Promise<
        Pick<SophiaCompositionRequestV0, "roleContext" | "roleProfileVersions" | "starDocumentIds">
    >;
};
export interface SophiaCompositionRequestV0 {
    runId: string;
    inputVersion: string;
    nativeInput: GenerationInput;
    expectedReportFingerprint: string;
    reportWindow: ContextReportWindowV0;
    budgets: ContextBudgetsV0;
    documentIds: readonly string[];
    starDocumentIds: readonly string[];
    roleContext: BusinessRoleContextV0;
    roleProfileVersions: Readonly<Record<string, string>>;
}
export interface PreparedSophiaCompositionV0 {
    syntheticOnly: true;
    actor: ContextScopeV0;
    context: ContextPipelineOutputV0;
    sourceRecords: readonly TrustedContextSourceV0[];
    optionalUnavailableCount: number;
    sourceSnapshotFingerprint: string;
}
export class SophiaCompositionErrorV0 extends Error {
    constructor(
        readonly code: string,
        readonly status: 400 | 403 | 409 | 503
    ) {
        super("Synthetic Sophia composition is unavailable or changed.");
        this.name = "SophiaCompositionErrorV0";
    }
}
function fail(code: string, status: SophiaCompositionErrorV0["status"]): never {
    throw new SophiaCompositionErrorV0(code, status);
}
const object = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
function stable(value: unknown): string {
    if (value === undefined || value === null) return "null";
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (typeof value === "object")
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const textHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
function sourceIds(values: readonly string[]) {
    if (
        values.length > MAX_DOCUMENTS ||
        values.some(id => !/^[1-9]\d*$/.test(id) || BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER))
    )
        fail("invalid_source_ids", 400);
    return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
}
function requireSyntheticEnvironment() {
    const raw = process.env.VANTAGE_TL_TEST_DATABASE_URL;
    if (process.env.VANTAGE_TL_TEST_MODE !== "true" || !raw) fail("synthetic_only", 503);
    let target: URL;
    try {
        target = new URL(raw);
    } catch {
        return fail("synthetic_only", 503);
    }
    if (
        !["postgres:", "postgresql:"].includes(target.protocol) ||
        target.hostname !== "127.0.0.1" ||
        target.port !== "55437" ||
        target.pathname !== "/vantage_week2_tl_contract_v1"
    )
        fail("synthetic_only", 503);
}
export async function assertSophiaSyntheticDatabaseV0(reader: Reader) {
    requireSyntheticEnvironment();
    const identity = toRows<{ name: string }>(
        await reader.execute(sql`SELECT current_database() AS name`)
    );
    if (identity[0]?.name !== "vantage_week2_tl_contract_v1") fail("synthetic_only", 503);
}

/** Only server-owned synthetic fixtures may instantiate this experiment. */
export function createSophiaCompositionExperimentV0(deps: Dependencies = {}) {
    const database = deps.database ?? db;
    const resolveWorkspace = deps.resolveWorkspace ?? requireWorkspaceContext;
    const resolveScope = deps.resolveScope ?? resolveDocumentScope;
    const now = deps.now ?? (() => new Date());
    const architecture = createCompanyArchitectureAdapterV0(deps);
    const captures = new WeakMap<
        PreparedSophiaCompositionV0,
        {
            architecture: CapturedCompanyArchitectureV0;
            request: SophiaCompositionRequestV0;
            catalogFingerprint: string;
            records: readonly TrustedContextSourceV0[];
        }
    >();
    const transactionTokens = new WeakMap<ContextTransactionV0, CompanyArchitectureTransactionV0>();

    async function readCatalog(
        request: SophiaCompositionRequestV0,
        actor: ContextScopeV0,
        reader: Reader = database
    ) {
        if (deps.syntheticOnly !== true) fail("synthetic_only", 503);
        // generationSnapshot uses this global client; table locks below protect its
        // pool reads only when it is the exact configured synthetic client.
        if (getDb() !== database) fail("synthetic_database_binding", 503);
        await assertSophiaSyntheticDatabaseV0(reader);
        const auth = await resolveWorkspace();
        if (
            !auth.success ||
            auth.data.status !== "active" ||
            !auth.data.can("documents.read") ||
            auth.data.authUserId !== actor.principalRef ||
            String(auth.data.companyId) !== actor.companyId
        )
            fail("actor_scope", 403);
        const ctx = auth.data;
        if (BigInt(actor.companyId) > BigInt(Number.MAX_SAFE_INTEGER)) fail("actor_scope", 403);
        const owner = await reader
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(actor.companyId)))
            .limit(1);
        if (!owner[0]?.name.startsWith(SOPHIA_SYNTHETIC_COMPANY_PREFIX))
            fail("synthetic_only", 503);
        const scope = await resolveScope({
            companyId: ctx.companyId,
            userPk: ctx.userPk,
            role: ctx.role,
            permissions: new Set(ctx.permissions),
        });
        const rows = request.documentIds.length
            ? await reader
                  .select({
                      id: sql<string>`${document.id}::text`,
                      companyId: sql<string>`${document.companyId}::text`,
                      title: sql<string>`left(${document.title}, 301)`,
                      category: document.category,
                      creationKey: document.creationKey,
                      currentVersionId: sql<string | null>`${document.currentVersionId}::text`,
                      updatedAt: document.updatedAt,
                      versionId: sql<string | null>`${documentVersions.id}::text`,
                      versionDocumentId: sql<string | null>`${documentVersions.documentId}::text`,
                      versionNumber: documentVersions.versionNumber,
                      versionCreatedAt: documentVersions.createdAt,
                      metadata: sql<unknown>`CASE WHEN octet_length(${documentVersions.ocrMetadata}::text) <= 65536 THEN ${documentVersions.ocrMetadata} ELSE NULL END`,
                  })
                  .from(document)
                  .leftJoin(documentVersions, eq(documentVersions.id, document.currentVersionId))
                  .where(
                      and(
                          inArray(document.id, request.documentIds.map(Number)),
                          scopedDocumentWhere(ctx.companyId, scope)
                      )
                  )
                  .orderBy(asc(document.id))
            : [];
        const records: TrustedContextSourceV0[] = [],
            metadata: RetrievalMetadataV0[] = [];
        const stars = new Set(request.starDocumentIds);
        const contentStates: unknown[] = [];
        for (const row of rows) {
            const raw = object(row.metadata),
                fixture = object(raw?.vantageSynthetic);
            const text = raw?.text;
            if (
                !scopeAllows(scope, { id: BigInt(row.id), category: row.category }) ||
                !row.creationKey?.startsWith(SOPHIA_SYNTHETIC_DOCUMENT_PREFIX) ||
                row.companyId !== actor.companyId ||
                row.versionDocumentId !== row.id ||
                row.currentVersionId !== row.versionId ||
                !row.versionCreatedAt ||
                row.versionCreatedAt.getTime() > Date.parse(request.reportWindow.asOf) ||
                (row.updatedAt &&
                    row.updatedAt.getTime() > Date.parse(request.reportWindow.asOf)) ||
                row.title.length > 300 ||
                typeof text !== "string" ||
                !text.trim() ||
                text.length > 12000 ||
                !fixture
            )
                continue;
            const source: ContextSourceRefV0 = {
                kind: "doc",
                id: `workspace-document/${row.id}`,
                version: row.versionId!,
            };
            const entry: TrustedContextSourceV0 = {
                source,
                companyId: actor.companyId,
                access: "allowed",
                aclDigest: actor.aclDigest,
                audience: stars.has(row.id)
                    ? { kind: "actor", principalRef: actor.principalRef }
                    : { kind: "company", companyId: actor.companyId },
                sourceDate: row.versionCreatedAt.toISOString(),
                checkedAt: now().toISOString(),
                excerpt: text,
                content: text,
                contentHash: textHash(text),
                provenance: {
                    connector: "synthetic-workspace-document",
                    locator: row.creationKey,
                    reason: `Explicit native version and actor ACL checked; nativeMetadataSha256=${hash(row)}.`,
                },
            };
            records.push(entry);
            // Fixture state is explicit, not inferred from pending questions, human review or silence.
            metadata.push({
                source,
                title: row.title,
                changedAt: row.versionCreatedAt.toISOString(),
                ...(fixture.roleIds ? { roleIds: fixture.roleIds as string[] } : {}),
                ...(fixture.topics ? { topics: fixture.topics as string[] } : {}),
                ...(fixture.ownerPrincipalRefs
                    ? { ownerPrincipalRefs: fixture.ownerPrincipalRefs as string[] }
                    : {}),
                ...(fixture.state ? { state: fixture.state as RetrievalMetadataV0["state"] } : {}),
                ...(fixture.origin
                    ? { origin: fixture.origin as RetrievalMetadataV0["origin"] }
                    : {}),
            });
            contentStates.push(row);
        }
        if (
            request.starDocumentIds.some(
                id => !records.some(record => record.source.id === `workspace-document/${id}`)
            )
        )
            fail("required_star_unavailable", 403);
        return {
            records,
            metadata,
            unavailableCount: request.documentIds.length - records.length,
            fingerprint: hash({
                actor,
                identity: {
                    userPk: String(ctx.userPk),
                    role: ctx.role,
                    status: ctx.status,
                    permissions: [...ctx.permissions].sort(),
                    scope,
                },
                rows: contentStates,
                requested: request.documentIds,
                stars: request.starDocumentIds,
            }),
        };
    }
    function currentState(
        request: SophiaCompositionRequestV0,
        actor: ContextScopeV0,
        records: readonly TrustedContextSourceV0[]
    ): ContextCurrentStateV0 {
        return {
            principalRef: actor.principalRef,
            companyId: actor.companyId,
            actorAclDigest: actor.aclDigest,
            sourceVersions: Object.fromEntries(
                records.map(record => [contextSourceKeyV0(record.source), record.source.version])
            ),
            sourceFingerprints: Object.fromEntries(
                records.map(record => [contextSourceKeyV0(record.source), record.contentHash!])
            ),
            sourceAudiences: Object.fromEntries(
                records.map(record => [
                    contextSourceKeyV0(record.source),
                    JSON.stringify(record.audience),
                ])
            ),
            sourceAccess: Object.fromEntries(
                records.map(record => [contextSourceKeyV0(record.source), record.access])
            ),
            sourceEntries: structuredClone([...records]),
            roleMapVersion: request.roleContext.mappingVersion,
            roleProfileVersions: structuredClone(request.roleProfileVersions),
            companyArchitectureVersion: records.find(record => record.source.kind === "company")!
                .source.version,
            personalStarVersions: Object.fromEntries(
                records
                    .filter(record => record.audience.kind === "actor")
                    .map(record => [record.source.id, record.source.version])
            ),
        };
    }
    async function prepare(
        raw: SophiaCompositionRequestV0,
        options: { search?: RetrievalSearchPortV0 } = {}
    ): Promise<PreparedSophiaCompositionV0> {
        if (deps.syntheticOnly !== true) fail("synthetic_only", 503);
        requireSyntheticEnvironment();
        const request = freeze({
            ...structuredClone(raw),
            documentIds: sourceIds(raw.documentIds),
            starDocumentIds: sourceIds(raw.starDocumentIds),
        });
        if (
            request.nativeInput.runId !== request.runId ||
            request.nativeInput.inputVersion !== request.inputVersion ||
            !request.expectedReportFingerprint ||
            request.nativeInput.reportPeriod.startInclusive !==
                request.reportWindow.startInclusive ||
            request.nativeInput.reportPeriod.endExclusive !== request.reportWindow.endExclusive ||
            request.nativeInput.reportPeriod.asOf !== request.reportWindow.asOf
        )
            fail("native_input_binding", 400);
        if (request.starDocumentIds.some(id => !request.documentIds.includes(id)))
            fail("invalid_star_ids", 400);
        const captured = await architecture.capture({
            reportWindow: request.reportWindow,
            budgets: request.budgets,
        });
        if (
            captured.projection.status !== "available" ||
            !captured.projection.requiredEntry ||
            !captured.projection.record
        )
            fail("required_architecture_unavailable", 503);
        await assertFixtureFresh(request);
        const catalog = await architecture.guardedCommit(captured, transaction =>
            readCatalog(request, captured.actor, transaction)
        );
        const records = [captured.projection.record, ...catalog.records];
        const starRecords = catalog.records.filter(record => record.audience.kind === "actor");
        const required: RequiredContextBundleV0 = {
            contractVersion: "v0-proposed",
            actor: captured.actor,
            asOf: request.reportWindow.asOf,
            companyArchitecture: captured.projection.requiredEntry,
            workspaceMandatoryDocuments: [],
            personalVantageStars: starRecords.map(record => ({
                ...record,
                module: "vantage",
                required: true,
            })),
            constraints: [
                "Synthetic Joseph role/star test ports; not production role or mandatory-document discovery.",
                "Historical/pending questions do not supply authoritative open state.",
            ],
            coverage: {
                checked: [
                    captured.projection.requiredEntry.source,
                    ...starRecords.map(record => record.source),
                ],
                used: [
                    captured.projection.requiredEntry.source,
                    ...starRecords.map(record => record.source),
                ],
                missing: [],
                revoked: [],
                omitted: [],
            },
            status: "complete",
        };
        async function fresh(): Promise<{
            actor: ContextScopeV0;
            records: TrustedContextSourceV0[];
        }> {
            return architecture.guardedCommit(captured, async transaction => {
                const native = await readCatalog(request, captured.actor, transaction);
                await assertFixtureFresh(request);
                if (native.fingerprint !== catalog.fingerprint) fail("stale_optional_sources", 409);
                return {
                    actor: captured.actor,
                    records: [captured.projection.record!, ...native.records],
                };
            });
        }
        const context = await runDynamicContextV0(
            {
                principalRef: captured.actor.principalRef,
                companyId: captured.actor.companyId,
                reportWindow: request.reportWindow,
                budgets: request.budgets,
                runId: request.runId,
                inputVersion: request.inputVersion,
            },
            {
                roles: {
                    resolveBusinessRoles: async () =>
                        (await assertFixtureFresh(request)).roleContext,
                    resolveRequiredContext: async () => {
                        await assertFixtureFresh(request);
                        return structuredClone(required);
                    },
                },
                server: {
                    resolveAuthenticatedActor: async () =>
                        (await architecture.assertFresh(captured)).actor,
                    sourceCatalog: async () => structuredClone(records),
                    currentState: async ({ sourceRefs }) => {
                        const next = await fresh();
                        if (
                            sourceRefs.some(
                                ref =>
                                    !next.records.some(
                                        record =>
                                            contextSourceKeyV0(record.source) ===
                                            contextSourceKeyV0(ref)
                                    )
                            )
                        )
                            fail("source_version_changed", 409);
                        return currentState(request, next.actor, next.records);
                    },
                },
                assembler: {
                    assemble(input) {
                        const registry = createSourceRegistryV0({
                            actor: captured.actor,
                            reportWindow: request.reportWindow,
                            trustedCatalog: records,
                        });
                        if (!registry.ok) fail("registry_rejected", 409);
                        const assembled = assembleContextManifestV0({
                            runId: input.runId,
                            inputVersion: input.inputVersion,
                            actor: captured.actor,
                            reportWindow: input.reportWindow,
                            roleContext: input.roleContext,
                            roleProfileVersions: request.roleProfileVersions,
                            required: input.requiredContext,
                            retrievalInput: input.retrievalInput!,
                            retrieval: input.retrieval,
                            researchPlan: input.researchPlan,
                            researchResult: input.research,
                            registry: registry.registry,
                            budgets: input.budgets,
                        });
                        if (!assembled.ok) fail("assembly_rejected", 409);
                        return assembled.value;
                    },
                },
            },
            { retrieval: { metadata: catalog.metadata, search: options.search } }
        );
        const prepared = freeze({
            syntheticOnly: true as const,
            actor: captured.actor,
            context,
            sourceRecords: structuredClone(records),
            optionalUnavailableCount: catalog.unavailableCount,
            sourceSnapshotFingerprint: hash({
                architecture: captured.snapshotFingerprint,
                catalog: catalog.fingerprint,
                fixture: fixtureState(request),
            }),
        });
        captures.set(prepared, {
            architecture: captured,
            request,
            catalogFingerprint: catalog.fingerprint,
            records,
        });
        return prepared;
    }
    function privateCapture(prepared: PreparedSophiaCompositionV0) {
        return captures.get(prepared) ?? fail("unrecognized_preparation", 409);
    }
    function fixtureState(request: SophiaCompositionRequestV0) {
        return {
            roleContext: request.roleContext,
            roleProfileVersions: request.roleProfileVersions,
            starDocumentIds: sourceIds(request.starDocumentIds),
        };
    }
    async function assertFixtureFresh(request: SophiaCompositionRequestV0) {
        if (!deps.resolveJosephFixture) fail("synthetic_fixture_port_required", 503);
        const resolved = structuredClone(await deps.resolveJosephFixture());
        resolved.starDocumentIds = sourceIds(resolved.starDocumentIds);
        if (hash(resolved) !== hash(fixtureState(request)))
            fail("role_or_star_fixture_changed", 409);
        return freeze(resolved);
    }
    async function assertFresh(prepared: PreparedSophiaCompositionV0) {
        const saved = privateCapture(prepared);
        await architecture.guardedCommit(saved.architecture, async transaction => {
            const native = await readCatalog(saved.request, prepared.actor, transaction);
            await assertFixtureFresh(saved.request);
            if (native.fingerprint !== saved.catalogFingerprint)
                fail("stale_optional_sources", 409);
        });
        return prepared;
    }
    async function guardedCommit<T = { syntheticOnly: true; contextFingerprint: string }>(
        prepared: PreparedSophiaCompositionV0,
        persist?: (transaction: CompanyArchitectureTransactionV0) => Promise<T>
    ): Promise<T | { syntheticOnly: true; contextFingerprint: string }> {
        const saved = privateCapture(prepared);
        return architecture.guardedCommit(saved.architecture, async transaction => {
            const native = await readCatalog(saved.request, prepared.actor, transaction);
            await assertFixtureFresh(saved.request);
            if (native.fingerprint !== saved.catalogFingerprint)
                fail("stale_optional_sources", 409);
            const result = persist
                ? await persist(transaction)
                : {
                      syntheticOnly: true as const,
                      contextFingerprint: prepared.context.manifest.contextFingerprint,
                  };
            await assertFixtureFresh(saved.request);
            return result;
        });
    }
    async function commitGenerated<T = { syntheticOnly: true; contextFingerprint: string }>(
        prepared: PreparedSophiaCompositionV0,
        binding: GuardedCommitInputV0,
        persist?: (
            transaction: CompanyArchitectureTransactionV0,
            input: GuardedCommitInputV0
        ) => Promise<T>
    ) {
        const saved = privateCapture(prepared);
        if (
            hash(binding.envelope.v1Input) !== hash(saved.request.nativeInput) ||
            hash(binding.envelope.manifest) !== hash(prepared.context.manifest) ||
            hash(binding.envelope.evidenceSnapshot) !== hash(prepared.context.evidenceSnapshot) ||
            hash(binding.envelope.freeze) !== hash(prepared.context.freeze)
        )
            fail("generated_context_binding", 409);
        const transactionFor = (token: ContextTransactionV0 | undefined) =>
            token
                ? (transactionTokens.get(token) ?? fail("unsupported_transaction", 503))
                : fail("unsupported_transaction", 503);
        return commitContextGeneration<T | { syntheticOnly: true; contextFingerprint: string }>(
            binding,
            {
                resolveAuthenticatedActor: async () => prepared.actor,
                sourceCatalog: async () => structuredClone([...prepared.sourceRecords]),
                currentState: async ({ actor, transaction }) => {
                    const nativeTransaction = transactionFor(transaction);
                    if (hash(actor) !== hash(prepared.actor)) fail("actor_scope", 403);
                    await nativeTransaction.execute(
                        sql`LOCK TABLE ${vantageEvidence}, ${vantageMetricDefinitions}, ${vantageMetricObservations}, ${vantageAgendas}, ${vantageAgendaTopics}, ${vantageCommitments}, ${vantageContractState} IN SHARE MODE`
                    );
                    const current = await generationSnapshot(
                        BigInt(prepared.actor.companyId),
                        saved.request.nativeInput.reportPeriod,
                        saved.request.nativeInput.generationMode,
                        { actorId: prepared.actor.principalRef }
                    );
                    if (
                        current.input.inputVersion !== saved.request.inputVersion ||
                        current.expectedReportFingerprint !==
                            saved.request.expectedReportFingerprint ||
                        hash({ ...current.input, runId: saved.request.nativeInput.runId }) !==
                            hash(saved.request.nativeInput)
                    )
                        fail("stale_native_input", 409);
                    const native = await readCatalog(
                        saved.request,
                        prepared.actor,
                        nativeTransaction
                    );
                    await assertFixtureFresh(saved.request);
                    if (native.fingerprint !== saved.catalogFingerprint)
                        fail("stale_optional_sources", 409);
                    return currentState(saved.request, prepared.actor, [
                        saved.architecture.projection.record!,
                        ...native.records,
                    ]);
                },
            },
            {
                run: callback =>
                    architecture.guardedCommit(saved.architecture, async nativeTransaction => {
                        const token = Object.freeze({ syntheticSophiaTransaction: true });
                        transactionTokens.set(token, nativeTransaction);
                        try {
                            return await callback(token);
                        } finally {
                            transactionTokens.delete(token);
                        }
                    }),
                persist: async (token, input) => {
                    const nativeTransaction = transactionFor(token);
                    await assertFixtureFresh(saved.request);
                    const result = persist
                        ? await persist(nativeTransaction, input)
                        : {
                              syntheticOnly: true as const,
                              contextFingerprint: prepared.context.manifest.contextFingerprint,
                          };
                    await assertFixtureFresh(saved.request);
                    return result;
                },
            }
        );
    }
    return { prepare, assertFresh, guardedCommit, commitGenerated };
}
