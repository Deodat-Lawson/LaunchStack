/** M3 admission policy, applied only by the grounding service. */
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { toRows } from "@launchstack/store/client";
import { VantageError } from "@launchstack/pipelines/vantage";
import { normalizeGenerationV1OutputForInput } from "../../../../../pipelines/src/vantage/generation-v1";
import { GENERATION_PROMPT_VERSION_V2 } from "../../../../../pipelines/src/vantage/experiments/decision-generation-v2";
import {
    type M3AdmissionReceipt,
    type createM3GroundingPipeline,
} from "../../../../../pipelines/src/vantage/experiments/live-grounding-m3";
import type { M3RequestBudget } from "../../../../../pipelines/src/vantage/evaluation-live/m3-request-budget";
import type { ContextualHostPolicy, ContextualHostPolicyInput } from "./contextual-host";
function fail(code: string): never {
    throw new VantageError(
        "The candidate did not satisfy the grounded admission policy.",
        409,
        code
    );
}
export function createGroundingPolicy(
    resolve: (input: ContextualHostPolicyInput) => {
        pipeline: ReturnType<typeof createM3GroundingPipeline>;
        budget: M3RequestBudget;
        audit?: unknown;
    }
): ContextualHostPolicy {
    function receipt(input: ContextualHostPolicyInput) {
        const r = input.admission as M3AdmissionReceipt;
        try {
            return resolve(input).pipeline.assertAdmissionReceipt({
                envelope: input.prepared.envelope,
                generated: input.generated,
                compound: input.compound,
                normalizedReport: input.normalized.report,
                receipt: r,
            });
        } catch {
            return fail("grounding_receipt_invalid");
        }
    }
    return {
        id: "vantage-live-grounding-m3/v1",
        fullSourceMetadataBinding: true,
        strictRoleMapping: true,
        assertNative(input) {
            const expected = normalizeGenerationV1OutputForInput(
                input.normalized.native,
                input.prepared.envelope.v1Input
            );
            const actual = {
                summary: input.generated.v1Result.draft.summary,
                topics: input.generated.v1Result.draft.topics,
                enhancements: input.generated.v1Result.enhancements,
            };
            if (!isDeepStrictEqual(expected, actual)) fail("native_carrier_binding_invalid");
        },
        assess(input) {
            return { receipt: receipt(input), audit: resolve(input).audit };
        },
        assertExecution(input) {
            const r = receipt(input),
                execution = input.report.execution;
            if (
                execution.mode !== (r.mode === "offline" ? "replay" : "ai") ||
                execution.modelId !== r.generationIdentity.wireModelId ||
                execution.promptVersion !== GENERATION_PROMPT_VERSION_V2 ||
                execution.attempts !== 1 ||
                execution.fallbackReason !== null ||
                !Number.isFinite(execution.durationMs) ||
                execution.durationMs < 0
            )
                fail("report_execution_binding_invalid");
        },
        async assertCommit(input, tx) {
            const r = receipt(input);
            // The shared budget verifier locks its row in this same activation transaction.
            const query = async (text: string, params: unknown[]) => {
                const fragments = text
                    .split(/(\$\d+)/)
                    .map(part =>
                        /^\$\d+$/.test(part)
                            ? sql`${params[Number(part.slice(1)) - 1]}`
                            : sql.raw(part)
                    );
                return toRows<Record<string, unknown>>(
                    await tx.execute(sql.join(fragments, sql.raw("")))
                );
            };
            try {
                await resolve(input).budget.verifyReceipt(
                    {
                        planHash: r.planHash,
                        inputHash: r.inputHash,
                        configHash: r.configHash,
                        generationRequestId: r.ledger.generationRequestId,
                        judgeRequestId: r.ledger.judgeRequestId,
                        generationResponseHash: r.ledger.generationResponseHash,
                        judgeResponseHash: r.ledger.judgeResponseHash,
                    },
                    { query, lock: true }
                );
                if (r.mode === "live") {
                    const rows = await query(
                        "SELECT approval_manifest FROM pdr_ai_v2_vantage_m3_request_budgets WHERE budget_key='finance-live-pilot' AND plan_hash=$1",
                        [r.planHash]
                    );
                    const raw = rows[0]?.approval_manifest,
                        approval = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
                    if (
                        !approval ||
                        typeof approval !== "object" ||
                        !("expectedBaseline" in approval) ||
                        !isDeepStrictEqual(approval.expectedBaseline, input.prepared.baseline)
                    )
                        fail("grounding_approval_baseline_changed");
                }
            } catch {
                fail("grounding_ledger_invalid");
            }
        },
    };
}
