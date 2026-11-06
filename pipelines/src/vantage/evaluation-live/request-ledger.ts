import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export const REQUEST_LEDGER_VERSION = "vantage-provider-request-ledger/v1" as const;
export const PHASE_A_CASES = [
    "instruction-inside-document",
    "conflicting-metrics",
    "missing-denominator",
    "mixed-currencies-and-periods",
    "negation-and-old-mandatory-policy",
] as const;
export const PHASE_B_CASES = [
    "C01",
    "C02",
    "C03",
    "C04",
    "C05",
    "H01",
    "H02",
    "H03",
    "H04",
    "H05",
    "V2-01",
    "V2-02",
    "V2-03",
    "V2-04",
] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const label = z
    .string()
    .min(1)
    .max(300)
    .refine(value => !/[\r\n\u0000]/.test(value));
const iso = z.string().datetime();
const phaseSchema = z.enum(["A", "B"]);
const kindSchema = z.enum([
    "initial-generation",
    "initial-judge",
    "recovery",
    "candidate-d-generation",
    "v21-generation",
    "v21-repair",
    "pairwise-judge",
]);
export type RequestKind = z.infer<typeof kindSchema>;
const metadataSchema = z
    .object({
        intentId: label,
        phase: phaseSchema,
        caseId: label,
        kind: kindSchema,
        modelId: label,
        modelConfigHash: hash,
        promptHash: hash,
        inputHash: hash,
        promptVersion: label.optional(),
        repetition: z.number().int().min(1).max(3).optional(),
        recovery: z
            .object({
                purpose: z.enum(["generation", "judge", "verification"]),
                reason: label,
                authorizationRef: label,
            })
            .strict()
            .optional(),
    })
    .strict();
export type ModelRequestMetadata = z.infer<typeof metadataSchema>;
const usageSchema = z
    .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
        reasoningTokens: z.number().int().nonnegative().optional(),
        cachedInputTokens: z.number().int().nonnegative().optional(),
    })
    .strict();
const receiptSchema = z
    .object({
        httpStatus: z.number().int().min(100).max(599),
        providerRequestId: label.optional(),
        responseModel: label.optional(),
        usage: usageSchema.nullable().optional(),
        costUsd: z.number().finite().nonnegative().nullable().optional(),
        costBasis: z
            .enum(["provider-reported", "estimated-configured-rates"])
            .nullable()
            .optional(),
    })
    .strict();
export type ModelRequestReceipt = z.infer<typeof receiptSchema>;
export interface LedgerTransportResult<T> {
    value: T;
    receipt: ModelRequestReceipt;
}
const gateSchema = z
    .object({
        authorizationRef: label,
        pilotCases: z
            .array(
                z
                    .object({
                        caseId: label,
                        generationIntentId: label,
                        judgeIntentId: label,
                        generationValidated: z.literal(true),
                        criticalExpectationsSatisfied: z.literal(true),
                        semanticAssessmentValid: z.literal(true),
                        sourceIntegrityVerified: z.literal(true),
                        assessmentArtifactHash: hash,
                    })
                    .strict()
            )
            .length(5),
        pricing: z.discriminatedUnion("status", [
            z.object({ status: z.literal("verified"), evidenceHash: hash }).strict(),
            z.object({ status: z.literal("user-waived"), authorizationRef: label }).strict(),
        ]),
        judgeIndependence: z.discriminatedUnion("mode", [
            z
                .object({
                    mode: z.literal("different-family"),
                    verified: z.literal(true),
                    evidenceHash: hash,
                })
                .strict(),
            z
                .object({
                    mode: z.literal("same-model-separate-blinded-calls-user-approved"),
                    authorizationRef: label,
                    protocolHash: hash,
                })
                .strict(),
        ]),
        batchFreeze: z
            .object({
                scenarioCount: z.literal(14),
                repetitions: z.literal(3),
                inputsHash: hash,
                expectationsHash: hash,
                modelsHash: hash,
                rubricHash: hash,
                protocolHash: hash,
            })
            .strict(),
    })
    .strict();
export type PhaseBGate = z.infer<typeof gateSchema>;
const recordSchema = z
    .object({
        metadata: metadataSchema,
        ordinal: z.number().int().positive(),
        admittedAt: iso,
        terminalAt: iso.nullable(),
        status: z.enum(["dispatch-started", "responded", "failed"]),
        receipt: receiptSchema.nullable(),
        failure: z.enum(["transport-error", "invalid-transport-receipt"]).nullable(),
    })
    .strict();
const ownerSchema = z
    .object({
        version: z.literal(REQUEST_LEDGER_VERSION),
        ownerId: z.string().uuid(),
        runId: label,
        frozenSpecHash: hash,
    })
    .strict();
const stateSchema = z
    .object({
        version: z.literal(REQUEST_LEDGER_VERSION),
        ownerId: z.string().uuid(),
        runId: label,
        frozenSpecHash: hash,
        revision: z.number().int().nonnegative(),
        phaseBGate: gateSchema.nullable(),
        records: z.array(recordSchema).max(182),
        checksum: hash,
    })
    .strict();
export type RequestLedgerState = z.infer<typeof stateSchema>;
const limits: Record<RequestKind, number> = {
    "initial-generation": 5,
    "initial-judge": 5,
    recovery: 4,
    "candidate-d-generation": 42,
    "v21-generation": 42,
    "v21-repair": 42,
    "pairwise-judge": 42,
};
const checksum = (value: Omit<RequestLedgerState, "checksum">) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string): never {
    throw new Error(`Request ledger: ${message}`);
}

async function atomicSave(directory: string, value: Omit<RequestLedgerState, "checksum">) {
    // Explicitly project the persisted body: callers may pass an existing state
    // that contains its old checksum, which must never hash itself.
    const body = {
        version: value.version,
        ownerId: value.ownerId,
        runId: value.runId,
        frozenSpecHash: value.frozenSpecHash,
        revision: value.revision,
        phaseBGate: value.phaseBGate,
        records: value.records,
    };
    const payload = { ...body, checksum: checksum(body) };
    const temporary = join(directory, `ledger.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
        await handle.writeFile(JSON.stringify(payload, null, 2) + "\n", "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporary, join(directory, "ledger.json"));
}
async function lock<T>(directory: string, work: () => Promise<T>): Promise<T> {
    let handle;
    try {
        handle = await open(join(directory, "ledger.lock"), "wx", 0o600);
    } catch {
        return fail("locked or unavailable; no automatic lock removal or retry");
    }
    try {
        await handle.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
        );
        await handle.sync();
        return await work();
    } finally {
        await handle.close();
        await unlink(join(directory, "ledger.lock"));
    }
}
function validateAllocations(state: RequestLedgerState) {
    const counts = new Map<RequestKind, number>();
    const ids = new Set<string>(),
        slots = new Set<string>();
    let a = 0,
        b = 0;
    for (const [index, record] of state.records.entries()) {
        const m = record.metadata;
        if (record.ordinal !== index + 1 || ids.has(m.intentId))
            fail("duplicate or corrupt request identity");
        ids.add(m.intentId);
        if (m.phase === "A") {
            a++;
            if (
                !(["initial-generation", "initial-judge", "recovery"] as RequestKind[]).includes(
                    m.kind
                ) ||
                !(PHASE_A_CASES as readonly string[]).includes(m.caseId) ||
                m.repetition !== undefined
            )
                fail("invalid Phase A allocation");
        } else {
            b++;
            if (
                !(
                    [
                        "candidate-d-generation",
                        "v21-generation",
                        "v21-repair",
                        "pairwise-judge",
                    ] as RequestKind[]
                ).includes(m.kind) ||
                !(PHASE_B_CASES as readonly string[]).includes(m.caseId) ||
                m.repetition === undefined ||
                !state.phaseBGate
            )
                fail("invalid or unopened Phase B allocation");
        }
        if (m.kind === "recovery" && !m.recovery)
            fail("recovery reason and authorization reference required");
        if (m.kind !== "recovery" && m.recovery) fail("recovery metadata on an initial allocation");
        counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
        if ((counts.get(m.kind) ?? 0) > limits[m.kind]) fail("category ceiling exceeded");
        if (
            m.phase === "A" &&
            m.kind === "initial-judge" &&
            !slots.has(`A/${m.caseId}/0/initial-generation`)
        )
            fail("judge allocation needs an earlier generation attempt");
        if (m.kind === "v21-repair" && !slots.has(`B/${m.caseId}/${m.repetition}/v21-generation`))
            fail("V2 repair needs an earlier initial attempt");
        if (
            m.kind === "pairwise-judge" &&
            (!slots.has(`B/${m.caseId}/${m.repetition}/candidate-d-generation`) ||
                !slots.has(`B/${m.caseId}/${m.repetition}/v21-generation`))
        )
            fail("pairwise judging requires both initial candidates");
        if (m.kind !== "recovery") {
            const slot = `${m.phase}/${m.caseId}/${m.repetition ?? 0}/${m.kind}`;
            if (slots.has(slot))
                fail(
                    "initial or repair slot already consumed; use an authorized recovery allocation"
                );
            slots.add(slot);
        }
        if (
            record.status === "dispatch-started" &&
            (record.terminalAt !== null || record.receipt !== null || record.failure !== null)
        )
            fail("corrupt inflight record");
        if (record.status !== "dispatch-started" && record.terminalAt === null)
            fail("missing terminal timestamp");
        if (
            record.status === "responded" &&
            (!record.receipt ||
                record.receipt.httpStatus < 200 ||
                record.receipt.httpStatus >= 300 ||
                record.failure)
        )
            fail("invalid successful receipt");
        if (
            record.status === "failed" &&
            !record.failure &&
            (!record.receipt ||
                (record.receipt.httpStatus >= 200 && record.receipt.httpStatus < 300))
        )
            fail("invalid failed receipt");
    }
    if (a > 14 || b > 168 || a + b > 182) fail("hard request ceiling exceeded");
}
async function readState(directory: string): Promise<RequestLedgerState> {
    try {
        const owner = ownerSchema.parse(
            JSON.parse(await readFile(join(directory, "owner.json"), "utf8"))
        );
        const parsed = stateSchema.parse(
            JSON.parse(await readFile(join(directory, "ledger.json"), "utf8"))
        );
        const { checksum: saved, ...body } = parsed;
        if (
            saved !== checksum(body) ||
            owner.ownerId !== body.ownerId ||
            owner.runId !== body.runId ||
            owner.frozenSpecHash !== body.frozenSpecHash
        )
            fail("owner, frozen specification or checksum mismatch");
        validateAllocations(parsed);
        return parsed;
    } catch {
        return fail("corrupt, missing or unowned ledger; refusing dispatch");
    }
}
function noInflight(state: RequestLedgerState) {
    if (state.records.some(record => record.status === "dispatch-started"))
        fail(
            "inflight or crash-uncertain request; manual reconciliation required before another dispatch"
        );
}
export async function initializeRequestLedger(
    directory: string,
    specification: { runId: string; frozenSpecHash: string }
) {
    const spec = z.object({ runId: label, frozenSpecHash: hash }).strict().parse(specification);
    directory = resolve(directory);
    await mkdir(dirname(directory), { recursive: true });
    try {
        await mkdir(directory);
    } catch {
        return fail("initialization requires a new directory; existing ledgers are never reset");
    }
    const owner = { version: REQUEST_LEDGER_VERSION, ownerId: randomUUID(), ...spec };
    const handle = await open(join(directory, "owner.json"), "wx", 0o600);
    try {
        await handle.writeFile(JSON.stringify(owner, null, 2) + "\n", "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    const body = { ...owner, revision: 0, phaseBGate: null, records: [] };
    await atomicSave(directory, body);
    return inspectRequestLedger(directory);
}

/** Persist an admission BEFORE invoking precisely one HTTP transport callback.
 * A crash between admission and HTTP is intentionally charged as uncertain.
 * This wrapper never retries and serializes requests by refusing overlapping inflight calls.
 * A returned receipt confirms a provider HTTP response, not model/schema/semantic success.
 */
export async function dispatchWithLedger<T>(
    directory: string,
    rawMetadata: ModelRequestMetadata,
    transport: () => Promise<LedgerTransportResult<T>>
): Promise<T> {
    directory = resolve(directory);
    const metadata = metadataSchema.parse(rawMetadata);
    await lock(directory, async () => {
        const state = await readState(directory);
        noInflight(state);
        if (state.records.some(record => record.metadata.intentId === metadata.intentId))
            fail("intent already consumed; no implicit rerun");
        const entry = {
            metadata,
            ordinal: state.records.length + 1,
            admittedAt: new Date().toISOString(),
            terminalAt: null,
            status: "dispatch-started" as const,
            receipt: null,
            failure: null,
        };
        const next = { ...state, records: [...state.records, entry], revision: state.revision + 1 };
        validateAllocations(next);
        await atomicSave(directory, next);
    });
    let result: LedgerTransportResult<T>;
    try {
        result = await transport();
    } catch (error) {
        await terminal(directory, metadata.intentId, null, "transport-error");
        throw error;
    }
    const receipt = receiptSchema.safeParse(result?.receipt);
    if (!receipt.success) {
        await terminal(directory, metadata.intentId, null, "invalid-transport-receipt");
        return fail("invalid transport receipt; slot remains consumed");
    }
    await terminal(directory, metadata.intentId, receipt.data, null);
    return result.value;
}
async function terminal(
    directory: string,
    intentId: string,
    receipt: ModelRequestReceipt | null,
    failure: "transport-error" | "invalid-transport-receipt" | null
) {
    await lock(directory, async () => {
        const state = await readState(directory);
        const record = state.records.find(item => item.metadata.intentId === intentId);
        if (!record || record.status !== "dispatch-started")
            fail("request terminal state is not writable");
        record.status =
            receipt && receipt.httpStatus >= 200 && receipt.httpStatus < 300
                ? "responded"
                : "failed";
        record.receipt = receipt;
        record.failure = failure;
        record.terminalAt = new Date().toISOString();
        state.revision++;
        await atomicSave(directory, state);
    });
}
export async function openPhaseB(directory: string, rawGate: PhaseBGate) {
    const gate = gateSchema.parse(rawGate);
    return lock(resolve(directory), async () => {
        const state = await readState(resolve(directory));
        noInflight(state);
        if (state.phaseBGate) fail("Phase B gate already frozen");
        if (
            gate.judgeIndependence.mode === "same-model-separate-blinded-calls-user-approved" &&
            gate.judgeIndependence.protocolHash !== gate.batchFreeze.protocolHash
        )
            fail("same-model judge amendment must bind the frozen blinded protocol");
        if (
            new Set(gate.pilotCases.map(item => item.caseId)).size !== PHASE_A_CASES.length ||
            PHASE_A_CASES.some(id => !gate.pilotCases.some(item => item.caseId === id))
        )
            fail("all five original pilot cases must pass");
        for (const item of gate.pilotCases) {
            for (const [intentId, purpose] of [
                [item.generationIntentId, "generation"],
                [item.judgeIntentId, "judge"],
            ] as const) {
                const entry = state.records.find(record => record.metadata.intentId === intentId);
                if (
                    !entry ||
                    entry.metadata.phase !== "A" ||
                    entry.metadata.caseId !== item.caseId ||
                    entry.status !== "responded" ||
                    !entry.receipt ||
                    !(
                        entry.metadata.kind === `initial-${purpose}` ||
                        (entry.metadata.kind === "recovery" &&
                            entry.metadata.recovery?.purpose === purpose)
                    )
                )
                    fail(
                        "pilot gate does not bind successful distinct generation and judge receipts"
                    );
            }
        }
        state.phaseBGate = gate;
        state.revision++;
        await atomicSave(resolve(directory), state);
        return inspectRequestLedger(directory);
    });
}
export async function inspectRequestLedger(directory: string) {
    const state = await readState(resolve(directory));
    const phaseCounts = {
        A: state.records.filter(record => record.metadata.phase === "A").length,
        B: state.records.filter(record => record.metadata.phase === "B").length,
    };
    return {
        state,
        counts: {
            consumedSlots: state.records.length,
            phaseA: phaseCounts.A,
            phaseB: phaseCounts.B,
            confirmedProviderResponses: state.records.filter(record => record.receipt !== null)
                .length,
            inFlightOrCrashUncertain: state.records.filter(
                record => record.status === "dispatch-started"
            ).length,
            unconfirmedDispatchSlots: state.records.filter(record => !record.receipt).length,
        },
        remaining: {
            phaseA: 14 - phaseCounts.A,
            phaseB: 168 - phaseCounts.B,
            combined: 182 - state.records.length,
        },
        accounting:
            "consumed slots are a conservative dispatch ceiling; only HTTP receipts confirm provider responses; neither means a valid model output",
    };
}
