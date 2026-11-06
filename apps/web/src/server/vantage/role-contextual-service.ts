/** M2 facade: persisted Joseph role preference selects a server-owned deterministic replay condition. */
import { randomUUID } from "node:crypto";
import { VantageError } from "@launchstack/pipelines/vantage";
import { roleDirectoryV0 } from "@launchstack/pipelines/vantage/role-context-v0";
import {
    runRoleMilestoneGeneration,
    evaluateRoleMilestoneReport,
    roleMilestoneOutputSize,
} from "../../../../../pipelines/src/vantage/experiments/role-pair-milestone-v1";
import { saveContextRolesSchema } from "~/lib/vantage/personal-context";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { db } from "~/server/db";
import { loadPersonalContext, savePersonalRoles } from "./personal-context";
import { personalContextSession } from "./personal-context-store";
import { createRoleContextualHost } from "./role-contextual-host";
import { ROLE_CONTEXTUAL_POLICY } from "./role-contextual-policy";
import { extractDemoV2Fields } from "./demo-v2-fields";
import type { RoleContextualReport } from "~/app/employer/tools/vantage/role-contextual-contract";
export function createRoleContextualService(
    deps: Parameters<typeof createRoleContextualHost>[0] = {}
) {
    const host = createRoleContextualHost(deps),
        database = deps.database ?? db;
    async function actor() {
        const result = await (deps.resolveWorkspace ?? requireWorkspaceContext)();
        if (!result.success)
            throw new VantageError(
                "Sign in to your workspace.",
                result.response.status,
                "unauthorized"
            );
        return result.data;
    }
    async function personalContext() {
        const ctx = await actor();
        const view = await loadPersonalContext(ctx, database);
        const session = await database.transaction(tx => personalContextSession(ctx, tx));
        if (session.state.revision !== view.state.revision)
            throw new VantageError(
                "Personal context changed; reload before continuing.",
                409,
                "stale_role_preference"
            );
        const currentVersion = roleDirectoryV0().mapVersion;
        const requiresConfirmation =
            !!session.state.roles && session.persistedRoleMappingVersion !== currentVersion;
        const roles = requiresConfirmation
            ? {
                  ...view.roles,
                  userConfirmed: false,
                  fallback: true,
                  provenance: {
                      kind: "fallback" as const,
                      source: "Stored responsibilities use a stale role directory; confirm them before generation.",
                  },
              }
            : view.roles;
        return {
            ...view,
            roles,
            ready: requiresConfirmation ? false : view.ready,
            snapshot: requiresConfirmation ? null : view.snapshot,
            directory: roleDirectoryV0(),
            mapping: {
                persistedVersion: session.persistedRoleMappingVersion,
                currentVersion,
                requiresConfirmation,
            },
        };
    }
    async function saveRoles(input: unknown) {
        const parsed = saveContextRolesSchema.safeParse(input);
        if (
            !parsed.success ||
            parsed.data.roleIds.length !== ROLE_CONTEXTUAL_POLICY.roleIds.length ||
            ROLE_CONTEXTUAL_POLICY.roleIds.some(id => !parsed.data.roleIds.includes(id)) ||
            !parsed.data.primaryRoleId ||
            !(ROLE_CONTEXTUAL_POLICY.roleIds as readonly string[]).includes(
                parsed.data.primaryRoleId
            )
        )
            throw new ContextPortErrorV0(
                "Keep both benchmark responsibilities selected and choose one of them as primary.",
                400
            );
        await savePersonalRoles(await actor(), parsed.data, database);
        return personalContext();
    }
    async function generateWeek(weekStart = ROLE_CONTEXTUAL_POLICY.weekStart) {
        const prepared = await host.prepare({ weekStart });
        const result = await runRoleMilestoneGeneration({
            envelope: prepared.envelope,
            sourceRefs: prepared.sourceRefs,
            roleContext: prepared.roleContext,
            ranking: prepared.ranking,
        });
        if (!result.output) {
            console.error(
                "[vantage] role replay validation failed",
                JSON.stringify({
                    outcome: result.outcome,
                    attempts: result.attempts.map(attempt => ({
                        stage: attempt.stage,
                        issueCount: attempt.issues.length,
                        promptBytes: attempt.promptBytes,
                    })),
                    setup: "setup" in result ? result.setup : undefined,
                })
            );
            throw new VantageError(
                "The deterministic role replay failed validation.",
                409,
                "role_generation_invalid"
            );
        }
        const output = result.output,
            semantic = evaluateRoleMilestoneReport(
                output.report,
                prepared.sourceRefs,
                prepared.roleContext
            );
        if (!semantic.passed)
            throw new VantageError("The role report needs review.", 409, "role_semantic_failed");
        const report: RoleContextualReport = {
            id: randomUUID(),
            weekStart,
            generatedAt: (deps.now?.() ?? new Date()).toISOString(),
            version: 1,
            summary: output.report.summary,
            ...extractDemoV2Fields(output.report),
            topics: output.report.topics.map(topic => ({
                ...topic,
                id: randomUUID(),
                status: "suggested",
            })),
            execution: {
                mode: "replay",
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
                contextFingerprint: prepared.context.manifest.contextFingerprint,
                persisted: true,
                historicalHumanDecisions: 0,
                semanticAssessment: {
                    kind: "deterministic-manual-checklist",
                    passed: true,
                    modelJudgeUsed: false,
                },
            },
            roleSelection: prepared.roleSelection,
            sourceSetHash: prepared.sourceSetHash,
            historyHash: prepared.historyHash,
            contextKey: prepared.contextKey,
        };
        await host.commit(prepared, output.generated, report, result.trace.validatedCompound, {
            transportProfile: result.trace.transportProfile,
            suppliedPromptMessages: result.trace.suppliedPromptMessages,
            attempts: result.attempts,
            priorityPlan: result.trace.priorityPlan,
            compound: result.trace.validatedCompound,
            promptMessages: result.trace.promptMessages,
            outputSize: roleMilestoneOutputSize(result.trace.validatedCompound),
            invocations: result.trace.invocations,
        });
        return host.load({ reportId: report.id });
    }
    return { ...host, generateWeek, personalContext, saveRoles };
}
