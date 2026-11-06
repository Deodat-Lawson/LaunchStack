import { z } from "zod";
/** Isolated decision experiment. No default transport and no product caller. */
import { coerceMessageLikeToMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
    InvalidStructuredAttemptError,
    StructuredAttemptSetupError,
    structuredSchemaInstruction,
    systemMessageFor,
} from "@launchstack/llm";
import { GenerationOutputSchema, GENERATION_SYSTEM_PROMPT } from "../generation-v1";
import { eventStateContradictions } from "../event-state-grounding-v1";
import { GenerationCompoundSchemaV2 } from "../generation-v2-schema";
import { normalizeGenerationV2 } from "../validate-generation-v2";
import {
    assertValidRoleContext,
    createContextAwareGenerationAdapter,
} from "../context-v0/adapters";
import type { ContextGenerationEnvelopeV0, GenerationRuntime } from "../context-v0/ports";
import { contextSourceKeyV0, type BusinessRoleContextV0 } from "../proposals/context-v0";
import {
    createSophiaContextGenerationExperimentV0,
    SOPHIA_EXPERIMENT_MAX_PROMPT_BYTES,
} from "./sophia-generation-v0";

export const GENERATION_PROMPT_VERSION_V2 = "vantage-agenda/contract-v2.1-schema.1";
export const V2_OUTPUT_TOKEN_CAP = 2400;
export type V2Outcome = "v2-first-pass" | "v2-after-repair" | "v1.5-fallback" | "failed";
type SophiaResult = Awaited<
    ReturnType<ReturnType<typeof createSophiaContextGenerationExperimentV0>>
>;
type Invoke = NonNullable<Parameters<typeof createSophiaContextGenerationExperimentV0>[0]>;
type AttemptStageV2 =
    | "structured-transport"
    | "output-size"
    | "output-schema"
    | "grounding-and-citations"
    | "paired-adapter-schema"
    | "returned-to-context-adapter";

/** Use only a host-verified primary role, never the first ID or a generated label. */
export function roleFrameV2(envelope: ContextGenerationEnvelopeV0, role?: BusinessRoleContextV0) {
    if (!role || role.fallback || role.provenance.kind === "fallback")
        return "a decision assistant";
    assertValidRoleContext(role, envelope.manifest.actor.principalRef);
    if (
        !role.primaryRoleId ||
        role.mappingVersion !== envelope.manifest.roleMapVersion ||
        role.roleIds.some(id => !envelope.manifest.roleIds.includes(id))
    )
        return "a decision assistant";
    const frames: Record<string, string> = {
        founder: "the founder's chief of staff",
        ceo: "the founder's chief of staff",
        "security-engineer":
            "a decision assistant for a security engineer, fluent in security work and its cross-team dependencies",
        "solo-owner":
            "a practical advisor to a solo owner-operator, mindful of one person's time and budget",
        "owner-manager":
            "a practical advisor to a solo owner-operator, mindful of one person's time and budget",
    };
    return frames[role.primaryRoleId] ?? "a decision assistant";
}

export function decisionPromptV2(
    envelope: ContextGenerationEnvelopeV0,
    role?: BusinessRoleContextV0
) {
    const appendices = GENERATION_SYSTEM_PROMPT.slice(
        GENERATION_SYSTEM_PROMPT.indexOf("PREVIOUS VANTAGE CONTEXT")
    );
    return transportPromptV2(envelope, role) + "\n\n" + appendices;
}

/** Lossless transport interning only; the untouched frozen snapshot remains the validator source. */
export function internContextExcerptsV2(messages: Parameters<Invoke>[2]) {
    const itemSchema = z.object({ ref: z.string(), text: z.string() }).passthrough();
    const nativeSchema = z.object({ items: z.array(itemSchema) }).passthrough();
    const contextSchema = z
        .object({
            context: z
                .object({
                    sources: z.array(
                        z
                            .object({
                                ref: z.string(),
                                excerpt: z.string().optional(),
                                excerptFromNativeItem: z
                                    .object({
                                        ref: z.string(),
                                        start: z.number(),
                                        length: z.number(),
                                    })
                                    .optional(),
                            })
                            .passthrough()
                    ),
                })
                .passthrough(),
        })
        .passthrough();
    const items: { ref: string; text: string }[] = [];
    for (const value of messages) {
        const m = coerceMessageLikeToMessage(value);
        if (m.getType() !== "human" || typeof m.content !== "string") continue;
        try {
            const raw: unknown = JSON.parse(m.content);
            const p = nativeSchema.safeParse(raw);
            if (p.success) items.push(...p.data.items);
        } catch {
            /* Non-payload messages are unchanged. */
        }
    }
    return messages.map(value => {
        const m = coerceMessageLikeToMessage(value);
        if (m.getType() !== "human" || typeof m.content !== "string") return m;
        try {
            const raw: unknown = JSON.parse(m.content);
            const parsed = contextSchema.safeParse(raw);
            if (!parsed.success) return m;
            const p = parsed.data;
            for (const source of p.context.sources) {
                const excerpt = source.excerpt;
                if (!excerpt || excerpt.length < 80) continue;
                const matches = items.filter(item => item.text.includes(excerpt));
                if (matches.length !== 1) continue;
                const item = matches[0]!;
                if (items.filter(candidate => candidate.ref === item.ref).length !== 1) continue;
                const binding = {
                    ref: item.ref,
                    start: item.text.indexOf(excerpt),
                    length: excerpt.length,
                };
                if (item.text.slice(binding.start, binding.start + binding.length) !== excerpt)
                    throw new Error("Excerpt binding mismatch");
                if (JSON.stringify(binding).length + 40 >= JSON.stringify(excerpt).length) continue;
                source.excerptFromNativeItem = binding;
                delete source.excerpt;
            }
            return new HumanMessage(JSON.stringify(p));
        } catch {
            return m;
        }
    });
}
/** Repeat critical bounds near the task instructions, derived from the unchanged validator schema. */
function fieldLimitsV2() {
    const topic = GenerationCompoundSchemaV2.shape.experimental.shape.topics.element.shape;
    const fields: readonly (readonly [string, z.ZodString])[] = [
        ["rationale", topic.rationale],
        ["whyNow", topic.whyNow],
    ];
    return fields
        .map(([name, schema]) => {
            if (!(schema instanceof z.ZodString) || schema.maxLength === null)
                throw new StructuredAttemptSetupError();
            return `${name}<=${schema.maxLength} characters`;
        })
        .join("; ");
}
/** Native safety/history rules remain verbatim; neither schema nor output is rewritten. */
function transportPromptV2(
    envelope: ContextGenerationEnvelopeV0,
    role?: BusinessRoleContextV0,
    profile: "default" | "role-pair-m2" = "default"
) {
    if (profile === "role-pair-m2") {
        // Calling the existing frame validator retains its actor/map/selected-role binding checks.
        roleFrameV2(envelope, role);
        const primary =
            role &&
            role.userConfirmed &&
            !role.fallback &&
            role.provenance.kind !== "fallback" &&
            role.mappingVersion === envelope.manifest.roleMapVersion &&
            role.roleIds.every(id => envelope.manifest.roleIds.includes(id))
                ? role.roles.find(value => value.roleId === role.primaryRoleId)
                : undefined;
        const trustedPrimary =
            primary && role
                ? {
                      primaryRoleId: primary.roleId,
                      mappingVersion: role.mappingVersion,
                      description: primary.description,
                      responsibilities: primary.responsibilities,
                      priorities: primary.priorities,
                  }
                : {
                      primaryRoleId: null,
                      mappingVersion: envelope.manifest.roleMapVersion,
                      fallback: true,
                      responsibilities: [],
                      priorities: [],
                  };
        return `M2 trustedPrimary=${JSON.stringify(trustedPrimary)}\nNative IDs; context refs exact @version. All sources/states/definitions/uncertainty; copies not corroboration.`;
    }
    return `CONTEXTUAL V2 ${GENERATION_PROMPT_VERSION_V2}: ${roleFrameV2(envelope, role)}. Return one complete JSON object. native: cite only original native item refs; <=1 topic. experimental: cite only exact context.sources[].ref values, including @version. Review the full authorized contextual source set; copies are not corroboration. Only-supplied claims need full-context support, not citation counts. Preserve definitions; differing values need not conflict. No padding/enhancements. Call/because/wouldChangeIf; seek evidence: what/where/whom/when/implications; next step If A=>X, B=>Y. Headline=situation; brief=why now; figures cite/declare arithmetic. Missing approval !=absence; samples may differ. ${fieldLimitsV2()}. excerptFromNativeItem: exact slice(start,length); cite contextual ref.`;
}
export function outputSizeV2(pair: unknown, countTokens: (text: string) => number) {
    const serialized = JSON.stringify(pair);
    const outputTokens = countTokens(serialized);
    if (!Number.isSafeInteger(outputTokens) || outputTokens < 0)
        throw new Error("Invalid tokenizer count");
    return {
        outputTokens,
        outputTokenCap: V2_OUTPUT_TOKEN_CAP,
        warn: outputTokens > V2_OUTPUT_TOKEN_CAP * 0.85,
    };
}

/** Explicit opt-in injection only. Sophia retains native normalization, two-attempt and timeout budgets. */
export function createDecisionExperimentV2(options: {
    version: typeof GENERATION_PROMPT_VERSION_V2 | "disabled";
    invoke: Invoke;
    countTokens: (text: string) => number;
    /** M2-only instruction compaction; source payload/schema/native safety/history remain unchanged. */
    transportProfile?: "default" | "role-pair-m2";
    /** Resolve the authoritative primary role in the trusted host, never from request data. */
    resolvePrimaryRole?: (identity: {
        principalRef: string;
        companyId: string;
    }) => BusinessRoleContextV0 | null;
}) {
    return async (
        supplied: ContextGenerationEnvelopeV0,
        runtime: GenerationRuntime,
        fallback?: SophiaResult
    ) => {
        if (options.version !== GENERATION_PROMPT_VERSION_V2)
            throw new StructuredAttemptSetupError();
        const envelope = structuredClone(supplied);
        const role =
            options.resolvePrimaryRole?.({
                principalRef: envelope.manifest.actor.principalRef,
                companyId: envelope.manifest.actor.companyId,
            }) ?? undefined;
        let accepted: ReturnType<typeof normalizeGenerationV2> | null = null;
        let lastIssues: string[] = [];
        let setupFailure: { reason: string; promptBytes: number } | undefined;
        const attempts: {
            attempt: number;
            issues: string[];
            outputTokens?: number;
            warn?: boolean;
            promptBytes: number;
            stage: AttemptStageV2;
        }[] = [];
        const invoke: Invoke = async (model, _schema, messages, request) => {
            accepted = null;
            const replaced = internContextExcerptsV2(messages).map(value => {
                const message = coerceMessageLikeToMessage(value);
                if (
                    lastIssues.length &&
                    message.getType() === "system" &&
                    typeof message.content === "string" &&
                    message.content.startsWith(GENERATION_SYSTEM_PROMPT)
                )
                    return new SystemMessage(GENERATION_SYSTEM_PROMPT);
                return message.getType() === "system" &&
                    typeof message.content === "string" &&
                    message.content.startsWith("EXPERIMENTAL PAIRED OUTPUT")
                    ? new SystemMessage(
                          transportPromptV2(envelope, role, options.transportProfile) +
                              (lastIssues.length
                                  ? `\nRepair these validation failures: ${lastIssues.join("; ").slice(0, 300)}`
                                  : "")
                      )
                    : message;
            });
            const prepared = model.prepareMessages([
                ...systemMessageFor(
                    model.behavior,
                    structuredSchemaInstruction(GenerationCompoundSchemaV2)
                ),
                ...replaced,
            ]);
            if (
                Buffer.byteLength(JSON.stringify(prepared.map(x => x.content))) >
                SOPHIA_EXPERIMENT_MAX_PROMPT_BYTES
            ) {
                setupFailure = {
                    reason: "v2-prompt-budget",
                    promptBytes: Buffer.byteLength(JSON.stringify(prepared.map(x => x.content))),
                };
                throw Object.assign(new StructuredAttemptSetupError(), {
                    diagnosticReason: setupFailure.reason,
                    promptBytes: setupFailure.promptBytes,
                });
            }
            const record = {
                attempt: attempts.length + 1,
                promptBytes: Buffer.byteLength(JSON.stringify(prepared.map(x => x.content))),
                issues: [] as string[],
                stage: "structured-transport" as AttemptStageV2,
                outputTokens: undefined as number | undefined,
                warn: undefined as boolean | undefined,
            };
            attempts.push(record);
            try {
                const response = await options.invoke(model, GenerationCompoundSchemaV2, replaced, {
                    ...request,
                    maxOutputTokens: Math.min(request.maxOutputTokens, V2_OUTPUT_TOKEN_CAP),
                });
                record.stage = "output-size";
                const size = outputSizeV2(response.result, options.countTokens);
                record.outputTokens = size.outputTokens;
                record.warn = size.warn;
                if (size.outputTokens > V2_OUTPUT_TOKEN_CAP)
                    throw new Error("Compound output exceeds 2400 tokens");
                record.stage = "output-schema";
                const pair = GenerationCompoundSchemaV2.parse(response.result);
                record.stage = "grounding-and-citations";
                const normalized = normalizeGenerationV2(pair, envelope);
                accepted = normalized;
                record.stage = "paired-adapter-schema";
                const experimental = GenerationOutputSchema.strip().parse({
                    ...pair.experimental,
                    topics: pair.experimental.topics.map(t =>
                        GenerationOutputSchema.shape.topics.element.strip().parse(t)
                    ),
                });
                const result = _schema.parse({ native: pair.native, experimental });
                record.stage = "returned-to-context-adapter";
                return { result, usage: response.usage };
            } catch (error) {
                accepted = null;
                lastIssues =
                    error instanceof z.ZodError
                        ? error.issues
                              .slice(0, 4)
                              .map(issue => `${issue.path.join(".")}: ${issue.message}`)
                        : [error instanceof Error ? error.message : "Invalid compound output"];
                record.issues = lastIssues;
                throw new InvalidStructuredAttemptError();
            }
        };
        try {
            const output = await createSophiaContextGenerationExperimentV0(invoke)(
                envelope,
                runtime
            );
            const final = accepted as ReturnType<typeof normalizeGenerationV2> | null;
            if (!final) throw new Error("No validated decision output");
            return {
                outcome: (attempts.length === 1 ? "v2-first-pass" : "v2-after-repair") as V2Outcome,
                output: {
                    ...output,
                    report: final.report,
                    diagnostics: {
                        ...output.diagnostics,
                        promptVersion: GENERATION_PROMPT_VERSION_V2,
                        promptBytes: Math.max(...attempts.map(a => a.promptBytes)),
                        promptBytesByAttempt: attempts.map(a => a.promptBytes),
                        questions: final.diagnostics.questions,
                    },
                },
                attempts,
            };
        } catch (error) {
            // A fallback must already exist for this exact frozen envelope. No extra request is made.
            if (
                fallback &&
                fallback.diagnostics.contextFingerprint === envelope.manifest.contextFingerprint &&
                JSON.stringify([...fallback.diagnostics.sourceKeys].sort()) ===
                    JSON.stringify(
                        envelope.evidenceSnapshot.entries
                            .map(x => contextSourceKeyV0(x.source))
                            .sort()
                    )
            ) {
                try {
                    await createContextAwareGenerationAdapter(async () => ({
                        v1Result: fallback.generated.v1Result,
                        citationRefs: fallback.generated.citationRefs,
                    }))(envelope, runtime);
                    const legacy = GenerationOutputSchema.parse({
                        summary: fallback.report.summary,
                        topics: fallback.report.topics.map(({ proposedDue: _due, ...topic }) => ({
                            ...topic,
                            proposedDueInDays: null,
                            facts: topic.facts.map(f => ({
                                ...f,
                                refs: f.refs.map(contextSourceKeyV0),
                            })),
                            conflicts: topic.conflicts.map(f => ({
                                ...f,
                                refs: f.refs.map(contextSourceKeyV0),
                            })),
                        })),
                        enhancements: fallback.report.enhancements,
                    });
                    if (
                        fallback.report.topics.some(t => t.proposedDue !== null) ||
                        legacy.topics.length > 3 ||
                        legacy.enhancements.length ||
                        legacy.topics.some(
                            t => t.proposedOwner !== null || t.helpRequested !== null
                        ) ||
                        eventStateContradictions(
                            legacy,
                            envelope.evidenceSnapshot.entries.map(e => ({
                                ref: contextSourceKeyV0(e.source),
                                kind: "evidence" as const,
                                label: e.source.id,
                                date: null,
                                text: e.excerpt,
                            })),
                            envelope.v1Input.reportPeriod.weekStart.slice(0, 4)
                        ).length
                    )
                        throw new Error("Invalid legacy fallback report");
                    // Require the stored experimental facts to reproduce the generated ref set.
                    const keys = fallback.report.topics.flatMap(t =>
                        [...t.facts, ...t.conflicts].flatMap(f => f.refs.map(contextSourceKeyV0))
                    );
                    if (
                        JSON.stringify([...new Set(keys)].sort()) !==
                        JSON.stringify(
                            fallback.generated.citationRefs.map(contextSourceKeyV0).sort()
                        )
                    )
                        throw new Error("Fallback citation mismatch");
                    return { outcome: "v1.5-fallback" as V2Outcome, output: fallback, attempts };
                } catch {
                    /* Stale or invalid stored output is never shown. */
                }
            }
            return {
                outcome: "failed" as V2Outcome,
                output: null,
                attempts,
                error: error instanceof Error ? error.message : "Generation failed",
                setup:
                    setupFailure ??
                    (error instanceof StructuredAttemptSetupError
                        ? {
                              reason: (error as unknown as { diagnosticReason?: string })
                                  .diagnosticReason,
                              promptBytes: (error as unknown as { promptBytes?: number })
                                  .promptBytes,
                          }
                        : undefined),
            };
        }
    };
}
