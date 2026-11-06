/** Authenticated contextual host. No model, embedding or research transport is registered here. */
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { GENERATION_PROMPT_VERSION_V2 } from "../../../../../pipelines/src/vantage/experiments/decision-generation-v2";
import { normalizeGenerationV2 } from "../../../../../pipelines/src/vantage/validate-generation-v2";
import {
    evaluateRoleMilestoneReport,
    roleMilestoneOutputSize,
    buildRolePairPriorityPlan,
    type RolePairPriorityPlan,
} from "../../../../../pipelines/src/vantage/experiments/role-pair-milestone-v1";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import { document, documentSections } from "@launchstack/store/schema";
import { toRows } from "@launchstack/store/client";
import {
    reportPeriod,
    VantageError,
    vantageEvidence,
    vantageAgendas,
    vantageAgendaTopics,
    vantageCommitments,
    vantageContractState,
    type GenerationInput,
} from "@launchstack/pipelines/vantage";
import {
    assembleContextManifestV0,
    createSourceRegistryV0,
    runDynamicContextV0,
    commitContextGeneration,
    contextSourceKeyV0,
    type ContextCurrentStateV0,
    type ContextGenerationEnvelopeV0,
    type ContextGenerationResultV0,
    type ContextBudgetsV0,
    type TrustedContextSourceV0,
    type ContextPipelineOutputV0,
    type BusinessRoleContextV0,
    type DynamicRetrievalBundleV0,
} from "@launchstack/pipelines/vantage/context-v0";
import {
    createPersonalContextProviderV0,
    resolveRoleSelectionV0,
    roleDirectoryV0,
} from "@launchstack/pipelines/vantage/role-context-v0";
import { requireWorkspaceContext, type WorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import {
    createCompanyArchitectureAdapterV0,
    type CapturedCompanyArchitectureV0,
    type CompanyArchitectureTransactionV0,
} from "./company-architecture";
import { personalContextSession } from "./personal-context-store";
import { extractDemoV2Fields } from "./demo-v2-fields";
import type { DemoSource, DemoTopicReview } from "~/app/employer/tools/vantage/demo-contract";

import roleFixture from "../../../../../fixtures/vantage-role-pair-milestone/sources.json";
import { ROLE_CONTEXTUAL_POLICY, type RoleLogicalKey } from "./role-contextual-policy";
import type {
    RoleSelectionProvenance,
    RoleContextualReport,
    RoleContextualState,
    RoleContextualReportSummary,
} from "~/app/employer/tools/vantage/role-contextual-contract";
type Tx = CompanyArchitectureTransactionV0;
function immutable<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) immutable(child);
        Object.freeze(value);
    }
    return value;
}
const DEFAULT_BUDGETS: ContextBudgetsV0 = {
    maxSources: 12,
    maxExcerptChars: 60000,
    timeoutMs: 5000,
    maxQueries: 6,
    maxTokens: 12000,
};
/** Observation time is not source identity; all remaining trusted registry/content fields are bound. */
const sourceIdentity = (record: TrustedContextSourceV0) => {
    const { checkedAt: _observationTime, ...identity } = record;
    void _observationTime;
    return identity;
};
const digest = (v: unknown): string =>
    createHash("sha256")
        .update(
            JSON.stringify(v, (_key: string, value: unknown): unknown =>
                typeof value === "bigint" ? String(value) : value
            )
        )
        .digest("hex");
function fail(code: string, status = 409): never {
    throw new VantageError(
        "Contextual report is unavailable or changed. Reload before continuing.",
        status,
        code
    );
}
interface InventoryRow {
    document_id: string;
    logical_key: string | null;
    native_evidence_id: string | null;
    required: boolean;
    revision: number;
}
interface ReviewRow {
    revision: number;
    projection_fingerprint: string;
    review_state: "reviewed" | "unknowns-marked";
    reviewed_at: Date;
}
export interface RoleGenerationAudit {
    transportProfile: "role-pair-m2";
    suppliedPromptMessages: { type: string; content: unknown }[];
    attempts: {
        attempt: number;
        stage: string;
        issues: string[];
        promptBytes: number;
        outputTokens?: number;
        warn?: boolean;
    }[];
    priorityPlan: RolePairPriorityPlan;
    compound: unknown;
    promptMessages: { type: string; content: unknown }[];
    outputSize: ReturnType<typeof roleMilestoneOutputSize>;
    invocations: number;
}
interface Saved {
    schema: "contextual-role-pair/v1";
    owner: string;
    company: string;
    report: RoleContextualReport;
    envelope: ContextGenerationEnvelopeV0;
    authority: string;
    sourceAuthority: string;
    roleSelection: RoleSelectionProvenance;
    roleContext: BusinessRoleContextV0;
    sourceSetHash: string;
    historyHash: string;
    contextKey: string;
    ranking: DynamicRetrievalBundleV0;
    generationAudit: RoleGenerationAudit;
    semanticAssessment: ReturnType<typeof evaluateRoleMilestoneReport>;
    sources: TrustedContextSourceV0[];
    reviews: { actor: string; at: string; topicId: string; version: number }[];
}
interface ReportRow {
    id: string;
    company_id: string;
    owner_user_id: string;
    week_start: string;
    version: number;
    ciphertext: string;
    key_version: number;
}
export interface PreparedRoleContextualReport {
    envelope: ContextGenerationEnvelopeV0;
    context: ContextPipelineOutputV0;
    records: TrustedContextSourceV0[];
    authority: string;
    sourceAuthority: string;
    sourceSetHash: string;
    historyHash: string;
    contextKey: string;
    roleSelection: RoleSelectionProvenance;
    roleContext: BusinessRoleContextV0;
    ranking: DynamicRetrievalBundleV0;
    sourceRefs: Record<RoleLogicalKey, TrustedContextSourceV0["source"]>;
}
type Dependencies = {
    database?: typeof db;
    resolveWorkspace?: typeof requireWorkspaceContext;
    now?: () => Date;
};

export function createRoleContextualHost(deps: Dependencies = {}) {
    const database = deps.database ?? db;
    const resolveWorkspace = deps.resolveWorkspace ?? requireWorkspaceContext;
    // Domain time is distinct from authentication time; injected only by the isolated host.
    const now = deps.now ?? (() => new Date());
    const architecture = createCompanyArchitectureAdapterV0({ database, resolveWorkspace, now });
    const captures = new WeakMap<
        PreparedRoleContextualReport,
        { architecture: CapturedCompanyArchitectureV0; ctx: WorkspaceContext }
    >();
    async function auth() {
        const result = await resolveWorkspace();
        if (!result.success) fail("unauthorized", result.response.status);
        const ctx = result.data;
        if (ctx.status !== "active" || !ctx.can("documents.read")) fail("forbidden", 403);
        return ctx;
    }
    async function authorityTables(tx: Tx) {
        await tx.execute(
            sql`LOCK TABLE pdr_ai_v2_vantage_contextual_inventory, pdr_ai_v2_vantage_contextual_architecture_review, pdr_ai_v2_vantage_document_stars, ${documentSections}, ${vantageEvidence}, ${vantageAgendas}, ${vantageAgendaTopics}, ${vantageCommitments}, ${vantageContractState} IN SHARE MODE`
        );
    }
    async function readAuthority(
        ctx: WorkspaceContext,
        captured: CapturedCompanyArchitectureV0,
        tx: Tx,
        requireReview = true
    ) {
        await authorityTables(tx);
        const session = await personalContextSession(ctx, tx);
        const membership = toRows<{ role: string }>(
            await tx.execute(
                sql`SELECT role FROM pdr_ai_v2_user_company_memberships WHERE user_id=${ctx.userPk} AND company_id=${ctx.companyId} AND status='active'`
            )
        )[0];
        if (!membership) fail("actor_changed", 403);
        const permissions = await resolvePermissionsForRole(ctx.companyId, membership.role, tx);
        if (!permissions.has("documents.edit")) fail("write_forbidden", 403);
        if (session.actor.aclDigest !== captured.actor.aclDigest) {
            // Architecture and Joseph use different digest formats. Bind both rather than asserting equality.
            if (
                session.actor.companyId !== captured.actor.companyId ||
                session.actor.principalRef !== captured.actor.principalRef
            )
                fail("actor_changed", 403);
        }
        const inventory = toRows<InventoryRow>(
            await tx.execute(
                sql`SELECT document_id::text, logical_key, native_evidence_id, required, revision FROM pdr_ai_v2_vantage_contextual_inventory WHERE company_id=${ctx.companyId} ORDER BY document_id`
            )
        );
        if (inventory.length > 100 || !inventory.length) fail("inventory_unavailable");
        const review = toRows<ReviewRow>(
            await tx.execute(
                sql`SELECT revision, projection_fingerprint, review_state, reviewed_at FROM pdr_ai_v2_vantage_contextual_architecture_review WHERE company_id=${ctx.companyId}`
            )
        )[0];
        if (
            requireReview &&
            (!review ||
                review.projection_fingerprint !== captured.projection.projectionFingerprint ||
                new Date(review.reviewed_at).getTime() > Date.parse(captured.reportWindow.asOf))
        )
            fail("architecture_review_required");
        if (
            requireReview &&
            session.state.roles &&
            session.persistedRoleMappingVersion !== roleDirectoryV0().mapVersion
        )
            fail("stale_role_mapping");
        const roleContext = resolveRoleSelectionV0({
            principalRef: ctx.authUserId,
            values:
                session.state.roles?.roleIds ??
                session.profileTitle?.split(/\s*(?:\+|,|;|\band\b)\s*/i) ??
                [],
            primaryRoleId: session.state.roles?.primaryRoleId,
            confirmed: session.state.roles !== null,
        });
        if (
            requireReview &&
            session.state.roles &&
            (roleContext.roleIds.length !== ROLE_CONTEXTUAL_POLICY.roleIds.length ||
                ROLE_CONTEXTUAL_POLICY.roleIds.some(id => !roleContext.roleIds.includes(id)) ||
                !roleContext.primaryRoleId ||
                !(ROLE_CONTEXTUAL_POLICY.roleIds as readonly string[]).includes(
                    roleContext.primaryRoleId
                ))
        )
            fail("unsupported_role_condition");
        const roleSelection: RoleSelectionProvenance = {
            roleIds: [...roleContext.roleIds],
            ...(roleContext.primaryRoleId ? { primaryRoleId: roleContext.primaryRoleId } : {}),
            mappingVersion: roleContext.mappingVersion,
            persistedMappingVersion: session.persistedRoleMappingVersion,
            revision: session.state.revision,
            userConfirmed: roleContext.userConfirmed,
            fallback:
                roleContext.fallback || !roleContext.userConfirmed || !roleContext.primaryRoleId,
        };
        const records: TrustedContextSourceV0[] = [];
        const documentHeads: unknown[] = [];
        for (const item of inventory) {
            const read = await session.readDocument(
                String(item.document_id),
                captured.reportWindow.asOf
            );
            if (read.status !== "allowed") fail("source_unavailable", 403);
            const entry = read.entry;
            const expected = roleFixture.documents.find(
                document => document.logicalKey === item.logical_key
            );
            if (!expected || expected.text !== entry.excerpt)
                fail("scenario_source_binding_invalid");
            const heads = await tx
                .select({
                    id: document.id,
                    currentVersionId: document.currentVersionId,
                    updatedAt: document.updatedAt,
                    companyId: document.companyId,
                })
                .from(document)
                .where(
                    sql`${document.id}=${item.document_id} AND ${document.companyId}=${ctx.companyId}`
                );
            if (!heads[0]) fail("source_unavailable", 403);
            documentHeads.push(heads[0]);
            records.push({
                ...entry,
                aclDigest: captured.actor.aclDigest,
                audience: entry.audience,
                content: entry.excerpt,
                contentHash: createHash("sha256").update(entry.excerpt).digest("hex"),
                provenance: {
                    connector: "database-document-sections",
                    locator: `document/${item.document_id}/version/${entry.source.version}`,
                    reason: "Exact version, source cutoff and actor document scope checked in PostgreSQL.",
                },
            });
        }
        // Stars outside finite inventory remain mandatory; never silently omit them.
        for (const star of session.state.stars)
            if (!records.some(r => r.source.id === star.documentId)) {
                const read = await session.readDocument(
                    star.documentId,
                    captured.reportWindow.asOf
                );
                if (read.status !== "allowed") fail("star_unavailable", 403);
                records.push({
                    ...read.entry,
                    aclDigest: captured.actor.aclDigest,
                    content: read.entry.excerpt,
                    contentHash: createHash("sha256").update(read.entry.excerpt).digest("hex"),
                });
            }
        const nativeEvidence: GenerationInput["data"]["currentEvidence"] = [];
        const nativeRows: unknown[] = [];
        for (const item of inventory.filter(
            item => item.logical_key === "D01" || item.logical_key === "D08"
        )) {
            if (!item.native_evidence_id) fail("native_evidence_bridge_missing");
            const rows = await tx
                .select()
                .from(vantageEvidence)
                .where(
                    sql`${vantageEvidence.id}=${item.native_evidence_id} AND ${vantageEvidence.companyId}=${ctx.companyId} AND ${vantageEvidence.createdByUserId}=${ctx.authUserId}`
                );
            const row = rows[0],
                record = records.find(record => record.source.id === item.document_id);
            if (
                !row ||
                !record ||
                row.kind !== "document" ||
                row.visibility !== "private" ||
                row.body !== record.content ||
                row.sourceUrl !==
                    `local://workspace-document/${record.source.id}/version/${record.source.version}` ||
                row.createdAt.getTime() > Date.parse(captured.reportWindow.asOf) ||
                (row.updatedAt && row.updatedAt.getTime() > Date.parse(captured.reportWindow.asOf))
            )
                fail("native_evidence_bridge_invalid");
            nativeRows.push(row);
            nativeEvidence.push({
                id: row.id,
                kind: row.kind,
                title: row.title,
                body: row.body,
                source: row.source,
                sourceUrl: row.sourceUrl,
                observedAt: row.observedAt,
                visibility: row.visibility,
                tags: row.tags,
                createdAt: row.createdAt.toISOString(),
            });
        }
        if (nativeEvidence.length !== 2 || new Set(nativeEvidence.map(row => row.id)).size !== 2)
            fail("native_evidence_bridge_missing");
        if (
            inventory.length !== ROLE_CONTEXTUAL_POLICY.logicalKeys.length ||
            ROLE_CONTEXTUAL_POLICY.logicalKeys.some(
                key => inventory.filter(row => row.logical_key === key).length !== 1
            )
        )
            fail("scenario_inventory_invalid");
        const sourceSetHash = digest(
            [...(captured.projection.record ? [captured.projection.record] : []), ...records].map(
                sourceIdentity
            )
        );
        // D06 is an explicit historical source. No native report is silently added between the paired trials.
        const nativeHistory = await Promise.all([
            tx
                .select()
                .from(vantageAgendas)
                .where(sql`${vantageAgendas.companyId}=${ctx.companyId}`),
            tx
                .select()
                .from(vantageAgendaTopics)
                .where(sql`${vantageAgendaTopics.companyId}=${ctx.companyId}`),
            tx
                .select()
                .from(vantageCommitments)
                .where(sql`${vantageCommitments.companyId}=${ctx.companyId}`),
            tx
                .select()
                .from(vantageContractState)
                .where(sql`${vantageContractState.companyId}=${ctx.companyId}`),
        ]);
        // This fixed M2 condition has only the original D06 historical source, not a native agenda lifecycle.
        if (nativeHistory.some(rows => rows.length)) fail("unsupported_native_history");
        const historyHash = digest({
            nativeHistory,
            reviewedTopics: [],
            previousVantageContext: null,
            pendingHistoricalQuestions: null,
        });
        const sourceAuthority = digest({
            architecture: captured.snapshotFingerprint,
            personalStars: session.state.stars,
            personalActorAclDigest: session.actor.aclDigest,
            inventory,
            review,
            sourceRecords: records.map(sourceIdentity),
            nativeRows,
            documentHeads,
            historyHash,
        });
        const stamp = digest({
            sourceAuthority,
            roleContext,
            roleSelection,
            personalRoles: session.state.roles,
        });
        return {
            session,
            inventory,
            review,
            roleContext,
            roleSelection,
            records,
            stamp,
            sourceAuthority,
            sourceSetHash,
            historyHash,
            permissions,
            nativeEvidence,
        };
    }
    async function reviewArchitecture(input: {
        expectedRevision: number;
        expectedProjectionFingerprint: string;
        state: "reviewed" | "unknowns-marked";
    }) {
        if (
            !Number.isSafeInteger(input.expectedRevision) ||
            input.expectedRevision < 0 ||
            !/^[a-f0-9]{64}$/.test(input.expectedProjectionFingerprint) ||
            !["reviewed", "unknowns-marked"].includes(input.state)
        )
            fail("invalid_review", 400);
        const ctx = await auth();
        if (!ctx.can("settings.manage") || !ctx.can("documents.edit"))
            fail("review_forbidden", 403);
        const period = reportPeriod(now(), ROLE_CONTEXTUAL_POLICY.weekStart);
        const captured = await architecture.capture({
            reportWindow: period,
            budgets: DEFAULT_BUDGETS,
        });
        if (captured.projection.status !== "available") fail("architecture_unavailable");
        if (captured.projection.projectionFingerprint !== input.expectedProjectionFingerprint)
            fail("architecture_projection_changed");
        return architecture.guardedCommit(captured, async tx => {
            // Serialize this company's review CAS; source/ACL locks remain held through the write.
            await tx.execute(
                sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vantage-architecture-review/${ctx.companyId}`},0))`
            );
            const current = await readAuthority(ctx, captured, tx, false);
            if (!current.permissions.has("settings.manage")) fail("review_forbidden", 403);
            const changed = toRows(
                await tx.execute(
                    input.expectedRevision === 0
                        ? sql`INSERT INTO pdr_ai_v2_vantage_contextual_architecture_review(company_id,revision,projection_fingerprint,review_state,reviewer_user_id,reviewed_at) VALUES(${ctx.companyId},1,${captured.projection.projectionFingerprint},${input.state},${ctx.userPk},${now().toISOString()}::timestamptz) ON CONFLICT(company_id) DO NOTHING RETURNING revision`
                        : sql`UPDATE pdr_ai_v2_vantage_contextual_architecture_review SET revision=revision+1,projection_fingerprint=${captured.projection.projectionFingerprint},review_state=${input.state},reviewer_user_id=${ctx.userPk},reviewed_at=${now().toISOString()}::timestamptz WHERE company_id=${ctx.companyId} AND revision=${input.expectedRevision} RETURNING revision`
                )
            );
            if (!changed.length) fail("stale_architecture_review");
            return changed[0];
        });
    }
    async function prepare(
        input: { weekStart?: string; runId?: string } = {}
    ): Promise<PreparedRoleContextualReport> {
        const ctx = await auth(),
            period = reportPeriod(now(), input.weekStart ?? ROLE_CONTEXTUAL_POLICY.weekStart);
        const captured = await architecture.capture({
            reportWindow: period,
            budgets: DEFAULT_BUDGETS,
        });
        if (
            captured.projection.status !== "available" ||
            !captured.projection.record ||
            !captured.projection.requiredEntry
        )
            fail("architecture_unavailable");
        const a = await architecture.guardedCommit(captured, tx =>
            readAuthority(ctx, captured, tx)
        );
        const companyRecord = structuredClone(captured.projection.record);
        const companyRef = {
            ...captured.projection.requiredEntry.source,
            reviewState: a.review!.review_state,
        };
        companyRecord.source = companyRef;
        const records = [companyRecord, ...a.records];
        const starIds = new Set(a.session.state.stars.map(s => s.documentId));
        const roles = createPersonalContextProviderV0({
            resolveAuthenticatedActor: async () => captured.actor,
            store: {
                read: async () => structuredClone(a.session.state),
                compareAndSwap: async () => fail("immutable_preparation"),
            },
            readProfileTitle: async () => a.session.profileTitle,
            now: () => now().toISOString(),
            requiredSources: async () => ({
                companyArchitecture: companyRef,
                workspaceMandatoryDocuments: a.inventory
                    .filter(i => i.required)
                    .map(i => a.records.find(r => r.source.id === String(i.document_id))!.source),
            }),
            readSource: async (_actor, ref) => {
                const record = records.find(
                    r => contextSourceKeyV0(r.source) === contextSourceKeyV0(ref)
                );
                return record
                    ? { status: "allowed" as const, entry: record, constraints: [] }
                    : { status: "missing" as const };
            },
            readDocument: async (_actor, id) => {
                const record = a.records.find(r => r.source.id === id);
                return record
                    ? { status: "allowed" as const, entry: record, constraints: [] }
                    : { status: "missing" as const };
            },
        });
        const roleVersions = {
            ...Object.fromEntries(
                a.roleContext.roleIds.map(id => [id, String(a.session.state.revision)])
            ),
            personal: String(a.session.state.revision),
            authority: a.stamp,
        };
        function state(): ContextCurrentStateV0 {
            return {
                principalRef: ctx.authUserId,
                companyId: String(ctx.companyId),
                actorAclDigest: captured.actor.aclDigest,
                sourceVersions: Object.fromEntries(
                    records.map(r => [contextSourceKeyV0(r.source), r.source.version])
                ),
                sourceFingerprints: Object.fromEntries(
                    records.map(r => [contextSourceKeyV0(r.source), r.contentHash!])
                ),
                sourceAudiences: Object.fromEntries(
                    records.map(r => [contextSourceKeyV0(r.source), JSON.stringify(r.audience)])
                ),
                sourceAccess: Object.fromEntries(
                    records.map(r => [contextSourceKeyV0(r.source), r.access])
                ),
                sourceEntries: records,
                roleMapVersion: a.roleContext.mappingVersion,
                roleProfileVersions: roleVersions,
                companyArchitectureVersion: companyRef.version,
                personalStarVersions: Object.fromEntries(
                    a.records
                        .filter(r => starIds.has(r.source.id))
                        .map(r => [r.source.id, r.source.version])
                ),
            };
        }
        const runId = input.runId ?? randomUUID(),
            inputVersion = digest({ period, authority: a.stamp });
        let ranking: DynamicRetrievalBundleV0 | undefined;
        const context = await runDynamicContextV0(
            {
                principalRef: ctx.authUserId,
                companyId: String(ctx.companyId),
                reportWindow: period,
                budgets: DEFAULT_BUDGETS,
                runId,
                inputVersion,
            },
            {
                roles,
                server: {
                    resolveAuthenticatedActor: async () => captured.actor,
                    sourceCatalog: async () => records,
                    currentState: async () =>
                        architecture.guardedCommit(captured, async tx => {
                            const current = await readAuthority(ctx, captured, tx);
                            if (current.stamp !== a.stamp) fail("stale_context");
                            return state();
                        }),
                },
                assembler: {
                    assemble(value) {
                        ranking = structuredClone(value.retrieval);
                        const registry = createSourceRegistryV0({
                            actor: captured.actor,
                            reportWindow: period,
                            trustedCatalog: records,
                        });
                        if (!registry.ok) fail("registry_invalid");
                        const assembled = assembleContextManifestV0({
                            runId,
                            inputVersion,
                            actor: captured.actor,
                            reportWindow: period,
                            roleContext: value.roleContext,
                            roleProfileVersions: roleVersions,
                            required: value.requiredContext,
                            retrievalInput: value.retrievalInput!,
                            retrieval: value.retrieval,
                            researchPlan: value.researchPlan,
                            researchResult: value.research,
                            registry: registry.registry,
                            budgets: DEFAULT_BUDGETS,
                        });
                        if (!assembled.ok) fail("assembly_invalid");
                        return assembled.value;
                    },
                },
            },
            {
                retrieval: {
                    primaryRolePreference: true,
                    metadata: a.records.map(record => {
                        const item = a.inventory.find(
                            item => item.document_id === record.source.id
                        );
                        const source = roleFixture.documents.find(
                            source => source.logicalKey === item?.logical_key
                        );
                        return {
                            source: record.source,
                            title: source?.title ?? `Document ${record.source.id}`,
                            changedAt: record.sourceDate,
                            roleIds: source?.roleIds ?? [],
                            topics: [],
                        };
                    }),
                },
            }
        );
        const v1Input: GenerationInput = {
            contractVersion: "v1",
            runId,
            inputVersion,
            reportPeriod: period,
            generationMode: "configured-model",
            data: {
                metricDefinitions: [],
                currentEvidence: a.nativeEvidence,
                currentObservations: [],
                comparisonObservations: [],
                resolvedCommitments: [],
                carryForwardCommitments: [],
            },
            reviewedTopics: [],
        };
        if (!ranking) fail("retrieval_trace_unavailable");
        const sourceRefs = Object.fromEntries(
            a.inventory.map(item => [
                item.logical_key,
                a.records.find(record => record.source.id === item.document_id)!.source,
            ])
        ) as Record<RoleLogicalKey, TrustedContextSourceV0["source"]>;
        const contextKey = digest({
            scenarioId: ROLE_CONTEXTUAL_POLICY.id,
            period,
            generationAuthority: a.stamp,
        });
        const prepared = {
            envelope: {
                v1Input,
                manifest: context.manifest,
                evidenceSnapshot: context.evidenceSnapshot,
                freeze: context.freeze,
            },
            context,
            records,
            authority: a.stamp,
            sourceAuthority: a.sourceAuthority,
            sourceSetHash: a.sourceSetHash,
            historyHash: a.historyHash,
            contextKey,
            roleSelection: a.roleSelection,
            roleContext: a.roleContext,
            ranking,
            sourceRefs,
        };
        immutable(prepared);
        captures.set(prepared, { architecture: captured, ctx });
        return prepared;
    }
    async function fresh<T>(
        prepared: PreparedRoleContextualReport,
        work: (tx: Tx, ctx: WorkspaceContext) => Promise<T>
    ) {
        const saved = captures.get(prepared);
        if (!saved) fail("unknown_preparation");
        const ctx = await auth();
        if (ctx.authUserId !== saved.ctx.authUserId || ctx.companyId !== saved.ctx.companyId)
            fail("actor_changed", 403);
        return architecture.guardedCommit(saved.architecture, async tx => {
            const a = await readAuthority(ctx, saved.architecture, tx);
            if (a.stamp !== prepared.authority) fail("stale_context");
            return work(tx, ctx);
        });
    }
    async function readRow(
        ctx: WorkspaceContext,
        selector: { weekStart?: string; reportId?: string },
        tx: Pick<Tx, "execute"> = database
    ) {
        const rows = toRows<ReportRow>(
            await tx.execute(
                sql`SELECT id::text, company_id::text,owner_user_id::text,week_start::text,version,ciphertext,key_version FROM pdr_ai_v2_vantage_role_contextual_runs WHERE company_id=${ctx.companyId} AND owner_user_id=${ctx.userPk} AND scenario_id=${ROLE_CONTEXTUAL_POLICY.id} AND ${selector.reportId ? sql`id=${selector.reportId}::uuid` : sql`week_start=${selector.weekStart ?? ROLE_CONTEXTUAL_POLICY.weekStart}::date`} ORDER BY created_at DESC,id DESC LIMIT 1`
            )
        );
        return rows[0] ?? null;
    }
    function open(row: ReportRow, ctx: WorkspaceContext): Saved {
        let saved: Saved;
        try {
            saved = JSON.parse(decryptSecret(row.ciphertext)) as Saved;
        } catch {
            return fail("report_decryption_failed");
        }
        if (
            saved.schema !== "contextual-role-pair/v1" ||
            saved.owner !== ctx.authUserId ||
            saved.company !== String(ctx.companyId) ||
            saved.report.id !== row.id ||
            saved.report.version !== row.version
        )
            fail("report_binding_invalid");
        extractDemoV2Fields(saved.report);
        return saved;
    }
    async function commit(
        prepared: PreparedRoleContextualReport,
        generated: ContextGenerationResultV0,
        report: RoleContextualReport,
        validatedCompound: unknown,
        generationAudit?: RoleGenerationAudit
    ) {
        const size = roleMilestoneOutputSize(validatedCompound);
        if (size.outputTokens > 2400) fail("compound_output_budget");
        const normalized = normalizeGenerationV2(validatedCompound, prepared.envelope);
        const projected = {
            summary: report.summary,
            headline: report.headline,
            brief: report.brief,
            keyFigures: report.keyFigures,
            topics: report.topics.map(({ id: _id, status, decision, ...topic }) => {
                if (status !== "suggested" || decision !== undefined)
                    fail("generated_review_invalid");
                return topic;
            }),
            origin: "ai",
            enhancements: [],
        };
        if (!isDeepStrictEqual(projected, normalized.report))
            fail("report_content_binding_invalid");
        if (
            !isDeepStrictEqual(
                [...generated.citationRefs].sort((a, b) =>
                    contextSourceKeyV0(a).localeCompare(contextSourceKeyV0(b))
                ),
                [...normalized.refs].sort((a, b) =>
                    contextSourceKeyV0(a).localeCompare(contextSourceKeyV0(b))
                )
            )
        )
            fail("report_citation_binding_invalid");
        if (
            normalized.native.topics.length ||
            generated.v1Result.draft.topics.length ||
            normalized.native.summary !== generated.v1Result.draft.summary
        )
            fail("native_carrier_binding_invalid");
        const semantic = evaluateRoleMilestoneReport(
            normalized.report,
            prepared.sourceRefs,
            prepared.roleContext
        );
        if (!semantic.passed) fail("contextual_semantic_failed");
        const sourceDiagnostics = prepared.records.map(record => ({
            source: record.source,
            title:
                record.source.kind === "company"
                    ? "Company Architecture"
                    : `Document ${record.source.id}`,
            contentHash: record.contentHash!,
        }));
        if (
            report.diagnostics.contextFingerprint !==
                prepared.context.manifest.contextFingerprint ||
            !isDeepStrictEqual(report.diagnostics.sources, sourceDiagnostics) ||
            report.diagnostics.persisted !== true ||
            report.diagnostics.historicalHumanDecisions !== 0
        )
            fail("report_diagnostics_binding_invalid");
        if (
            report.execution.mode !== "replay" ||
            report.execution.modelId !== ROLE_CONTEXTUAL_POLICY.modelId ||
            report.execution.promptVersion !== GENERATION_PROMPT_VERSION_V2 ||
            report.execution.attempts !== 1 ||
            report.execution.fallbackReason !== null ||
            !Number.isFinite(report.execution.durationMs) ||
            report.execution.durationMs < 0
        )
            fail("report_execution_binding_invalid");
        if (
            report.id.length > 80 ||
            report.weekStart !== prepared.envelope.v1Input.reportPeriod.weekStart
        )
            fail("report_binding_invalid");
        return fresh(prepared, async (tx, ctx) => {
            if (
                !isDeepStrictEqual(report.roleSelection, prepared.roleSelection) ||
                report.sourceSetHash !== prepared.sourceSetHash ||
                report.historyHash !== prepared.historyHash ||
                report.contextKey !== prepared.contextKey
            )
                fail("report_role_binding_invalid");
            if (
                !generationAudit ||
                generationAudit.transportProfile !== "role-pair-m2" ||
                generationAudit.invocations !== 1 ||
                generationAudit.attempts.length !== 1 ||
                generationAudit.attempts.some(
                    attempt => attempt.issues.length > 0 || attempt.promptBytes > 23500
                ) ||
                !generationAudit.promptMessages.length ||
                !generationAudit.suppliedPromptMessages.length ||
                Buffer.byteLength(
                    JSON.stringify(generationAudit.promptMessages.map(message => message.content)),
                    "utf8"
                ) !== generationAudit.attempts[0]?.promptBytes ||
                !isDeepStrictEqual(generationAudit.compound, validatedCompound) ||
                !isDeepStrictEqual(generationAudit.outputSize, size) ||
                !isDeepStrictEqual(
                    generationAudit.priorityPlan,
                    buildRolePairPriorityPlan({
                        envelope: prepared.envelope,
                        sourceRefs: prepared.sourceRefs,
                        roleContext: prepared.roleContext,
                        ranking: prepared.ranking,
                    })
                )
            )
                fail("generation_audit_binding_invalid");
            const trustedPrimary = prepared.roleContext.roles.find(
                role => role.roleId === prepared.roleContext.primaryRoleId
            );
            const expectedWireRole =
                generationAudit.priorityPlan.persona === "mapped" && trustedPrimary
                    ? {
                          primaryRoleId: trustedPrimary.roleId,
                          mappingVersion: prepared.roleContext.mappingVersion,
                          description: trustedPrimary.description,
                          responsibilities: trustedPrimary.responsibilities,
                          priorities: trustedPrimary.priorities,
                      }
                    : {
                          primaryRoleId: null,
                          mappingVersion: prepared.envelope.manifest.roleMapVersion,
                          fallback: true,
                          responsibilities: [],
                          priorities: [],
                      };
            const roleMessages = generationAudit.promptMessages.filter(
                message =>
                    message.type === "system" &&
                    typeof message.content === "string" &&
                    message.content.startsWith("M2 trustedPrimary=")
            );
            if (roleMessages.length !== 1) fail("generation_role_wire_invalid");
            let wireRole: unknown;
            try {
                wireRole = JSON.parse(
                    (roleMessages[0]!.content as string)
                        .split("\n", 1)[0]!
                        .slice("M2 trustedPrimary=".length)
                );
            } catch {
                fail("generation_role_wire_invalid");
            }
            if (!isDeepStrictEqual(wireRole, expectedWireRole))
                fail("generation_role_wire_invalid");
            const saved: Saved = {
                schema: "contextual-role-pair/v1",
                owner: ctx.authUserId,
                company: String(ctx.companyId),
                report: { ...report, version: 1 },
                envelope: prepared.envelope,
                authority: prepared.authority,
                sourceAuthority: prepared.sourceAuthority,
                roleSelection: prepared.roleSelection,
                roleContext: prepared.roleContext,
                sourceSetHash: prepared.sourceSetHash,
                historyHash: prepared.historyHash,
                contextKey: prepared.contextKey,
                ranking: prepared.ranking,
                generationAudit,
                semanticAssessment: semantic,
                sources: prepared.records,
                reviews: [],
            };
            const body = JSON.stringify(saved);
            if (Buffer.byteLength(body) > 750000) fail("report_budget");
            const sealed = encryptSecret(body);
            // Validate the exact frozen generated carrier and citations before the single write.
            return commitContextGeneration(
                { envelope: prepared.envelope, generated },
                {
                    resolveAuthenticatedActor: async () => prepared.context.manifest.actor,
                    sourceCatalog: async () => prepared.records,
                    currentState: async () => ({
                        principalRef: ctx.authUserId,
                        companyId: String(ctx.companyId),
                        actorAclDigest: prepared.envelope.freeze.actorACL.aclDigest,
                        sourceVersions: Object.fromEntries(
                            prepared.records.map(r => [
                                contextSourceKeyV0(r.source),
                                r.source.version,
                            ])
                        ),
                        sourceFingerprints: Object.fromEntries(
                            prepared.records.map(r => [
                                contextSourceKeyV0(r.source),
                                r.contentHash!,
                            ])
                        ),
                        sourceAudiences: Object.fromEntries(
                            prepared.records.map(r => [
                                contextSourceKeyV0(r.source),
                                JSON.stringify(r.audience),
                            ])
                        ),
                        sourceAccess: Object.fromEntries(
                            prepared.records.map(r => [contextSourceKeyV0(r.source), r.access])
                        ),
                        sourceEntries: prepared.records,
                        roleMapVersion: prepared.envelope.freeze.roleMapVersion,
                        roleProfileVersions: { ...prepared.envelope.freeze.roleProfileVersions },
                        companyArchitectureVersion:
                            prepared.envelope.freeze.companyArchitecture.ref.version,
                        personalStarVersions: Object.fromEntries(
                            prepared.envelope.freeze.personalStars.map(s => [
                                s.ref.id,
                                s.ref.version,
                            ])
                        ),
                    }),
                },
                {
                    run: async cb => cb(tx as unknown as Record<string, unknown>),
                    persist: async () => {
                        const changed = toRows(
                            await tx.execute(
                                sql`INSERT INTO pdr_ai_v2_vantage_role_contextual_runs(id,company_id,owner_user_id,week_start,scenario_id,context_key,source_authority,version,ciphertext,key_version) VALUES(${report.id}::uuid,${ctx.companyId},${ctx.userPk},${report.weekStart}::date,${ROLE_CONTEXTUAL_POLICY.id},${prepared.contextKey},${prepared.sourceAuthority},1,${sealed.ciphertext},${sealed.keyVersion}) ON CONFLICT(company_id,owner_user_id,week_start,scenario_id,context_key) DO NOTHING RETURNING id`
                            )
                        );
                        if (!changed.length) fail("report_already_exists");
                        return saved.report;
                    },
                }
            );
        });
    }
    async function assertSavedSourceAuthority(saved: Saved, ctx: WorkspaceContext) {
        const captured = await architecture.capture({
            reportWindow: saved.envelope.v1Input.reportPeriod,
            budgets: DEFAULT_BUDGETS,
        });
        await architecture.guardedCommit(captured, async tx => {
            const current = await readAuthority(ctx, captured, tx, false);
            if (current.sourceAuthority !== saved.sourceAuthority) fail("stale_saved_context");
        });
    }
    async function listReports(input: { weekStart?: string } = {}) {
        const ctx = await auth();
        const rows = toRows<ReportRow>(
            await database.execute(
                sql`SELECT id::text,company_id::text,owner_user_id::text,week_start::text,version,ciphertext,key_version FROM pdr_ai_v2_vantage_role_contextual_runs WHERE company_id=${ctx.companyId} AND owner_user_id=${ctx.userPk} AND scenario_id=${ROLE_CONTEXTUAL_POLICY.id} AND week_start=${input.weekStart ?? ROLE_CONTEXTUAL_POLICY.weekStart}::date ORDER BY created_at DESC,id DESC`
            )
        );
        const values: RoleContextualReportSummary[] = [];
        for (const row of rows) {
            const saved = open(row, ctx);
            await assertSavedSourceAuthority(saved, ctx);
            values.push({
                id: saved.report.id,
                weekStart: saved.report.weekStart,
                version: saved.report.version,
                generatedAt: saved.report.generatedAt,
                roleSelection: saved.roleSelection,
                sourceSetHash: saved.sourceSetHash,
                historyHash: saved.historyHash,
                contextKey: saved.contextKey,
            });
        }
        return values;
    }
    async function load(
        input: { weekStart?: string; reportId?: string } = {}
    ): Promise<RoleContextualState> {
        const ctx = await auth(),
            row = await readRow(ctx, input),
            week = input.weekStart ?? ROLE_CONTEXTUAL_POLICY.weekStart;
        if (!row) {
            if (input.reportId) fail("not_found", 404);
            return {
                generationMode: "replay",
                weeks: [{ weekStart: week }],
                selectedWeek: week,
                report: null,
                reports: [],
                nativeAgendaId: null,
            };
        }
        const saved = open(row, ctx);
        await assertSavedSourceAuthority(saved, ctx);
        return {
            generationMode: "replay",
            weeks: [{ weekStart: saved.report.weekStart }],
            selectedWeek: saved.report.weekStart,
            report: saved.report,
            reports: await listReports({ weekStart: saved.report.weekStart }),
            nativeAgendaId: null,
        };
    }
    async function review(input: DemoTopicReview) {
        if (
            !Number.isSafeInteger(input.expectedVersion) ||
            input.expectedVersion < 1 ||
            (!input.status && !input.decision) ||
            (input.decision &&
                !["go", "no-go", "needs-more-evidence"].includes(input.decision.value)) ||
            (input.decision?.text && input.decision.text.length > 1000)
        )
            fail("invalid_review", 400);
        const ctx = await auth(),
            row = await readRow(ctx, { reportId: input.reportId });
        if (!row) fail("not_found", 404);
        const saved = open(row, ctx);
        const captured = await architecture.capture({
            reportWindow: saved.envelope.v1Input.reportPeriod,
            budgets: DEFAULT_BUDGETS,
        });
        await architecture.guardedCommit(captured, async tx => {
            const current = await readAuthority(ctx, captured, tx, false);
            if (saved.sourceAuthority !== current.sourceAuthority) fail("stale_saved_context");
            const actor = ctx;
            if (saved.report.version !== input.expectedVersion) fail("stale_review");
            const topic = saved.report.topics.find(t => t.id === input.topicId);
            if (!topic) fail("not_found", 404);
            if (input.status) {
                if (!["kept", "dismissed"].includes(input.status)) fail("invalid_review", 400);
                topic.status = input.status;
            }
            if (input.decision)
                topic.decision = { ...input.decision, recordedAt: now().toISOString() };
            saved.report.version++;
            saved.reviews.push({
                actor: actor.authUserId,
                at: now().toISOString(),
                topicId: topic.id,
                version: saved.report.version,
            });
            const reviewBody = JSON.stringify(saved);
            if (Buffer.byteLength(reviewBody) > 750000) fail("report_budget");
            const sealed = encryptSecret(reviewBody);
            const changed = toRows(
                await tx.execute(
                    sql`UPDATE pdr_ai_v2_vantage_role_contextual_runs SET version=${saved.report.version},ciphertext=${sealed.ciphertext},key_version=${sealed.keyVersion},updated_at=now() WHERE id=${input.reportId}::uuid AND company_id=${actor.companyId} AND owner_user_id=${actor.userPk} AND version=${input.expectedVersion} RETURNING id`
                )
            );
            if (!changed.length) fail("stale_review");
        });
        return load({ reportId: input.reportId });
    }
    async function source(
        reportId: string,
        ref: TrustedContextSourceV0["source"]
    ): Promise<DemoSource> {
        const state = await load({ reportId });
        const ctx = await auth(),
            row = await readRow(ctx, { reportId });
        if (!row || !state.report) fail("not_found", 404);
        const record = open(row, ctx).sources.find(
            r => contextSourceKeyV0(r.source) === contextSourceKeyV0(ref)
        );
        if (!record) fail("not_found", 404);
        return {
            title:
                record.source.kind === "company"
                    ? "Company Architecture"
                    : `Document ${record.source.id}`,
            body: record.content ?? record.excerpt,
            source: record.source,
            sourceDate: record.sourceDate,
            contentHash: record.contentHash!,
            authority: "Exact frozen source; current membership and document scope rechecked.",
        };
    }
    async function architectureState() {
        const ctx = await auth(),
            captured = await architecture.capture({
                reportWindow: reportPeriod(now(), ROLE_CONTEXTUAL_POLICY.weekStart),
                budgets: DEFAULT_BUDGETS,
            });
        const review = toRows<ReviewRow>(
            await database.execute(
                sql`SELECT revision,projection_fingerprint,review_state,reviewed_at FROM pdr_ai_v2_vantage_contextual_architecture_review WHERE company_id=${ctx.companyId}`
            )
        )[0];
        return {
            revision: review?.revision ?? 0,
            state:
                review?.projection_fingerprint === captured.projection.projectionFingerprint
                    ? review.review_state
                    : "unreviewed",
            projectionFingerprint: captured.projection.projectionFingerprint,
            available: captured.projection.status === "available",
            projection: {
                status: captured.projection.status,
                facts: captured.projection.record?.content
                    ? (
                          JSON.parse(captured.projection.record.content) as {
                              facts: {
                                  path: string;
                                  label: string;
                                  value: string;
                                  basis: string;
                                  subject?: string;
                                  sources: {
                                      documentId: string;
                                      versionId: string | null;
                                      quote: string | null;
                                  }[];
                              }[];
                          }
                      ).facts
                    : [],
                unknowns: captured.projection.unknowns,
                includedFactPaths: captured.projection.includedFactPaths,
                omittedFactCount: captured.projection.omittedFactCount,
            },
        };
    }
    return {
        prepare,
        commit,
        load,
        listReports,
        review,
        source,
        reviewArchitecture,
        architectureState,
    };
}
