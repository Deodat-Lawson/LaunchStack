/** Authenticated Finance service. The pipeline and budget are trusted server dependencies. */
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { loadPersonalContext, savePersonalRoles } from "./personal-context";
import { saveContextRolesSchema } from "~/lib/vantage/personal-context";
import { sql } from "drizzle-orm";
import { encryptSecret } from "@launchstack/store/crypto";
import { db } from "~/server/db";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { VantageError } from "@launchstack/pipelines/vantage";
import { contextSourceKeyV0 } from "@launchstack/pipelines/vantage/context-v0";
import {
    createM3GroundingPipeline,
    m3InputHash,
    M3_SCENARIO_ID,
    type M3GroundingOptions,
} from "../../../../../pipelines/src/vantage/experiments/live-grounding-m3";
import { createContextualHost, type PreparedContextualReport } from "./contextual-host";
import { createGroundingPersistence, type GroundingBaseline } from "./grounding-repository";
import { groundingExecutionIdentity } from "./grounding-execution";
import { createGroundingPolicy } from "./grounding-policy";
import { extractDemoV2Fields } from "./demo-v2-fields";
import type { DemoReport } from "~/app/employer/tools/vantage/demo-contract";
export interface GroundingReport extends DemoReport {
    grounding: {
        mode: "offline" | "live";
        modelJudgeUsed: boolean;
        simulatedJudge: boolean;
        qualityEvidence: "offline-injected" | "independent-configured-models";
        evaluationHash: string;
        planHash: string;
    };
}
export type GroundingServiceDependencies = Omit<
    NonNullable<Parameters<typeof createContextualHost>[0]>,
    "policy" | "persistence"
> & {
    resolveExecution(prepared: PreparedContextualReport): Promise<M3GroundingOptions>;
};
export function createGroundingService(deps: GroundingServiceDependencies) {
    const executions = new WeakMap<
        PreparedContextualReport,
        {
            pipeline: ReturnType<typeof createM3GroundingPipeline>;
            budget: M3GroundingOptions["budget"];
            audit?: unknown;
        }
    >();
    const policy = createGroundingPolicy(input => {
        const execution = executions.get(input.prepared);
        if (!execution) throw new Error("No admitted execution for this prepared input");
        return execution;
    });
    const host = createContextualHost({
        ...deps,
        policy,
        persistence: createGroundingPersistence(),
    });
    async function load(input: Parameters<typeof host.load>[0] = {}) {
        const state = await host.load(input);
        return {
            ...state,
            generationMode:
                state.report?.execution.mode === "ai" ? ("live" as const) : ("replay" as const),
        };
    }
    async function preflight() {
        const prepared = await host.prepare({ weekStart: "2026-10-12" });
        return {
            ...(await groundingExecutionIdentity()),
            mode: "disabled-until-approved",
            liveReady: false,
            externalRequests: 0,
            inputHash: m3InputHash(prepared.envelope, prepared.roleContext),
            baseline: prepared.baseline,
            sourceCount: prepared.records.length,
            blockers: [
                "Live execution requires an approved persistent plan, verified independent model identities/endpoints and pricing evidence.",
            ],
        };
    }
    async function generateWeek(expectedBaseline: GroundingBaseline) {
        const prepared = await host.prepare({ weekStart: "2026-10-12" });
        if (!isDeepStrictEqual(expectedBaseline, prepared.baseline))
            throw new VantageError(
                "The accepted report changed. Reload before generating.",
                409,
                "grounding_baseline_changed"
            );
        const options = await deps.resolveExecution(prepared),
            pipeline = createM3GroundingPipeline(options);
        executions.set(prepared, { pipeline, budget: options.budget });
        const result = await pipeline.runGroundingCandidate({
            envelope: prepared.envelope,
            sourceRefs: prepared.sourceRefs,
            roleContext: prepared.roleContext,
            nativeSourceBindings: prepared.nativeSourceBindings,
            closedInventory: {
                scope: "closed-synthetic-scenario",
                scenarioId: M3_SCENARIO_ID,
                generationInputFingerprint: m3InputHash(prepared.envelope, prepared.roleContext),
                manifestFingerprint: prepared.envelope.manifest.contextFingerprint,
                asOf: prepared.envelope.evidenceSnapshot.asOf,
                researchRequirement: "not-required-for-closed-scenario",
                sourceContentHashes: Object.fromEntries(
                    prepared.records.map(record => [
                        contextSourceKeyV0(record.source),
                        record.contentHash!,
                    ])
                ),
            },
        });
        const auditId = randomUUID(),
            sealed = encryptSecret(
                JSON.stringify({
                    schema: "vantage-grounding-attempt/v1",
                    owner: prepared.envelope.manifest.actor.principalRef,
                    company: prepared.envelope.manifest.actor.companyId,
                    mode: options.mode,
                    planHash: options.planHash,
                    result,
                })
            );
        await (deps.database ?? db).execute(
            sql`INSERT INTO pdr_ai_v2_vantage_grounding_attempts(id,company_id,owner_auth_id,mode,status,ciphertext,key_version) VALUES(${auditId}::uuid,${prepared.envelope.manifest.actor.companyId}::bigint,${prepared.envelope.manifest.actor.principalRef},${options.mode},${result.status},${sealed.ciphertext},${sealed.keyVersion})`
        );
        if (result.status !== "admitted") {
            console.error(
                "[vantage] grounding candidate withheld",
                JSON.stringify({
                    stage: result.trace.stage,
                    externalDispatches: result.trace.actualExternalDispatches,
                    injectedDispatches: result.trace.injectedDispatches,
                })
            );
            throw new VantageError(
                "Candidate withheld; the last accepted report is unchanged.",
                409,
                "grounding_candidate_withheld"
            );
        }
        executions.set(prepared, {
            pipeline,
            budget: options.budget,
            audit: {
                evaluation: result.evaluation,
                trace: result.trace,
                rawCompound: result.rawCompound,
            },
        });
        const output = result.output,
            r = result.admissionReceipt,
            report: GroundingReport = {
                id: randomUUID(),
                weekStart: "2026-10-12",
                version: 1,
                generatedAt: (deps.now?.() ?? new Date()).toISOString(),
                summary: output.report.summary,
                ...extractDemoV2Fields(output.report),
                topics: output.report.topics.map(topic => ({
                    ...topic,
                    id: randomUUID(),
                    status: "suggested",
                })),
                execution: {
                    mode: r.mode === "offline" ? "replay" : "ai",
                    modelId: output.diagnostics.modelId,
                    promptVersion: output.diagnostics.promptVersion,
                    attempts: output.diagnostics.providerAttempts,
                    durationMs: output.diagnostics.durationMs,
                    fallbackReason: null,
                },
                diagnostics: {
                    sources: prepared.records.map(record => ({
                        source: record.source,
                        title:
                            record.source.kind === "company"
                                ? "Company Architecture"
                                : `Document ${record.source.id}`,
                        contentHash: record.contentHash!,
                    })),
                    contextFingerprint: prepared.envelope.manifest.contextFingerprint,
                    persisted: true,
                    historicalHumanDecisions: 0,
                },
                grounding: {
                    mode: r.mode,
                    modelJudgeUsed: r.mode === "live",
                    simulatedJudge: r.mode === "offline",
                    qualityEvidence: r.qualityEvidence,
                    evaluationHash: r.evaluationReportHash,
                    planHash: r.planHash,
                },
            };
        await host.commit(prepared, output.generated, report, result.rawCompound, r);
        return load({ reportId: report.id });
    }
    async function context() {
        const resolved = await (deps.resolveWorkspace ?? requireWorkspaceContext)();
        if (!resolved.success)
            throw new VantageError("Authentication required.", 401, "unauthorized");
        return resolved.data;
    }
    async function personalContext() {
        return loadPersonalContext(await context(), deps.database);
    }
    async function saveRoles(input: unknown) {
        const parsed = saveContextRolesSchema.safeParse(input);
        if (
            !parsed.success ||
            parsed.data.roleIds.length !== 1 ||
            parsed.data.roleIds[0] !== "founder" ||
            parsed.data.primaryRoleId !== "founder"
        )
            throw new VantageError(
                "This Finance scenario requires the founder responsibility.",
                400,
                "grounding_role_invalid"
            );
        return savePersonalRoles(await context(), parsed.data, deps.database);
    }
    return { ...host, load, preflight, generateWeek, personalContext, saveRoles };
}
