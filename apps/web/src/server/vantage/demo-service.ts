/** Development-only synthetic UI adapter. Importing it never changes the V1 generator. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
    StructuredAttemptSetupError,
    structuredSchemaInstruction,
    systemMessageFor,
} from "@launchstack/llm";
import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";
import { company } from "@launchstack/store/schema";
import {
    generationSnapshot,
    reportPeriod,
    vantageAgendas,
    VantageError,
    type GenerationRuntime,
} from "@launchstack/pipelines/vantage";
import {
    contextSourceKeyV0,
    type BusinessRoleContextV0,
    type ContextGenerationEnvelopeV0,
    type TrustedContextSourceV0,
} from "@launchstack/pipelines/vantage/context-v0";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { resolveConfiguredChatModel } from "~/lib/models";
import { getEngine } from "~/server/engine";
import { canUseVantage } from "./access";
import { captureDemoGeneration } from "./demo-capture";
import {
    createSophiaCompositionExperimentV0,
    SOPHIA_SYNTHETIC_COMPANY_PREFIX,
    type SophiaCompositionRequestV0,
} from "./experiments/sophia-composition-v0";
import { createSophiaContextGenerationExperimentV0 } from "../../../../../pipelines/src/vantage/experiments/sophia-generation-v0";
import type {
    DemoReport,
    DemoSource,
    DemoSourceRef,
    DemoState,
    DemoTopicReview,
} from "~/app/employer/tools/vantage/demo-contract";

export const DEMO_METADATA_KEY = "vantageContextDemoV1";
const MAX_PAYLOAD_BYTES = 750000;
const MAX_HISTORY = 8;
const id = z
    .string()
    .regex(/^[1-9]\d*$/)
    .max(16);
const weekSchema = z
    .object({
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        asOf: z.string().datetime(),
        label: z.string().max(120).optional(),
    })
    .strict();
const descriptorSchema = z
    .object({
        schemaVersion: z.literal("vantage-context-demo/v1"),
        fixtureId: z.string().min(1).max(120),
        companyId: id,
        actorId: z.string().min(1).max(256),
        documentIds: z.array(id).max(128),
        starDocumentIds: z.array(id).max(128),
        roleContext: z.custom<BusinessRoleContextV0>(value => !!value && typeof value === "object"),
        roleProfileVersions: z.record(z.string().min(1).max(256)),
        weeks: z.array(weekSchema).min(1).max(12),
    })
    .strict();
export type VantageDemoDescriptor = z.infer<typeof descriptorSchema>;
type Generator = ReturnType<typeof createSophiaContextGenerationExperimentV0>;
type Generated = Awaited<ReturnType<Generator>>;
type MetadataRow = typeof vantageAgendas.$inferSelect;
interface SavedRun {
    actorId: string;
    companyId: string;
    report: DemoReport;
    window: SophiaCompositionRequestV0["reportWindow"];
    sources: { source: DemoSourceRef; contentHash: string }[];
    nativeInputFingerprint: string;
}
interface SavedPayload {
    schemaVersion: "vantage-context-demo/v1";
    version: number;
    active: SavedRun;
    history: SavedRun[];
}
interface CipherEnvelope {
    schemaVersion: "encrypted-vantage-context-demo/v1";
    version: number;
    ciphertext: string;
    keyVersion: number;
}
type Dependencies = {
    database?: ReturnType<typeof getEngine>["db"];
    loadDescriptor?: () => Promise<unknown>;
    generate?: Generator;
    resolveModel?: GenerationRuntime["resolveModel"];
};
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nativeInputFingerprint = (value: ContextGenerationEnvelopeV0["v1Input"]) =>
    sha({ ...value, runId: "" });
const sourceTitle = (source: DemoSourceRef, title?: string) =>
    title ??
    (source.kind === "company"
        ? "Company Architecture"
        : `Workspace document ${source.id.replace(/^workspace-document\//, "")}`);
function fail(message: string, status: number, code: string): never {
    throw new VantageError(message, status, code);
}
export function assertVantageContextDemoEnabled() {
    if (
        process.env.NODE_ENV !== "development" ||
        process.env.VANTAGE_CONTEXT_DEMO_ENABLED !== "true"
    )
        fail("Not found.", 404, "not_found");
    const raw = process.env.DATABASE_URL;
    if (
        !raw ||
        raw !== process.env.VANTAGE_TL_TEST_DATABASE_URL ||
        process.env.VANTAGE_TL_TEST_MODE !== "true"
    )
        fail("The isolated demonstration database is unavailable.", 503, "demo_unavailable");
    const target = new URL(raw);
    if (
        target.hostname !== "127.0.0.1" ||
        target.port !== "55437" ||
        target.pathname !== "/vantage_week2_tl_contract_v1"
    )
        fail("The isolated demonstration database is unavailable.", 503, "demo_unavailable");
}
async function readDescriptor(): Promise<unknown> {
    const file = process.env.VANTAGE_CONTEXT_DEMO_FIXTURE;
    const ignoredRoots = [
        resolve(process.cwd(), "test-output"),
        resolve(process.cwd(), "../../test-output"),
    ];
    if (
        !file ||
        !isAbsolute(file) ||
        !ignoredRoots.some(root => resolve(file).startsWith(root + sep))
    )
        fail("The local synthetic fixture is not configured.", 503, "demo_unavailable");
    const body = await readFile(file, "utf8");
    if (Buffer.byteLength(body) > 1000000)
        fail("The local synthetic fixture exceeds its budget.", 503, "demo_unavailable");
    return JSON.parse(body) as unknown;
}
function openPayload(row: MetadataRow): SavedPayload | null {
    const envelope = row.modelMetadata?.[DEMO_METADATA_KEY] as CipherEnvelope | undefined;
    if (!envelope) return null;
    if (
        envelope.schemaVersion !== "encrypted-vantage-context-demo/v1" ||
        !Number.isSafeInteger(envelope.version) ||
        !envelope.ciphertext
    )
        fail("The saved demonstration report cannot be opened.", 409, "demo_payload_unavailable");
    let payload: SavedPayload;
    try {
        payload = JSON.parse(decryptSecret(envelope.ciphertext)) as SavedPayload;
    } catch {
        return fail(
            "The saved demonstration report cannot be opened.",
            409,
            "demo_payload_unavailable"
        );
    }
    if (
        payload.schemaVersion !== "vantage-context-demo/v1" ||
        payload.version !== envelope.version ||
        payload.active.report.id !== row.id ||
        payload.active.companyId !== String(row.companyId)
    )
        fail(
            "The saved demonstration report does not match this workspace.",
            409,
            "demo_payload_unavailable"
        );
    return payload;
}
function sealPayload(payload: SavedPayload): CipherEnvelope {
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text) > MAX_PAYLOAD_BYTES || payload.history.length > MAX_HISTORY)
        fail(
            "The local report history budget is full; existing reviews were retained.",
            409,
            "demo_history_full"
        );
    return {
        schemaVersion: "encrypted-vantage-context-demo/v1",
        version: payload.version,
        ...encryptSecret(text),
    };
}
export function createVantageContextDemoService(deps: Dependencies = {}) {
    const database = () => deps.database ?? getEngine().db;
    const resolveDemoModel = () => {
        const model = (
            deps.resolveModel ??
            (() =>
                resolveConfiguredChatModel({
                    route: "default",
                    reasoningControl: { enabled: true, effort: "none" },
                }))
        )();
        if (
            !model ||
            model.modelId !== "gpt-6-luna" ||
            (!deps.generate && model.reasoning.requestPatch.reasoning_effort !== "none")
        )
            fail(
                "The approved synthetic model and explicit none reasoning effort are unavailable.",
                503,
                "demo_model_unavailable"
            );
        return model;
    };
    async function authorized() {
        assertVantageContextDemoEnabled();
        const auth = await requireWorkspaceContext();
        if (!auth.success)
            fail(
                "Sign in to the synthetic demonstration workspace.",
                auth.response.status,
                "unauthorized"
            );
        if (!canUseVantage(auth.data))
            fail("This demonstration workspace is unavailable.", 403, "pilot_access_denied");
        const parsed = descriptorSchema.safeParse(await (deps.loadDescriptor ?? readDescriptor)());
        if (!parsed.success)
            fail("The local synthetic fixture is invalid.", 503, "demo_unavailable");
        const descriptor = parsed.data;
        if (
            descriptor.companyId !== String(auth.data.companyId) ||
            descriptor.actorId !== auth.data.authUserId ||
            descriptor.roleContext.authenticatedPrincipalRef !== auth.data.authUserId
        )
            fail("This demonstration workspace is unavailable.", 403, "pilot_access_denied");
        const [owner] = await database()
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(auth.data.companyId)));
        if (!owner?.name.startsWith(SOPHIA_SYNTHETIC_COMPANY_PREFIX))
            fail("This demonstration workspace is unavailable.", 403, "pilot_access_denied");
        return { descriptor, ctx: auth.data };
    }
    async function rowFor(
        companyId: bigint,
        selector: { weekStart: string } | { id: string },
        reader = database()
    ) {
        const [row] = await reader
            .select()
            .from(vantageAgendas)
            .where(
                and(
                    eq(vantageAgendas.companyId, companyId),
                    "id" in selector
                        ? eq(vantageAgendas.id, selector.id)
                        : eq(vantageAgendas.weekStart, selector.weekStart)
                )
            );
        return row ?? null;
    }
    async function prepare(descriptor: VantageDemoDescriptor, week: string) {
        const spec = descriptor.weeks.find(entry => entry.weekStart === week);
        if (!spec) fail("Choose a configured synthetic reporting week.", 400, "validation_error");
        const period = reportPeriod(new Date(spec.asOf), spec.weekStart);
        if (period.weekStart !== spec.weekStart)
            fail("The synthetic reporting period is invalid.", 503, "demo_unavailable");
        const snapshot = await generationSnapshot(
            BigInt(descriptor.companyId),
            period,
            "configured-model",
            { actorId: descriptor.actorId }
        );
        const request: SophiaCompositionRequestV0 = {
            runId: snapshot.input.runId,
            inputVersion: snapshot.input.inputVersion,
            nativeInput: snapshot.input,
            expectedReportFingerprint: snapshot.expectedReportFingerprint,
            reportWindow: {
                startInclusive: period.startInclusive,
                endExclusive: period.endExclusive,
                asOf: period.asOf,
            },
            budgets: {
                maxSources: 20,
                maxExcerptChars: 12000,
                maxTokens: 16000,
                timeoutMs: 5000,
                maxQueries: 3,
            },
            documentIds: descriptor.documentIds,
            starDocumentIds: descriptor.starDocumentIds,
            roleContext: descriptor.roleContext,
            roleProfileVersions: descriptor.roleProfileVersions,
        };
        const service = createSophiaCompositionExperimentV0({
            syntheticOnly: true,
            database: database(),
            now: () => new Date(spec.asOf),
            resolveJosephFixture: async () => {
                const again = await authorized();
                if (sha(again.descriptor) !== sha(descriptor))
                    fail("The synthetic context configuration changed.", 409, "stale_context");
                return {
                    roleContext: again.descriptor.roleContext,
                    roleProfileVersions: again.descriptor.roleProfileVersions,
                    starDocumentIds: again.descriptor.starDocumentIds,
                };
            },
        });
        const prepared = await service.prepare(request);
        const envelope: ContextGenerationEnvelopeV0 = {
            v1Input: snapshot.input,
            manifest: prepared.context.manifest,
            evidenceSnapshot: prepared.context.evidenceSnapshot,
            freeze: prepared.context.freeze,
        };
        return { service, prepared, envelope };
    }
    function currentSources(
        saved: SavedRun,
        records: readonly TrustedContextSourceV0[],
        actorId: string,
        nativeInput: ContextGenerationEnvelopeV0["v1Input"]
    ) {
        if (saved.actorId !== actorId)
            fail(
                "Saved context is unavailable for the current actor.",
                403,
                "demo_source_unavailable"
            );
        if (saved.nativeInputFingerprint !== nativeInputFingerprint(nativeInput))
            fail(
                "Native evidence or recorded reviews changed. Generate a fresh context report.",
                409,
                "demo_native_input_changed"
            );
        const allowed = new Map(records.map(record => [contextSourceKeyV0(record.source), record]));
        const selected = saved.sources.map(source => {
            const current = allowed.get(contextSourceKeyV0(source.source));
            if (
                !current ||
                current.contentHash !== source.contentHash ||
                current.access !== "allowed"
            )
                fail(
                    "Saved context has changed or is no longer authorized. Generate a fresh report.",
                    409,
                    "demo_source_unavailable"
                );
            return current;
        });
        return selected;
    }
    function sourceView(record: TrustedContextSourceV0): DemoSource {
        return {
            source: record.source,
            title: sourceTitle(record.source, record.citation?.title),
            body: record.content ?? record.excerpt,
            sourceDate: record.sourceDate,
            contentHash: record.contentHash!,
            ...(record.source.kind === "company" ? { reviewState: "unreviewed" } : {}),
            authority:
                record.source.kind === "company"
                    ? "Authorized company profile projection; unreviewed interpretations are not human approval."
                    : "Current authorized native document version. Source claims and historical questions require skeptical review; a document change does not prove completion.",
        };
    }
    async function load(week?: string): Promise<DemoState> {
        const { descriptor, ctx } = await authorized();
        const selectedWeek = week ?? descriptor.weeks.at(-1)!.weekStart;
        if (!descriptor.weeks.some(spec => spec.weekStart === selectedWeek))
            fail("Choose a configured synthetic reporting week.", 400, "validation_error");
        const row = await rowFor(ctx.companyId, { weekStart: selectedWeek });
        const state: DemoState = {
            weeks: descriptor.weeks.map(({ weekStart, label }) => ({ weekStart, label })),
            selectedWeek,
            report: null,
            nativeAgendaId: row?.id ?? null,
        };
        try {
            const fresh = await prepare(descriptor, selectedWeek);
            const company = fresh.prepared.sourceRecords.find(
                record => record.source.kind === "company"
            );
            if (company) state.companyArchitecture = sourceView(company);
            if (!row) return state;
            const payload = openPayload(row);
            if (!payload) return state;
            currentSources(
                payload.active,
                fresh.prepared.sourceRecords,
                ctx.authUserId,
                fresh.envelope.v1Input
            );
            state.report = { ...payload.active.report, version: payload.version };
        } catch {
            state.unavailableReason =
                "Saved context is unavailable or has changed. A fresh authorized generation is required.";
        }
        return state;
    }
    async function generateWeek(week: string): Promise<DemoState> {
        let stage = "authorization";
        try {
            const { descriptor, ctx } = await authorized();
            stage = "native-report";
            const row = await rowFor(ctx.companyId, { weekStart: week });
            if (!row)
                fail(
                    "Create the native weekly report before generating the context extension.",
                    409,
                    "native_report_required"
                );
            stage = "context-assembly";
            const { service, prepared, envelope } = await prepare(descriptor, week);
            stage = "model-resolution";
            const controller = new AbortController();
            const model = resolveDemoModel();
            const base = process.env.CHAT_BASE_URL;
            if (
                !deps.generate &&
                (!base ||
                    !new URL(base).hostname.endsWith(".openai.azure.com") ||
                    new URL(base).pathname.replace(/\/+$/, "") !== "/openai/v1")
            )
                fail(
                    "The approved synthetic endpoint is unavailable.",
                    503,
                    "demo_model_unavailable"
                );
            const capture = deps.generate
                ? undefined
                : await captureDemoGeneration(envelope, model);
            if (capture)
                console.info(`[vantage-demo] Synthetic attempt artifacts: ${capture.directory}`);
            const generate =
                deps.generate ??
                createSophiaContextGenerationExperimentV0(undefined, {
                    observeAttempt: capture?.observeAttempt,
                });
            const timer = setTimeout(() => controller.abort(), 45000);
            let output: Generated;
            try {
                stage = "model-generation";
                output = await generate(envelope, {
                    resolveModel: () => model,
                    signal: controller.signal,
                    budgets: {
                        attemptTimeoutMs: 20000,
                        maxAttempts: 2,
                        retryWaitMs: 1000,
                        totalMs: 45000,
                    },
                });
            } finally {
                clearTimeout(timer);
                controller.abort();
            }
            if (
                output.generated.v1Result.execution.mode !== "ai" ||
                output.generated.v1Result.execution.fallbackReason !== null
            )
                fail(
                    "The model did not produce a validated context report; the saved report was retained.",
                    503,
                    "demo_model_failed"
                );
            stage = "sidecar-encryption";
            const previous = openPayload(row);
            const manifest = prepared.context.manifest;
            const authorizedKeys = new Set(
                prepared.sourceRecords.map(record => contextSourceKeyV0(record.source))
            );
            const visibleRefs = (refs: readonly DemoSourceRef[]) => [
                ...new Map(
                    refs
                        .filter(ref => authorizedKeys.has(contextSourceKeyV0(ref)))
                        .map(ref => [contextSourceKeyV0(ref), ref])
                ).values(),
            ];
            const report: DemoReport = {
                id: row.id,
                weekStart: week,
                generatedAt: new Date().toISOString(),
                version: (previous?.version ?? 0) + 1,
                summary: output.report.summary,
                topics: output.report.topics.map(topic => ({
                    ...topic,
                    id: randomUUID(),
                    status: "suggested",
                })),
                execution: {
                    mode: "ai",
                    modelId: output.diagnostics.modelId,
                    promptVersion: output.diagnostics.promptVersion,
                    attempts: output.diagnostics.providerAttempts,
                    durationMs: output.diagnostics.durationMs,
                    fallbackReason: null,
                    ...(model.reasoning?.requestPatch.reasoning_effort === "none"
                        ? { reasoningEffort: "none" as const }
                        : {}),
                },
                diagnostics: {
                    promptBytes: output.diagnostics.promptBytes,
                    promptOmissions: output.diagnostics.promptOmissionsByAttempt,
                    context: {
                        retrievalStatus: manifest.retrievalState.status,
                        manifestStatus: manifest.status,
                        researchMode: manifest.research.mode,
                        researchStatus: manifest.research.status,
                        roleIds: [...manifest.roleIds],
                        personalStarCount: Object.keys(manifest.personalStarVersions).length,
                        selectedCount: manifest.selectedRefs.length,
                        missingCount: manifest.coverage.missing.length,
                        omittedCount: manifest.omissions.length,
                        missingRefs: visibleRefs(manifest.coverage.missing),
                        omittedRefs: visibleRefs(
                            manifest.omissions.flatMap(omission =>
                                omission.source ? [omission.source] : []
                            )
                        ),
                        optionalUnavailableCount: prepared.optionalUnavailableCount,
                    },
                    sources: prepared.context.evidenceSnapshot.entries.map(source => ({
                        source: source.source,
                        title: sourceTitle(source.source, source.citation?.title),
                        contentHash: source.contentHash,
                        ...(source.source.kind === "company" ? { reviewState: "unreviewed" } : {}),
                    })),
                    contextFingerprint: prepared.context.manifest.contextFingerprint,
                    persisted: true,
                    historicalHumanDecisions: [
                        ...(previous?.history ?? []),
                        ...(previous ? [previous.active] : []),
                    ]
                        .flatMap(run => run.report.topics)
                        .filter(
                            topic => topic.decision !== undefined || topic.status !== "suggested"
                        ).length,
                },
            };
            const saved: SavedRun = {
                actorId: ctx.authUserId,
                companyId: String(ctx.companyId),
                report,
                window: prepared.context.manifest.reportWindow,
                sources: prepared.context.evidenceSnapshot.entries.map(source => ({
                    source: source.source,
                    contentHash: source.contentHash,
                })),
                nativeInputFingerprint: nativeInputFingerprint(envelope.v1Input),
            };
            const payload: SavedPayload = {
                schemaVersion: "vantage-context-demo/v1",
                version: report.version,
                active: saved,
                history: [...(previous?.history ?? []), ...(previous ? [previous.active] : [])],
            };
            const sealed = sealPayload(payload);
            stage = "guarded-persistence";
            await service.commitGenerated(
                prepared,
                { envelope, generated: output.generated },
                async transaction => {
                    const changed = await transaction
                        .update(vantageAgendas)
                        .set({
                            modelMetadata: { ...row.modelMetadata, [DEMO_METADATA_KEY]: sealed },
                            updatedAt: row.updatedAt,
                        })
                        .where(
                            and(
                                eq(vantageAgendas.id, row.id),
                                eq(vantageAgendas.companyId, ctx.companyId),
                                sql`${vantageAgendas.modelMetadata} IS NOT DISTINCT FROM ${JSON.stringify(row.modelMetadata)}::jsonb`
                            )
                        )
                        .returning({ id: vantageAgendas.id });
                    if (changed.length !== 1)
                        fail(
                            "The weekly report changed. Reload before generating.",
                            409,
                            "stale_agenda"
                        );
                }
            );
            stage = "saved-readback";
            return await load(week);
        } catch (failure) {
            const value = failure as {
                name?: unknown;
                code?: unknown;
                constructor?: { name?: unknown };
                execution?: { mode?: unknown; fallbackReason?: unknown; attempts?: unknown };
                diagnosticReason?: unknown;
                promptBytes?: unknown;
                contextBytes?: unknown;
                promptByteLimit?: unknown;
            } | null;
            const failureNames = new Set([
                "Error",
                "TypeError",
                "RangeError",
                "SyntaxError",
                "StructuredAttemptSetupError",
                "SophiaContextExperimentUnavailableErrorV0",
                "ChatConfigurationError",
                "ChatRequestError",
                "ContextPipelineErrorV0",
                "SophiaCompositionErrorV0",
                "CompanyArchitectureHostErrorV0",
                "VantageError",
                "MissingSecretsKeyError",
                "CiphertextDecodeError",
                "ZodError",
            ]);
            const failureCodes = new Set([
                "context_model_not_successful",
                "demo_model_unavailable",
                "demo_model_failed",
                "stale_optional_sources",
                "stale_native_input",
                "stale_context",
                "stale_agenda",
                "stale_context_review",
                "demo_history_full",
                "demo_payload_unavailable",
                "demo_source_unavailable",
                "demo_native_input_changed",
                "synthetic_database_binding",
                "required_architecture_unavailable",
                "required_star_unavailable",
                "actor_scope",
                "role_or_star_fixture_changed",
                "pilot_access_denied",
                "unauthorized",
            ]);
            const identifier = (candidate: unknown, allowed: ReadonlySet<string>) =>
                typeof candidate === "string" && allowed.has(candidate) ? candidate : "unknown";
            // Names/stages only: provider messages, SQL, endpoints, source text and
            // raw exception objects must never be printed by this local adapter.
            console.error("[vantage-demo] Generation failed", {
                stage,
                errorName: identifier(value?.name, failureNames),
                errorClass: identifier(value?.constructor?.name, failureNames),
                code: identifier(value?.code, failureCodes),
                diagnosticReason:
                    value?.diagnosticReason === "native-items-unavailable" ||
                    value?.diagnosticReason === "paired-prompt-budget"
                        ? value?.diagnosticReason
                        : "unknown",
                ...(Number.isSafeInteger(value?.promptBytes)
                    ? { promptBytes: value?.promptBytes }
                    : {}),
                ...(Number.isSafeInteger(value?.contextBytes)
                    ? { contextBytes: value?.contextBytes }
                    : {}),
                ...(Number.isSafeInteger(value?.promptByteLimit)
                    ? { promptByteLimit: value?.promptByteLimit }
                    : {}),
                ...(value?.execution
                    ? {
                          mode: value.execution.mode === "rules" ? "rules" : "unknown",
                          fallbackReason: [
                              "no-model",
                              "timeout",
                              "provider-error",
                              "invalid-output",
                          ].includes(String(value.execution.fallbackReason))
                              ? value.execution.fallbackReason
                              : "unknown",
                          attempts: Number.isSafeInteger(value.execution.attempts)
                              ? value.execution.attempts
                              : 0,
                      }
                    : {}),
            });
            throw failure;
        }
    }
    async function preflight(week: string) {
        const { descriptor } = await authorized();
        const { envelope } = await prepare(descriptor, week);
        const model = resolveDemoModel();
        let providerBoundaryReached = false;
        let promptBytes = 0;
        const probe = createSophiaContextGenerationExperimentV0(
            async (resolved, schema, messages) => {
                const prepared = resolved.prepareMessages([
                    ...systemMessageFor(resolved.behavior, structuredSchemaInstruction(schema)),
                    ...messages,
                ]);
                promptBytes = Buffer.byteLength(
                    JSON.stringify(prepared.map(message => message.content)),
                    "utf8"
                );
                providerBoundaryReached = true;
                throw new StructuredAttemptSetupError();
            }
        );
        try {
            await probe(envelope, {
                resolveModel: () => model,
                signal: new AbortController().signal,
                budgets: {
                    attemptTimeoutMs: 20000,
                    maxAttempts: 2,
                    retryWaitMs: 1000,
                    totalMs: 45000,
                },
            });
        } catch (failure) {
            if (providerBoundaryReached)
                return {
                    ready: true,
                    providerCalled: false,
                    persisted: false,
                    reason: "prompt-preflight-passed-transport-not-exercised",
                    promptBytes,
                    promptByteLimit: 23500,
                };
            const value = failure as {
                diagnosticReason?: unknown;
                promptBytes?: unknown;
                contextBytes?: unknown;
                promptByteLimit?: unknown;
            } | null;
            if (
                value?.diagnosticReason === "native-items-unavailable" ||
                value?.diagnosticReason === "paired-prompt-budget"
            )
                return {
                    ready: false,
                    providerCalled: false,
                    persisted: false,
                    reason: value.diagnosticReason,
                    ...(Number.isSafeInteger(value?.promptBytes)
                        ? { promptBytes: value?.promptBytes }
                        : {}),
                    ...(Number.isSafeInteger(value?.contextBytes)
                        ? { contextBytes: value?.contextBytes }
                        : {}),
                    ...(Number.isSafeInteger(value?.promptByteLimit)
                        ? { promptByteLimit: value?.promptByteLimit }
                        : {}),
                };
            throw failure;
        }
        throw new Error("Synthetic prompt preflight did not reach a known boundary.");
    }
    async function review(input: DemoTopicReview): Promise<DemoState> {
        const { descriptor, ctx } = await authorized();
        const row = await rowFor(ctx.companyId, { id: input.reportId });
        if (!row) fail("That report is unavailable.", 404, "not_found");
        const payload = openPayload(row);
        if (!payload || payload.version !== input.expectedVersion)
            fail("The context review changed. Reload before saving.", 409, "stale_context_review");
        const fresh = await prepare(descriptor, row.weekStart);
        currentSources(
            payload.active,
            fresh.prepared.sourceRecords,
            ctx.authUserId,
            fresh.envelope.v1Input
        );
        const topic = payload.active.report.topics.find(topic => topic.id === input.topicId);
        if (!topic) fail("That context topic is unavailable.", 404, "not_found");
        if (input.status) topic.status = input.status;
        if (input.decision)
            topic.decision = { ...input.decision, recordedAt: new Date().toISOString() };
        payload.version++;
        payload.active.report.version = payload.version;
        const sealed = sealPayload(payload);
        await fresh.service.guardedCommit(fresh.prepared, async transaction => {
            const changed = await transaction
                .update(vantageAgendas)
                .set({
                    modelMetadata: { ...row.modelMetadata, [DEMO_METADATA_KEY]: sealed },
                    updatedAt: row.updatedAt,
                })
                .where(
                    and(
                        eq(vantageAgendas.id, row.id),
                        eq(vantageAgendas.companyId, ctx.companyId),
                        sql`${vantageAgendas.modelMetadata} IS NOT DISTINCT FROM ${JSON.stringify(row.modelMetadata)}::jsonb`
                    )
                )
                .returning({ id: vantageAgendas.id });
            if (changed.length !== 1)
                fail(
                    "The context review changed. Reload before saving.",
                    409,
                    "stale_context_review"
                );
        });
        return load(row.weekStart);
    }
    async function source(reportId: string, ref: DemoSourceRef): Promise<DemoSource> {
        const { descriptor, ctx } = await authorized();
        const row = await rowFor(ctx.companyId, { id: reportId });
        if (!row) fail("That source is unavailable.", 404, "not_found");
        const fresh = await prepare(descriptor, row.weekStart);
        if (ref.kind === "company") {
            const company = fresh.prepared.sourceRecords.find(
                record => contextSourceKeyV0(record.source) === contextSourceKeyV0(ref)
            );
            if (!company)
                fail("That exact current company projection is unavailable.", 404, "not_found");
            return sourceView(company);
        }
        const payload = openPayload(row);
        if (!payload) fail("That source is unavailable.", 404, "not_found");
        const records = currentSources(
            payload.active,
            fresh.prepared.sourceRecords,
            ctx.authUserId,
            fresh.envelope.v1Input
        );
        const record = records.find(
            record => contextSourceKeyV0(record.source) === contextSourceKeyV0(ref)
        );
        if (!record) fail("That exact saved source is unavailable.", 404, "not_found");
        return sourceView(record);
    }
    return { load, generateWeek, preflight, review, source };
}
