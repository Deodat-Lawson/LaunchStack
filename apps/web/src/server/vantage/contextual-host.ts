/** Authenticated contextual host. No model, embedding or research transport is registered here. */
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { GENERATION_PROMPT_VERSION_V2 } from "../../../../../pipelines/src/vantage/experiments/decision-generation-v2";
import { normalizeGenerationV2 } from "../../../../../pipelines/src/vantage/validate-generation-v2";
import {
    evaluateFinanceMilestoneReport,
    financeMilestoneOutputSize,
} from "../../../../../pipelines/src/vantage/experiments/finance-milestone-v1";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";
import { sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import { document, documentSections } from "@launchstack/store/schema";
import { toRows } from "@launchstack/store/client";
import {
    reportPeriod,
    VantageError,
    vantageEvidence,
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
import type {
    DemoReport,
    DemoSource,
    DemoState,
    DemoTopicReview,
} from "~/app/employer/tools/vantage/demo-contract";

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
export interface ContextualSavedPayload {
    schema: "contextual-finance/v1";
    owner: string;
    company: string;
    report: DemoReport;
    envelope: ContextGenerationEnvelopeV0;
    authority: string;
    semanticAssessment: unknown;
    executionPolicy?: { id: string; admission: unknown };
    sources: TrustedContextSourceV0[];
    reviews: { actor: string; at: string; topicId: string; version: number }[];
}
export interface ContextualReportRow {
    id: string;
    company_id: string;
    owner_user_id: string;
    week_start: string;
    version: number;
    ciphertext: string;
    key_version: number;
}
export interface PreparedContextualReport {
    envelope: ContextGenerationEnvelopeV0;
    context: ContextPipelineOutputV0;
    records: TrustedContextSourceV0[];
    authority: string;
    baseline?: unknown;
    nativeSourceBindings?: { alias: string; ref: TrustedContextSourceV0["source"] }[];
    roleContext: BusinessRoleContextV0;
    sourceRefs: {
        finance: TrustedContextSourceV0["source"];
        sales: TrustedContextSourceV0["source"];
    };
}
export interface ContextualHostPolicyInput {
    prepared: PreparedContextualReport;
    generated: ContextGenerationResultV0;
    report: DemoReport;
    compound: unknown;
    normalized: ReturnType<typeof normalizeGenerationV2>;
    admission: unknown;
}
/** Trusted server composition only: never construct these functions from request fields. */
export interface ContextualHostPolicy {
    id: string;
    fullSourceMetadataBinding?: boolean;
    strictRoleMapping?: boolean;
    assertNative(input: ContextualHostPolicyInput): void;
    assess(input: ContextualHostPolicyInput): unknown;
    assertExecution(input: ContextualHostPolicyInput): void;
    assertCommit?(
        input: ContextualHostPolicyInput,
        transaction: CompanyArchitectureTransactionV0
    ): Promise<void>;
}
export interface ContextualPersistenceStrategy {
    captureBaseline(
        reader: Pick<CompanyArchitectureTransactionV0, "execute">,
        ctx: WorkspaceContext,
        weekStart: string
    ): Promise<unknown>;
    read(
        reader: Pick<CompanyArchitectureTransactionV0, "execute">,
        ctx: WorkspaceContext,
        selector: { weekStart?: string; reportId?: string }
    ): Promise<ContextualReportRow | null>;
    persist(
        transaction: CompanyArchitectureTransactionV0,
        input: {
            ctx: WorkspaceContext;
            report: DemoReport;
            sealed: ReturnType<typeof encryptSecret>;
            expectedBaseline: unknown;
        }
    ): Promise<void>;
    review(
        transaction: CompanyArchitectureTransactionV0,
        input: {
            ctx: WorkspaceContext;
            reportId: string;
            expectedVersion: number;
            nextVersion: number;
            sealed: ReturnType<typeof encryptSecret>;
        }
    ): Promise<boolean>;
}
type Dependencies = {
    database?: typeof db;
    resolveWorkspace?: typeof requireWorkspaceContext;
    now?: () => Date;
    policy?: ContextualHostPolicy;
    persistence?: ContextualPersistenceStrategy;
};

export function createContextualHost(deps: Dependencies = {}) {
    const database = deps.database ?? db;
    const resolveWorkspace = deps.resolveWorkspace ?? requireWorkspaceContext;
    // Domain time is distinct from authentication time; injected only by the isolated host.
    const now = deps.now ?? (() => new Date());
    const architecture = createCompanyArchitectureAdapterV0({ database, resolveWorkspace, now });
    const captures = new WeakMap<
        PreparedContextualReport,
        { architecture: CapturedCompanyArchitectureV0; ctx: WorkspaceContext; baseline?: unknown }
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
            sql`LOCK TABLE pdr_ai_v2_vantage_contextual_inventory, pdr_ai_v2_vantage_contextual_architecture_review, pdr_ai_v2_vantage_document_stars, ${documentSections}, ${vantageEvidence} IN SHARE MODE`
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
            deps.policy?.strictRoleMapping &&
            session.state.roles &&
            session.persistedRoleMappingVersion !== roleDirectoryV0().mapVersion
        )
            fail("stale_role_mapping");
        const roleContext = resolveRoleSelectionV0({
            principalRef: ctx.authUserId,
            values: session.state.roles?.roleIds ?? [],
            primaryRoleId: session.state.roles?.primaryRoleId,
            confirmed: session.state.roles !== null,
        });
        if (
            requireReview &&
            (!roleContext.userConfirmed || roleContext.primaryRoleId !== "founder")
        )
            fail("confirmed_primary_required");
        const records: TrustedContextSourceV0[] = [];
        const documentHeads: unknown[] = [];
        for (const item of inventory) {
            const read = await session.readDocument(
                String(item.document_id),
                captured.reportWindow.asOf
            );
            if (read.status !== "allowed") fail("source_unavailable", 403);
            const entry = read.entry;
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
        const nativeSourceBindings: { alias: string; ref: TrustedContextSourceV0["source"] }[] = [];
        for (const item of inventory.filter(
            item => item.logical_key === "finance" || item.logical_key === "sales"
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
            nativeSourceBindings.push({
                alias: `ev:${row.id}`,
                ref: structuredClone(record.source),
            });
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
        const stableSourceRecords = records.map(record => {
            const { checkedAt: _observedAt, ...identity } = record;
            void _observedAt;
            return identity;
        });
        const stamp = digest({
            architecture: captured.snapshotFingerprint,
            personal: session.state,
            personalActorAclDigest: session.actor.aclDigest,
            roles: roleContext,
            inventory,
            review,
            sourceHashes: records.map(r => [r.source, r.contentHash]),
            ...(deps.policy?.fullSourceMetadataBinding ? { stableSourceRecords } : {}),
            nativeRows,
            documentHeads,
        });
        return {
            session,
            inventory,
            review,
            roleContext,
            records,
            stamp,
            permissions,
            nativeEvidence,
            nativeSourceBindings,
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
        const period = reportPeriod(now(), "2026-10-12");
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
    ): Promise<PreparedContextualReport> {
        const ctx = await auth(),
            period = reportPeriod(now(), input.weekStart ?? "2026-10-12");
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
                    metadata: a.records.map(record => ({
                        source: record.source,
                        title: `Document ${record.source.id}`,
                        changedAt: record.sourceDate,
                        roleIds: ["founder"],
                        topics: ["revenue", "finance"],
                    })),
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
        // Source classification is frozen by database inventory, not inferred from model citation use.
        const financeId = a.inventory.find(i => i.logical_key === "finance")?.document_id,
            salesId = a.inventory.find(i => i.logical_key === "sales")?.document_id;
        const finance = a.records.find(r => r.source.id === financeId),
            sales = a.records.find(r => r.source.id === salesId);
        if (!finance || !sales || finance === sales) fail("finance_sources_missing");
        const baseline = deps.persistence
            ? await deps.persistence.captureBaseline(database, ctx, period.weekStart)
            : undefined;
        const prepared = {
            ...(deps.persistence ? { baseline } : {}),
            ...(deps.policy ? { nativeSourceBindings: a.nativeSourceBindings } : {}),
            envelope: {
                v1Input,
                manifest: context.manifest,
                evidenceSnapshot: context.evidenceSnapshot,
                freeze: context.freeze,
            },
            context,
            records,
            authority: a.stamp,
            roleContext: a.roleContext,
            sourceRefs: { finance: finance.source, sales: sales.source },
        };
        immutable(prepared);
        captures.set(prepared, { architecture: captured, ctx, baseline });
        return prepared;
    }
    async function fresh<T>(
        prepared: PreparedContextualReport,
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
        if (deps.persistence) return deps.persistence.read(tx, ctx, selector);
        const rows = toRows<ContextualReportRow>(
            await tx.execute(
                sql`SELECT id::text, company_id::text,owner_user_id::text,week_start::text,version,ciphertext,key_version FROM pdr_ai_v2_vantage_contextual_reports WHERE company_id=${ctx.companyId} AND owner_user_id=${ctx.userPk} AND ${selector.reportId ? sql`id=${selector.reportId}::uuid` : sql`week_start=${selector.weekStart ?? "2026-10-12"}::date`}`
            )
        );
        return rows[0] ?? null;
    }
    function open(row: ContextualReportRow, ctx: WorkspaceContext): ContextualSavedPayload {
        let saved: ContextualSavedPayload;
        try {
            saved = JSON.parse(decryptSecret(row.ciphertext)) as ContextualSavedPayload;
        } catch {
            return fail("report_decryption_failed");
        }
        if (
            saved.schema !== "contextual-finance/v1" ||
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
        prepared: PreparedContextualReport,
        generated: ContextGenerationResultV0,
        report: DemoReport,
        validatedCompound: unknown,
        admission?: unknown
    ) {
        const size = financeMilestoneOutputSize(validatedCompound);
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
        const policyInput: ContextualHostPolicyInput = {
            prepared,
            generated,
            report,
            compound: validatedCompound,
            normalized,
            admission,
        };
        let semantic: unknown;
        if (deps.policy) {
            deps.policy.assertNative(policyInput);
            semantic = await deps.policy.assess(policyInput);
        } else {
            if (
                normalized.native.topics.length ||
                generated.v1Result.draft.topics.length ||
                normalized.native.summary !== generated.v1Result.draft.summary
            )
                fail("native_carrier_binding_invalid");
            const checked = evaluateFinanceMilestoneReport(normalized.report, prepared.sourceRefs);
            if (!checked.passed) fail("contextual_semantic_failed");
            semantic = checked;
        }
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
        if (deps.policy) deps.policy.assertExecution(policyInput);
        else if (
            report.execution.mode !== "replay" ||
            report.execution.modelId !== "offline-finance-milestone-replay" ||
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
            if (!deps.persistence) {
                const row = await readRow(ctx, { weekStart: report.weekStart }, tx);
                if (row) fail("report_already_exists");
            }
            const saved: ContextualSavedPayload = {
                schema: "contextual-finance/v1",
                owner: ctx.authUserId,
                company: String(ctx.companyId),
                report: { ...report, version: 1 },
                envelope: prepared.envelope,
                authority: prepared.authority,
                semanticAssessment: semantic,
                ...(deps.policy ? { executionPolicy: { id: deps.policy.id, admission } } : {}),
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
                        await deps.policy?.assertCommit?.(policyInput, tx);
                        if (deps.persistence) {
                            await deps.persistence.persist(tx, {
                                ctx,
                                report: saved.report,
                                sealed,
                                expectedBaseline: captures.get(prepared)?.baseline,
                            });
                            return saved.report;
                        }
                        const changed = toRows(
                            await tx.execute(
                                sql`INSERT INTO pdr_ai_v2_vantage_contextual_reports(id,company_id,owner_user_id,week_start,version,ciphertext,key_version) VALUES(${report.id}::uuid,${ctx.companyId},${ctx.userPk},${report.weekStart}::date,1,${sealed.ciphertext},${sealed.keyVersion}) ON CONFLICT(company_id,owner_user_id,week_start) DO NOTHING RETURNING id`
                            )
                        );
                        if (!changed.length) fail("report_already_exists");
                        return saved.report;
                    },
                }
            );
        });
    }
    async function load(input: { weekStart?: string; reportId?: string } = {}): Promise<DemoState> {
        const ctx = await auth(),
            row = await readRow(ctx, input),
            week = input.weekStart ?? "2026-10-12";
        if (!row) {
            if (input.reportId) fail("not_found", 404);
            return {
                generationMode: "replay",
                weeks: [{ weekStart: week }],
                selectedWeek: week,
                report: null,
                nativeAgendaId: null,
            };
        }
        const saved = open(row, ctx);
        const prepared = await prepare({ weekStart: saved.report.weekStart });
        if (prepared.authority !== saved.authority) fail("stale_saved_context");
        return {
            generationMode: "replay",
            weeks: [{ weekStart: saved.report.weekStart }],
            selectedWeek: saved.report.weekStart,
            report: saved.report,
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
        const saved = open(row, ctx),
            prepared = await prepare({ weekStart: saved.report.weekStart });
        if (saved.authority !== prepared.authority) fail("stale_saved_context");
        await fresh(prepared, async (tx, actor) => {
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
            if (deps.persistence) {
                const changed = await deps.persistence.review(tx, {
                    ctx: actor,
                    reportId: input.reportId,
                    expectedVersion: input.expectedVersion,
                    nextVersion: saved.report.version,
                    sealed,
                });
                if (!changed) fail("stale_review");
            } else {
                const changed = toRows(
                    await tx.execute(
                        sql`UPDATE pdr_ai_v2_vantage_contextual_reports SET version=${saved.report.version},ciphertext=${sealed.ciphertext},key_version=${sealed.keyVersion},updated_at=now() WHERE id=${input.reportId}::uuid AND company_id=${actor.companyId} AND owner_user_id=${actor.userPk} AND version=${input.expectedVersion} RETURNING id`
                    )
                );
                if (!changed.length) fail("stale_review");
            }
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
                reportWindow: reportPeriod(now(), "2026-10-12"),
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
    return { prepare, commit, load, review, source, reviewArchitecture, architectureState };
}
